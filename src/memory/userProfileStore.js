/**
 * src/memory/userProfileStore.js — User Profile Store
 *
 * Persists a lightweight per-user personality profile keyed by userId + guildId.
 * Profiles accumulate interaction counts, topics of interest, preferred tone,
 * notable facts, and sentiment history — feeding into prompt personalization.
 *
 * Storage:
 *   - In-memory Map (always active)
 *   - PostgreSQL (when DATABASE_URL is configured) via database.js
 *
 * Caps enforced on every update():
 *   - topicsOfInterest: max 10 (drop oldest)
 *   - notableFacts:     max 20 (drop oldest)
 *   - sentimentHistory: max 5  (prepend newest, drop oldest)
 *
 * No raw message content is stored — only extracted labels and facts.
 */

const logger = require("../utils/logger");
const db = require("./database");

// ── Default profile shape ─────────────────────────────────────────────────────

function makeDefaultProfile(userId, guildId) {
  const now = new Date().toISOString();
  return {
    userId,
    guildId,
    interactionCount: 0,
    topicsOfInterest: [],    // string[] max 10
    preferredTone: "neutral", // 'brief' | 'detailed' | 'casual' | 'technical' | 'neutral'
    notableFacts: [],         // string[] max 20
    sentimentHistory: [],     // string[] max 5, newest first
    lastSeen: now,
    createdAt: now,
  };
}

// ── In-memory cache ───────────────────────────────────────────────────────────
// Key: `${userId}:${guildId}` → UserProfile
const _cache = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * get()
 * Returns the UserProfile for userId+guildId, creating a default if absent.
 *
 * @param {string} userId
 * @param {string} guildId
 * @returns {Promise<UserProfile>}
 */
async function get(userId, guildId) {
  const key = cacheKey(userId, guildId);

  if (_cache.has(key)) return _cache.get(key);

  // Try DB
  if (db.isEnabled()) {
    try {
      const row = await db.loadUserProfile(userId, guildId);
      if (row) {
        _cache.set(key, row);
        return row;
      }
    } catch (err) {
      logger.error("[UserProfile] DB load failed:", err.message);
    }
  }

  const profile = makeDefaultProfile(userId, guildId);
  _cache.set(key, profile);
  return profile;
}

/**
 * update()
 * Merges a partial delta onto the existing profile.
 * Enforces array caps and updates lastSeen.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {Partial<UserProfile>} delta
 * @returns {Promise<UserProfile>}
 */
async function update(userId, guildId, delta) {
  const existing = await get(userId, guildId);
  const key = cacheKey(userId, guildId);

  // Merge scalar fields
  const updated = { ...existing };

  if (typeof delta.interactionCount === "number") {
    updated.interactionCount = delta.interactionCount;
  }
  if (typeof delta.preferredTone === "string") {
    updated.preferredTone = delta.preferredTone;
  }

  // Merge array fields with caps
  if (Array.isArray(delta.topicsOfInterest)) {
    const merged = [
      ...new Set([...existing.topicsOfInterest, ...delta.topicsOfInterest]),
    ];
    updated.topicsOfInterest = merged.slice(-10); // keep newest 10
  }

  if (Array.isArray(delta.notableFacts)) {
    const merged = [...existing.notableFacts, ...delta.notableFacts];
    updated.notableFacts = merged.slice(-20); // keep newest 20
  }

  // sentimentHistory: prepend newest, keep last 5
  if (Array.isArray(delta.sentimentHistory)) {
    updated.sentimentHistory = [
      ...delta.sentimentHistory,
      ...existing.sentimentHistory,
    ].slice(0, 5);
  }

  updated.lastSeen = new Date().toISOString();

  _cache.set(key, updated);

  if (db.isEnabled()) {
    db.saveUserProfile(userId, guildId, updated).catch((err) =>
      logger.error("[UserProfile] DB save failed:", err.message)
    );
  }

  return updated;
}

/**
 * getUserFacts()
 * Returns the notableFacts array for a user profile.
 *
 * @param {string} userId
 * @param {string} guildId
 * @returns {Promise<string[]>}
 */
async function getUserFacts(userId, guildId) {
  const profile = await get(userId, guildId);
  return profile.notableFacts;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cacheKey(userId, guildId) {
  return `${userId}:${guildId}`;
}

module.exports = { get, update, getUserFacts };
