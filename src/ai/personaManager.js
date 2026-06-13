/**
 * src/ai/personaManager.js — Persona Loader
 *
 * Resolves the active persona for a guild. Lookup order:
 *   1. In-process cache (instant, no DB hit)
 *   2. PostgreSQL personas table (if DB is enabled)
 *   3. data/persona.md + data/context.md on disk (always-available fallback)
 *
 * The fallback ensures the Endministrator persona is always present even
 * when the DB is unavailable or no custom persona has been configured.
 *
 * Cache invalidation: the cache entry is cleared whenever a persona is
 * created, updated, or switched via the /persona command. TTL is also
 * applied so stale entries expire automatically in long-running processes.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const db = require("../memory/database");

// ── Default persona (disk) ────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "../../data");

function loadFile(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    logger.warn(`[Persona] Data file not found: ${filename}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf-8").trim();
}

// Loaded once at module startup — these are the always-available defaults.
const DEFAULT_PERSONA = loadFile("persona.md");
const DEFAULT_CONTEXT = loadFile("context.md");

// ── In-process persona cache ──────────────────────────────────────────────────
// Key: guildId → { name, persona, context, cachedAt }
// TTL: 5 minutes — long enough to avoid DB chatter, short enough to pick up
//      changes without requiring a restart.
const personaCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * getActivePersona()
 * Returns { name, persona, context } for the given guild.
 * Always returns something — falls back to the disk defaults if needed.
 *
 * @param {string} guildId
 * @returns {Promise<{ name: string, persona: string, context: string }>}
 */
async function getActivePersona(guildId) {
  // 1. Check in-process cache.
  const cached = personaCache.get(guildId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { name: cached.name, persona: cached.persona, context: cached.context };
  }

  // 2. Try DB.
  if (db.isEnabled()) {
    try {
      const row = await db.getActivePersona(guildId);
      if (row) {
        personaCache.set(guildId, { ...row, cachedAt: Date.now() });
        return { name: row.name, persona: row.persona, context: row.context };
      }
    } catch (err) {
      logger.error("[Persona] DB lookup failed, using default:", err.message);
    }
  }

  // 3. Fall back to disk defaults.
  return { name: "endministrator", persona: DEFAULT_PERSONA, context: DEFAULT_CONTEXT };
}

/**
 * invalidateCache()
 * Clears the cached persona for a guild. Call this after any create/update/switch
 * so the next message picks up the new persona immediately.
 *
 * @param {string} guildId
 */
function invalidateCache(guildId) {
  personaCache.delete(guildId);
}

/**
 * getDefaults()
 * Returns the on-disk default persona strings directly.
 * Used by the /persona create command to pre-populate the modal.
 */
function getDefaults() {
  return { persona: DEFAULT_PERSONA, context: DEFAULT_CONTEXT };
}

module.exports = { getActivePersona, invalidateCache, getDefaults };
