/**
 * src/music/ytdlpPlugin.js — Safe yt-dlp DisTube Plugin
 *
 * WHY THIS EXISTS
 * ──────────────
 * @distube/yt-dlp's internal json() helper pipes stdout AND stderr into the
 * same buffer, then calls JSON.parse() on the combined result. Recent yt-dlp
 * versions print deprecation notices to stderr, which get prepended to the
 * JSON on stdout, causing:
 *
 *   SyntaxError: Unexpected token 'D', "Deprecated"... is not valid JSON
 *
 * This plugin is a drop-in replacement for YtDlpPlugin. It uses Node's
 * execFile() which keeps stdout and stderr in separate buffers, so any
 * warnings on stderr never contaminate the JSON on stdout.
 *
 * It extends DisTube's PlayableExtractorPlugin and implements the exact same
 * interface that @distube/yt-dlp does — verified against the yt-dlp source.
 */

const { PlayableExtractorPlugin, Song } = require("distube");
const { execFile } = require("child_process");
const path = require("path");
const logger = require("../utils/logger");

// Reuse the bundled binary that @distube/yt-dlp ships.
const YTDLP_BIN = path.join(
  path.dirname(require.resolve("@distube/yt-dlp")),
  "..",
  "bin",
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
);

// YouTube URL patterns this plugin handles.
const YT_PATTERNS = [
  /^https?:\/\/(www\.|music\.)?youtube\.com\//,
  /^https?:\/\/youtu\.be\//,
];

/**
 * Run yt-dlp and return parsed JSON from stdout only.
 * stderr is captured separately and never mixed into the JSON.
 */
function ytdlpExec(args) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP_BIN,
      args,
      { maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`yt-dlp JSON parse failed. stdout preview: ${stdout.slice(0, 300)}`));
        }
      }
    );
  });
}

// Base yt-dlp flags shared between resolve() and getStreamURL().
const BASE_FLAGS = [
  "--dump-single-json",
  "--no-warnings",
  "--no-call-home",
  "--prefer-free-formats",
  "--skip-download",
  "--simulate",
  "--quiet",
];

class YtDlpSafePlugin extends PlayableExtractorPlugin {
  /**
   * validate() — DisTube calls this to decide which plugin handles a URL.
   */
  validate(url) {
    return YT_PATTERNS.some((p) => p.test(url));
  }

  /**
   * resolve() — DisTube calls this to get song metadata from a URL.
   * Must return a Song (or Playlist) instance.
   */
  async resolve(url, options = {}) {
    logger.debug(`[YtDlpPlugin] Resolving: ${url}`);

    const info = await ytdlpExec([url, ...BASE_FLAGS]);

    // Build a Song using the same field mapping as YtDlpSong in @distube/yt-dlp.
    return new Song(
      {
        plugin: this,
        source: info.extractor ?? "youtube",
        playFromSource: true,
        id: info.id ?? url,
        name: info.title ?? info.fulltitle ?? "Unknown",
        url: info.webpage_url ?? info.original_url ?? url,
        isLive: !!info.is_live,
        thumbnail: info.thumbnail ?? info.thumbnails?.[0]?.url ?? null,
        duration: info.is_live ? 0 : (info.duration ?? 0),
        uploader: {
          name: info.uploader ?? info.channel ?? "Unknown",
          url: info.uploader_url ?? null,
        },
        views: info.view_count ?? 0,
        likes: info.like_count ?? 0,
        reposts: 0,
        comments: info.comment_count ?? 0,
        age_limit: info.age_limit ?? 0,
        related: [],
      },
      options?.member,
      this
    );
  }

  /**
   * getStreamURL() — DisTube calls this when it needs a streamable audio URL.
   * Returns the best audio-only direct URL from yt-dlp.
   */
  async getStreamURL(song) {
    if (!song.url) throw new Error("Cannot get stream URL: song has no URL.");

    logger.debug(`[YtDlpPlugin] Getting stream URL for: ${song.url}`);

    const info = await ytdlpExec([
      song.url,
      "--dump-single-json",
      "--no-warnings",
      "--no-call-home",
      "--prefer-free-formats",
      "--skip-download",
      "--simulate",
      "--quiet",
      "--format", "ba/ba*",
    ]);

    const streamUrl = info.url ?? info.requested_downloads?.[0]?.url;
    if (!streamUrl) throw new Error(`No stream URL found for: ${song.url}`);

    logger.debug(`[YtDlpPlugin] Stream URL resolved (${info.ext ?? "?"}, ${info.acodec ?? "?"})`);
    return streamUrl;
  }
}

module.exports = { YtDlpSafePlugin };
