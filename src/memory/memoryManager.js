/**
 * src/memory/memoryManager.js — Conversation Memory Manager
 *
 * Provides a two-tier memory system:
 *   Tier 1 (Hot)  — In-process Map for instant access
 *   Tier 2 (Cold) — PostgreSQL for persistence across restarts (optional)
 *
 * Memory is now keyed per USER per GUILD (not per channel). This means the
 * bot remembers a user across all channels in a server, giving cross-channel
 * context awareness. DMs use "DM" as the guild key.
 *
 * When history grows beyond SUMMARIZE_THRESHOLD, older messages are compressed
 * via the AI summarizer and stored as a single "summary" string. This keeps
 * token usage bounded while preserving long-term context.
 */

const logger = require("../utils/logger");
const { summarize } = require("../ai/aiService");
const db = require("./database");

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_MESSAGES = parseInt(process.env.MAX_HISTORY_MESSAGES || "20");
const SUMMARIZE_THRESHOLD = parseInt(process.env.SUMMARIZE_THRESHOLD || "16");

// ── In-memory cache ───────────────────────────────────────────────────────────
// Key: `${userId}:${guildId}` → { history: [], summary: "" }
const cache = new Map();

// Ensure the DB schema exists on startup.
db.initialize().catch((err) =>
  logger.error("[Memory] DB initialization failed:", err.message)
);

/**
 * getHistory()
 * Returns the conversation history and any compressed summary
 * for the given user+guild pair.
 *
 * @param {string} userId
 * @param {string} guildId
 * @returns {Promise<{ history: Array, summary: string }>}
 */
async function getHistory(userId, guildId) {
  const key = cacheKey(userId, guildId);

  if (cache.has(key)) return cache.get(key);

  if (db.isEnabled()) {
    try {
      const record = await db.loadHistory(userId, guildId);
      if (record) {
        cache.set(key, record);
        return record;
      }
    } catch (err) {
      logger.error("[Memory] DB load failed, using empty history:", err.message);
    }
  }

  const fresh = { history: [], summary: "" };
  cache.set(key, fresh);
  return fresh;
}

/**
 * saveHistory()
 * Persists an updated history array. Automatically trims and summarizes
 * if the history grows too long.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {Array}  newHistory  Full updated history array.
 */
async function saveHistory(userId, guildId, newHistory) {
  const key = cacheKey(userId, guildId);
  const existing = cache.get(key) ?? { history: [], summary: "" };

  let { summary } = existing;
  let history = newHistory;

  // ── Summarize & trim if over threshold ────────────────────────────────────
  if (history.length > SUMMARIZE_THRESHOLD) {
    const midpoint = Math.floor(history.length / 2);
    const toSummarize = history.slice(0, midpoint);
    const toKeep = history.slice(midpoint);

    try {
      const newSummary = await summarize(toSummarize);
      summary = summary
        ? `${summary}\n\n[Later summary]:\n${newSummary}`
        : newSummary;
      history = toKeep;
      logger.debug(`[Memory] Summarized ${toSummarize.length} messages for ${key}`);
    } catch (err) {
      logger.warn("[Memory] Summarization failed, trimming instead:", err.message);
      history = history.slice(-MAX_MESSAGES);
    }
  }

  if (history.length > MAX_MESSAGES) {
    history = history.slice(-MAX_MESSAGES);
  }

  const record = { history, summary };
  cache.set(key, record);

  if (db.isEnabled()) {
    db.saveHistory(userId, guildId, record).catch((err) =>
      logger.error("[Memory] DB save failed:", err.message)
    );
  }
}

/**
 * clearHistory()
 * Wipes conversation state for a user+guild pair.
 * Called by the /memory forget slash command.
 *
 * @param {string} userId
 * @param {string} guildId
 */
async function clearHistory(userId, guildId) {
  const key = cacheKey(userId, guildId);
  cache.delete(key);
  if (db.isEnabled()) {
    await db.deleteHistory(userId, guildId).catch((err) =>
      logger.error("[Memory] DB delete failed:", err.message)
    );
  }
}

/**
 * getStats()
 * Returns diagnostic info — used by the /memory slash command.
 *
 * @param {string} userId
 * @param {string} guildId
 */
function getStats(userId, guildId) {
  const key = cacheKey(userId, guildId);
  const record = cache.get(key);
  return {
    messages: record?.history?.length ?? 0,
    hasSummary: !!record?.summary,
    cacheSize: cache.size,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cacheKey(userId, guildId) {
  return `${userId}:${guildId}`;
}

module.exports = { getHistory, saveHistory, clearHistory, getStats };
