/**
 * src/music/musicManager.js — DisTube-backed Music Manager
 *
 * Wraps DisTube v5 and exposes the same interface the music commands use.
 *
 * Key design decisions:
 *   - ffmpeg-static is passed to DisTube so no system ffmpeg is required.
 *   - Per-guild callbacks replace per-invocation event listeners, eliminating
 *     the MaxListeners leak. Each guild stores one pending callback at a time;
 *     the central handlers dispatch to it and clean up immediately.
 */

const { DisTube, RepeatMode } = require("distube");
const { YtDlpPlugin, download } = require("@distube/yt-dlp");
const ffmpegPath = require("ffmpeg-static");
const { execSync, execFile } = require("child_process");
const path = require("path");
const logger = require("../utils/logger");

// Path to the bundled yt-dlp binary (downloaded on first boot)
const YTDLP_BIN = path.join(
  path.dirname(require.resolve("@distube/yt-dlp")),
  "..",
  "bin",
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
);

/**
 * ytdlpJson()
 * Runs yt-dlp with --dump-single-json and returns parsed output.
 * Uses execFile with separate stdout/stderr so deprecation warnings
 * on stderr never contaminate the JSON on stdout.
 */
function ytdlpJson(query) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP_BIN,
      [query, "--dump-single-json", "--no-warnings", "--skip-download", "--simulate", "--quiet"],
      { maxBuffer: 50 * 1024 * 1024 }, // 50MB — info JSON can be large
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          reject(new Error(`yt-dlp JSON parse failed: ${stdout.slice(0, 200)}`));
        }
      }
    );
  });
}

