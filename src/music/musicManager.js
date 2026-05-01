/**
 * src/music/musicManager.js — Centralized Music Playback Manager
 *
 * Manages per-guild music state including:
 *   - Voice connections
 *   - Audio players
 *   - Song queues with metadata
 *   - Playback state (playing, paused, stopped)
 *   - Loop modes
 *
 * Architecture: Singleton pattern — one instance manages all guilds.
 */

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  entersState,
} = require("@discordjs/voice");
const play = require("play-dl");
const logger = require("../utils/logger");

class MusicManager {
  constructor() {
    // Map<guildId, GuildMusicState>
    this.guilds = new Map();
  }

  /**
   * getGuildState()
   * Retrieves or initializes music state for a guild.
   */
  getGuildState(guildId) {
    if (!this.guilds.has(guildId)) {
      this.guilds.set(guildId, {
        connection: null,
        player: null,
        queue: [],
        currentTrack: null,
        isPaused: false,
        loopMode: "off", // off, one, all
      });
    }
    return this.guilds.get(guildId);
  }

  /**
   * joinVoice()
   * Joins a voice channel and sets up the audio player.
   *
   * @param {VoiceChannel} voiceChannel
   * @param {string} guildId
   * @returns {Promise<Object>} { connection, player }
   */
  async joinVoice(voiceChannel, guildId) {
    const state = this.getGuildState(guildId);

    // Already connected — reuse existing connection and player
    if (state.connection && state.player) {
      return { connection: state.connection, player: state.player };
    }

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      // Wait for connection to be ready (30s timeout)
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

      const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
      });

      // Handle player errors
      player.on("error", (err) => {
        logger.error(`Audio player error [${guildId}]:`, err);
      });

      player.on(AudioPlayerStatus.Playing, () => {
        logger.debug(`Player status: Playing [${guildId}]`);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        logger.debug(`Player status: Idle [${guildId}]`);
      });

      player.on(AudioPlayerStatus.Paused, () => {
        logger.debug(`Player status: Paused [${guildId}]`);
      });

      connection.subscribe(player);

      state.connection = connection;
      state.player = player;

      // Ensure bot member info is available
      try {
        await voiceChannel.guild.members.fetchMe();
      } catch (err) {
        logger.warn(`Could not fetch bot member info [${guildId}]:`, err);
      }

      // Handle unexpected connection drops
      connection.on("error", (err) => {
        logger.error(`Voice connection error [${guildId}]:`, err);
        this.cleanup(guildId);
      });

      logger.info(`Joined voice channel [${guildId}]`);
      return { connection, player };
    } catch (err) {
      logger.error(`Failed to join voice channel [${guildId}]:`, err);
      throw err;
    }
  }

  /**
   * search()
   * Searches for a song using play-dl.
   *
   * NOTE: We use video.url directly from play-dl's search result objects.
   * Manually constructing the URL via `video.id` is unreliable — video.id
   * can be undefined depending on the play-dl version and result type,
   * which produces an invalid "?v=undefined" URL that breaks play.stream().
   *
   * @param {string} query - Song title or direct YouTube URL
   * @returns {Promise<Object|null>} { title, url, duration, thumbnail, channel }
   */
  async search(query) {
    try {
      // Handle direct YouTube URLs — skip search, fetch info directly
      if (query.includes("youtube.com") || query.includes("youtu.be")) {
        const info = await play.video_info(query);
        return {
          title: info.video_details.title,
          url: query,
          duration: info.video_details.durationInSec,
          thumbnail: info.video_details.thumbnails.at(-1)?.url,
          channel: info.video_details.channel?.name ?? "Unknown",
        };
      }

      // Search YouTube by query string
      const results = await play.search(query, { limit: 1 });
      if (!results || results.length === 0) {
        logger.warn(`No search results found for query: "${query}"`);
        return null;
      }

      const video = results[0];

      // Use video.url directly — it is always present on play-dl search results.
      // Do NOT construct from video.id; that field is not guaranteed to exist.
      const videoUrl = (video.url ?? "").trim();

      if (
        !videoUrl ||
        videoUrl.includes("undefined") ||
        !/^https?:\/\//i.test(videoUrl)
      ) {
        logger.warn(
          `Search result returned invalid URL for query: "${query}" — got: ${videoUrl}`,
        );
        return null;
      }

      logger.debug(`Search result URL: ${videoUrl}`);

      return {
        title: video.title,
        url: videoUrl,
        duration: video.durationInSec,
        thumbnail: video.thumbnail?.url ?? null,
        channel: video.channel?.name ?? "Unknown",
      };
    } catch (err) {
      logger.error(`Search error for query "${query}": ${err.message}`);
      return null;
    }
  }

  /**
   * addToQueue()
   * Adds a track object to the guild's queue.
   *
   * @param {string} guildId
   * @param {Object} track { title, url, duration, thumbnail, channel, requesterId, requesterName }
   */
  addToQueue(guildId, track) {
    const state = this.getGuildState(guildId);
    state.queue.push(track);
    logger.debug(`Added to queue [${guildId}]: ${track.title}`);
  }

  /**
   * play()
   * Dequeues and plays the next track.
   *
   * Includes a URL validity guard — if a track somehow has a malformed or
   * missing URL (e.g., "?v=undefined"), it is skipped rather than crashing.
   *
   * @param {string} guildId
   * @returns {Promise<Object|null>} The track now playing, or null if queue is empty
   */
  async play(guildId) {
    const state = this.getGuildState(guildId);

    if (!state.player) {
      logger.warn(`No player available for guild ${guildId}`);
      return null;
    }

    // Dequeue the next track
    const track = state.queue.shift();

    if (!track) {
      state.currentTrack = null;
      state.player.stop();
      logger.debug(`Queue empty [${guildId}]`);
      return null;
    }

    // Guard: reject tracks with missing or malformed URLs before attempting to stream.
    // This catches any invalid or malformed URLs that would otherwise cause
    // play.stream() to throw "Invalid URL".
    const trackUrl = typeof track.url === "string" ? track.url.trim() : "";
    if (
      !trackUrl ||
      trackUrl.includes("undefined") ||
      !/^https?:\/\//i.test(trackUrl)
    ) {
      logger.error(
        `Skipping track with invalid URL [${guildId}]: "${track.url}" — Title: ${track.title}`,
      );
      return this.play(guildId); // skip to next track
    }

    try {
      logger.debug(`Streaming URL [${guildId}]: ${trackUrl}`);

      // play.stream() must receive a URL string — not a video object.
      // Passing a video object causes "i.trim is not a function".
      const stream = await play.stream(trackUrl);

      if (!stream || !stream.stream) {
        throw new Error("Stream returned null or undefined");
      }

      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
        inlineVolume: true,
      });

      state.currentTrack = track;
      state.isPaused = false;
      state.player.play(resource);

      logger.info(`Now playing [${guildId}]: ${track.title}`);
      return track;
    } catch (err) {
      logger.error(
        `Failed to play track [${guildId}]: "${track.title}" — ${err.message} : URL: ${track.url}`,
      );
      // Skip the failed track and attempt the next one
      return this.play(guildId);
    }
  }

  /**
   * setupAutoPlay()
   * Binds an Idle listener to automatically advance the queue when a track ends.
   * Removes any existing Idle listener first to prevent duplicates.
   *
   * @param {string} guildId
   * @param {Function} onTrackEnd - Called with the next track (or null if queue ended)
   */
  setupAutoPlay(guildId, onTrackEnd) {
    const state = this.getGuildState(guildId);
    if (!state.player) return;

    // Remove stale listeners before adding a new one
    state.player.removeAllListeners(AudioPlayerStatus.Idle);

    state.player.on(AudioPlayerStatus.Idle, async () => {
      const nextTrack = await this.play(guildId);

      if (onTrackEnd) {
        onTrackEnd(nextTrack);
      }

      // Disconnect if nothing left to play
      if (!nextTrack) {
        this.leaveVoice(guildId);
      }
    });
  }

  /**
   * pause()
   * Pauses the currently playing track.
   *
   * @returns {boolean} true if paused successfully, false otherwise
   */
  pause(guildId) {
    const state = this.getGuildState(guildId);
    if (
      state.player &&
      state.player.state.status === AudioPlayerStatus.Playing
    ) {
      state.player.pause();
      state.isPaused = true;
      logger.debug(`Paused [${guildId}]`);
      return true;
    }
    return false;
  }

  /**
   * resume()
   * Resumes a paused track.
   *
   * @returns {boolean} true if resumed successfully, false otherwise
   */
  resume(guildId) {
    const state = this.getGuildState(guildId);
    if (
      state.player &&
      state.player.state.status === AudioPlayerStatus.Paused
    ) {
      state.player.unpause();
      state.isPaused = false;
      logger.debug(`Resumed [${guildId}]`);
      return true;
    }
    return false;
  }

  /**
   * skip()
   * Stops the current track and immediately plays the next one in queue.
   *
   * @returns {Promise<Object|null>} Next track or null if queue is empty
   */
  async skip(guildId) {
    const state = this.getGuildState(guildId);
    if (state.player) {
      state.player.stop();
      return this.play(guildId);
    }
    return null;
  }

  /**
   * stop()
   * Stops playback and clears the queue entirely.
   */
  stop(guildId) {
    const state = this.getGuildState(guildId);
    if (state.player) {
      state.player.stop();
    }
    state.queue = [];
    state.currentTrack = null;
    state.isPaused = false;
    logger.debug(`Stopped and queue cleared [${guildId}]`);
  }

  /**
   * setLoopMode()
   * Sets the loop mode for the guild.
   *
   * @param {string} mode - "off" | "one" | "all"
   * @returns {boolean} true if mode was valid and set, false otherwise
   */
  setLoopMode(guildId, mode) {
    const state = this.getGuildState(guildId);
    if (!["off", "one", "all"].includes(mode)) {
      return false;
    }
    state.loopMode = mode;
    logger.debug(`Loop mode set to "${mode}" [${guildId}]`);
    return true;
  }

  /**
   * getQueue()
   * Returns the current queue array (does not include the now-playing track).
   */
  getQueue(guildId) {
    const state = this.getGuildState(guildId);
    return state.queue;
  }

  /**
   * getCurrentTrack()
   * Returns the currently playing track object, or null.
   */
  getCurrentTrack(guildId) {
    const state = this.getGuildState(guildId);
    return state.currentTrack;
  }

  /**
   * getState()
   * Returns the full GuildMusicState for debugging or status commands.
   */
  getState(guildId) {
    return this.getGuildState(guildId);
  }

  /**
   * leaveVoice()
   * Destroys the voice connection and cleans up all guild state.
   */
  leaveVoice(guildId) {
    const state = this.getGuildState(guildId);
    if (state.connection) {
      state.connection.destroy();
      logger.info(`Left voice channel [${guildId}]`);
    }
    this.cleanup(guildId);
  }

  /**
   * cleanup()
   * Resets all music state for a guild and removes it from the map.
   */
  cleanup(guildId) {
    const state = this.getGuildState(guildId);
    state.connection = null;
    state.player = null;
    state.queue = [];
    state.currentTrack = null;
    state.isPaused = false;
    this.guilds.delete(guildId);
  }
}

// Export as singleton — one MusicManager handles all guilds
const musicManager = new MusicManager();
module.exports = musicManager;
