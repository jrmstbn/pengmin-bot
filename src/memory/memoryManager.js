/**
 * src/memory/memoryManager.js — Conversation Memory Manager
 *
 * Provides a two-tier memory system:
 *   Tier 1 (Hot)  — In-process Map for instant access
 *   Tier 2 (Cold) — PostgreSQL for persistence across restarts (optional)
 *
 * When history grows beyond MAX_HISTORY_TOKENS, older messages are
 * compressed via the AI summarizer and stored as a single "summary" string.
 * This keeps token usage bounded while preserving long-term context.
 *
 * Architecture decision: All callers use getHistory()/saveHistory().
 * Swapping the persistence backend requires changing only this file.
 */

const logger = require("../utils/logger");
const { summarize } = require("../ai/aiService");
const db = require("./database");

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_MESSAGES = parseInt(process.env.MAX_HISTORY_MESSAGES || "20");
// When history exceeds this size, we summarize the oldest half.
const SUMMARIZE_THRESHOLD = parseInt(process.env.SUMMARIZE_THRESHOLD || "16");

// ── In-memory cache ───────────────────────────────────────────────────────────
// Key: `${userId}:${channelId}` → { history: [], summary: "" }
const cache = new Map();

/**
 * getHistory()
 * Returns the active conversation history and any compressed summary
 * for the given user+channel pair.
 *
 * @param {string} userId
 * @param {string} channelId
 * @returns {Promise<{ history: Array, summary: string }>}
 */
async function getHistory(userId, channelId) {
  const key = cacheKey(userId, channelId);

  // Return from hot cache if available.
  if (cache.has(key)) return cache.get(key);

  // Otherwise, attempt a DB lookup.
  if (db.isEnabled()) {
    const record = await db.loadHistory(userId, channelId);
    if (record) {
      cache.set(key, record);
      return record;
    }
  }

  // Cold start — return empty state.
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
 * @param {string} channelId
 * @param {Array}  newHistory  Full updated history array.
 */
async function saveHistory(userId, channelId, newHistory) {
  const key = cacheKey(userId, channelId);
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
      // Append to any prior summary rather than replacing it.
      summary = summary
        ? `${summary}\n\n[Later summary]:\n${newSummary}`
        : newSummary;
      history = toKeep;
      logger.debug(
        `[Memory] Summarized ${toSummarize.length} messages for ${key}`,
      );
    } catch (err) {
      logger.warn(
        `[Memory] Summarization failed, trimming instead:`,
        err.message,
      );
      history = history.slice(-MAX_MESSAGES);
    }
  }

  // Hard cap as a safety net.
  if (history.length > MAX_MESSAGES) {
    history = history.slice(-MAX_MESSAGES);
  }

  const record = { history, summary };
  cache.set(key, record);

  // Persist to DB asynchronously — don't block the Discord response.
  if (db.isEnabled()) {
    db.saveHistory(userId, channelId, record).catch((err) =>
      logger.error("[Memory] DB save failed:", err.message),
    );
  }
}

/**
 * clearHistory()
 * Wipes conversation state for a user+channel pair.
 * Called by the /forget slash command.
 */
async function clearHistory(userId, channelId) {
  const key = cacheKey(userId, channelId);
  cache.delete(key);
  if (db.isEnabled()) {
    await db.deleteHistory(userId, channelId);
  }
}

/**
 * getStats()
 * Returns diagnostic info — used by the /memory slash command.
 */
function getStats(userId, channelId) {
  const key = cacheKey(userId, channelId);
  const record = cache.get(key);
  return {
    messages: record?.history?.length ?? 0,
    hasSummary: !!record?.summary,
    cacheSize: cache.size,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cacheKey(userId, channelId) {
  return `${userId}:${channelId}`;
}

module.exports = { getHistory, saveHistory, clearHistory, getStats };