class MusicManager {
  constructor() {
    /** @type {DisTube|null} */
    this.distube = null;

    /**
     * Per-guild pending callbacks set by play.js before calling play().
     * Shape: Map<guildId, { onPlay, onAdd, onErr }>
     */
    this._callbacks = new Map();
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  /**
   * initDistube()
   * Must be called once with the Discord client before any music commands run.
   *
   * @param {import("discord.js").Client} client
   */
  async initDistube(client) {
    // Auto-download yt-dlp binary if not found in PATH or local bin.
    // @distube/yt-dlp bundles a download() helper that fetches the correct
    // platform binary into node_modules/@distube/yt-dlp/bin/ automatically.
    try {
      const version = execSync("yt-dlp --version", { timeout: 5000 }).toString().trim();
      logger.info(`yt-dlp found in PATH: v${version}`);
    } catch {
      logger.info("yt-dlp not found in PATH — downloading bundled binary...");
      try {
        const version = await download();
        logger.info(`yt-dlp downloaded: v${version}`);
      } catch (err) {
        logger.error("Failed to download yt-dlp binary:", err.message);
        logger.warn("Music playback may not work. Install yt-dlp manually: pip install yt-dlp");
      }
    }

    // Tell DisTube where ffmpeg lives — uses the bundled ffmpeg-static binary.
    process.env.FFMPEG_PATH = ffmpegPath;

    this.distube = new DisTube(client, {
      plugins: [new YtDlpPlugin({ update: true })],
      ffmpeg: { path: ffmpegPath },
      emitNewSongOnly: false,
      joinNewVoiceChannel: true,
    });

    // ── Central event handlers ──────────────────────────────────────────────
    // These are registered ONCE here, not per /play invocation.
    // play.js registers a per-guild callback via setPendingCallback() before
    // calling play(); these handlers dispatch to it and clear it immediately.

    this.distube.on("playSong", (queue, song) => {
      logger.info(`Now playing [${queue.id}]: ${song.name}`);
      const cb = this._callbacks.get(queue.id);
      if (cb?.onPlay) {
        this._callbacks.delete(queue.id);
        cb.onPlay(queue, song);
      }
    });

    this.distube.on("addSong", (queue, song) => {
      logger.debug(`Added to queue [${queue.id}]: ${song.name}`);
      const cb = this._callbacks.get(queue.id);
      if (cb?.onAdd) {
        this._callbacks.delete(queue.id);
        cb.onAdd(queue, song);
      }
    });

    this.distube.on("finish", (queue) => {
      logger.info(`Queue finished [${queue.id}]`);
    });

    this.distube.on("disconnect", (queue) => {
      logger.info(`Disconnected [${queue.id}]`);
      this._callbacks.delete(queue.id);
    });

    this.distube.on("error", (error, queue) => {
      logger.error(`DisTube error [${queue?.id ?? "unknown"}]:`, error);
      const cb = this._callbacks.get(queue?.id);
      if (cb?.onErr) {
        this._callbacks.delete(queue.id);
        cb.onErr(error, queue);
      }
    });

    logger.info("DisTube initialized.");
    return this.distube;
  }

  // ─── Callback registration (used by play.js) ──────────────────────────────

  /**
   * setPendingCallback()
   * Registers per-guild one-shot callbacks for the next play() call.
   * Called by play.js before invoking musicManager.play().
   *
   * @param {string} guildId
   * @param {{ onPlay, onAdd, onErr }} callbacks
   */
  setPendingCallback(guildId, callbacks) {
    this._callbacks.set(guildId, callbacks);
  }

  /**
   * clearPendingCallback()
   * Removes any pending callback for a guild (used by the timeout fallback).
   */
  clearPendingCallback(guildId) {
    this._callbacks.delete(guildId);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _d() {
    if (!this.distube) throw new Error("DisTube not initialized. Call initDistube(client) first.");
    return this.distube;
  }

  _normalizeRepeat(mode) {
    switch (mode) {
      case "one": return RepeatMode.SONG;
      case "all": return RepeatMode.QUEUE;
      default:    return RepeatMode.DISABLED;
    }
  }

  _repeatToString(repeatMode) {
    switch (repeatMode) {
      case RepeatMode.SONG:  return "one";
      case RepeatMode.QUEUE: return "all";
      default:               return "off";
    }
  }

  _songToTrack(song) {
    return {
      title: song.name ?? "Unknown",
      url: song.url,
      duration: song.duration ?? 0,
      thumbnail: song.thumbnail ?? null,
      channel: song.uploader?.name ?? song.member?.user?.username ?? "Unknown",
      requesterId: song.member?.id ?? "",
      requesterName: song.member?.user?.username ?? "Unknown",
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async play(voiceChannel, query, member, textChannel) {
    // @distube/yt-dlp is a "playable-extractor" — it handles URLs only.
    // DisTube's internal #searchSong() requires an "extractor" plugin for text queries.
    // So we resolve text queries to a direct YouTube URL ourselves via yt-dlp,
    // then pass the URL to DisTube which the plugin can handle.
    const isUrl = /^https?:\/\//i.test(query.trim());
    let resolvedUrl = query;

    if (!isUrl) {
      try {
        logger.debug(`Resolving text query via yt-dlp: "${query}"`);
        const result = await ytdlpJson(`ytsearch:${query}`);
        // ytsearch returns a playlist wrapper — first entry is the top result
        const entry = result.entries?.[0] ?? result;
        if (!entry?.webpage_url) throw new Error("No URL in yt-dlp result");
        resolvedUrl = entry.webpage_url;
        logger.debug(`Resolved to URL: ${resolvedUrl}`);
      } catch (err) {
        logger.error(`yt-dlp search failed for "${query}":`, err.message);
        throw err;
      }
    }

    await this._d().play(voiceChannel, resolvedUrl, { member, textChannel });
  }

  pause(guildId) {
    const queue = this._d().getQueue(guildId);
    if (!queue || queue.paused) return false;
    queue.pause();
    return true;
  }

  resume(guildId) {
    const queue = this._d().getQueue(guildId);
    if (!queue || !queue.paused) return false;
    queue.resume();
    return true;
  }

  async skip(guildId) {
    const queue = this._d().getQueue(guildId);
    if (!queue) return null;
    return queue.skip();
  }

  async stop(guildId) {
    const queue = this._d().getQueue(guildId);
    if (queue) await queue.stop();
  }

  async leaveVoice(guildId) {
    await this.stop(guildId);
  }

  setVolume(guildId, volume) {
    const queue = this._d().getQueue(guildId);
    if (!queue) return false;
    queue.setVolume(Math.round(Math.max(0, Math.min(100, volume))));
    return true;
  }

  setLoopMode(guildId, mode) {
    if (!["off", "one", "all"].includes(mode)) return false;
    const queue = this._d().getQueue(guildId);
    if (!queue) return false;
    queue.setRepeatMode(this._normalizeRepeat(mode));
    return true;
  }

  getCurrentTrack(guildId) {
    const queue = this._d().getQueue(guildId);
    if (!queue?.songs?.[0]) return null;
    return this._songToTrack(queue.songs[0]);
  }

  getQueue(guildId) {
    const queue = this._d().getQueue(guildId);
    if (!queue?.songs) return [];
    return queue.songs.slice(1).map((s) => this._songToTrack(s));
  }

  getState(guildId) {
    const queue = this._d().getQueue(guildId);
    return {
      connection: queue ? true : null,
      player: queue ? true : null,
      currentTrack: this.getCurrentTrack(guildId),
      queue: this.getQueue(guildId),
      isPaused: queue?.paused ?? false,
      loopMode: this._repeatToString(queue?.repeatMode),
      volume: queue?.volume ?? 100,
    };
  }
}

const musicManager = new MusicManager();
module.exports = musicManager;
