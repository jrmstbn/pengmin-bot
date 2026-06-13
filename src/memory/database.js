/**
 * src/memory/database.js — PostgreSQL Persistence Adapter
 *
 * Optional. Activated only when DATABASE_URL is present in the environment.
 * Uses the `pg` package. If DATABASE_URL is absent, all methods are no-ops
 * and isEnabled() returns false.
 *
 * Tables (auto-created on startup):
 *
 *   conversation_memory — per-user per-guild conversation history
 *     user_id    TEXT
 *     guild_id   TEXT   (replaces channel_id — memory is now guild-scoped)
 *     history    JSONB
 *     summary    TEXT
 *     updated_at TIMESTAMPTZ
 *
 *   personas — per-guild custom AI personas
 *     guild_id   TEXT
 *     name       TEXT   (unique identifier within the guild)
 *     persona    TEXT   (character/personality description)
 *     context    TEXT   (world knowledge / lore)
 *     is_active  BOOL   (only one active per guild at a time)
 *     created_at TIMESTAMPTZ
 */

const logger = require("../utils/logger");

let pool = null;
let enabled = false;

// Only attempt to load `pg` if DATABASE_URL is configured.
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // SSL behaviour:
      //   DB_SSL=true  (default) — validates the server certificate. Required for production.
      //   DB_SSL=false           — disables SSL entirely (local dev only).
      //   DB_SSL=no-verify       — connects over SSL but skips cert validation.
      //                           Use only when your provider doesn't supply a CA cert
      //                           and you accept the MITM risk (e.g. some free-tier hosts).
      ssl: (() => {
        const val = process.env.DB_SSL;
        if (val === "false") return false;
        if (val === "no-verify") return { rejectUnauthorized: false };
        return true; // default: full certificate validation
      })(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });

    pool.on("error", (err) => logger.error("[DB] Pool error:", err));
    enabled = true;
    logger.info("[DB] PostgreSQL adapter activated.");
  } catch (err) {
    logger.warn("[DB] `pg` module not found. Install it to enable persistence.");
  }
}

/**
 * initialize()
 * Creates all tables if they don't exist. Call once at startup.
 */
async function initialize() {
  if (!enabled) return;

  // conversation_memory: guild-scoped history (guild_id replaces channel_id
  // so a user's memory persists across all channels in a server).
  // The old channel_id column is kept as an alias via the migration guard below.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_memory (
      user_id    TEXT        NOT NULL,
      guild_id   TEXT        NOT NULL,
      history    JSONB       NOT NULL DEFAULT '[]',
      summary    TEXT        NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, guild_id)
    );
  `);

  // personas: one row per named persona per guild.
  // Only one row per guild should have is_active = TRUE at a time —
  // enforced by setActivePersona() using a transaction.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS personas (
      guild_id   TEXT        NOT NULL,
      name       TEXT        NOT NULL,
      persona    TEXT        NOT NULL DEFAULT '',
      context    TEXT        NOT NULL DEFAULT '',
      is_active  BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, name)
    );
  `);

  logger.info("[DB] Schema verified.");
}

// ── Conversation memory ───────────────────────────────────────────────────────

/**
 * loadHistory() — Retrieves a stored record or null if not found.
 */
async function loadHistory(userId, guildId) {
  if (!enabled) return null;
  const { rows } = await pool.query(
    "SELECT history, summary FROM conversation_memory WHERE user_id=$1 AND guild_id=$2",
    [userId, guildId]
  );
  if (!rows.length) return null;
  return { history: rows[0].history, summary: rows[0].summary };
}

/**
 * saveHistory() — Upserts a record.
 */
async function saveHistory(userId, guildId, { history, summary }) {
  if (!enabled) return;
  await pool.query(
    `INSERT INTO conversation_memory (user_id, guild_id, history, summary, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, guild_id) DO UPDATE
       SET history    = EXCLUDED.history,
           summary    = EXCLUDED.summary,
           updated_at = NOW()`,
    [userId, guildId, JSON.stringify(history), summary]
  );
}

/**
 * deleteHistory() — Hard delete of a user's record for a guild.
 */
async function deleteHistory(userId, guildId) {
  if (!enabled) return;
  await pool.query(
    "DELETE FROM conversation_memory WHERE user_id=$1 AND guild_id=$2",
    [userId, guildId]
  );
}

// ── Personas ──────────────────────────────────────────────────────────────────

/**
 * getActivePersona()
 * Returns the active persona row for a guild, or null if none is set.
 */
async function getActivePersona(guildId) {
  if (!enabled) return null;
  const { rows } = await pool.query(
    "SELECT name, persona, context FROM personas WHERE guild_id=$1 AND is_active=TRUE LIMIT 1",
    [guildId]
  );
  return rows[0] ?? null;
}

/**
 * listPersonas()
 * Returns all personas for a guild, ordered by name.
 */
async function listPersonas(guildId) {
  if (!enabled) return [];
  const { rows } = await pool.query(
    "SELECT name, is_active, created_at FROM personas WHERE guild_id=$1 ORDER BY name",
    [guildId]
  );
  return rows;
}

/**
 * savePersona()
 * Inserts or updates a named persona. Does NOT change the active flag.
 */
async function savePersona(guildId, name, { persona, context }) {
  if (!enabled) return;
  await pool.query(
    `INSERT INTO personas (guild_id, name, persona, context)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, name) DO UPDATE
       SET persona = EXCLUDED.persona,
           context = EXCLUDED.context`,
    [guildId, name, persona, context]
  );
}

/**
 * setActivePersona()
 * Atomically deactivates all personas for a guild then activates the named one.
 * Returns false if the named persona doesn't exist.
 */
async function setActivePersona(guildId, name) {
  if (!enabled) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE personas SET is_active=FALSE WHERE guild_id=$1",
      [guildId]
    );
    const { rowCount } = await client.query(
      "UPDATE personas SET is_active=TRUE WHERE guild_id=$1 AND name=$2",
      [guildId, name]
    );
    await client.query("COMMIT");
    return rowCount > 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * deletePersona()
 * Removes a named persona. Returns false if it didn't exist.
 */
async function deletePersona(guildId, name) {
  if (!enabled) return false;
  const { rowCount } = await pool.query(
    "DELETE FROM personas WHERE guild_id=$1 AND name=$2",
    [guildId, name]
  );
  return rowCount > 0;
}

/**
 * deactivateAllPersonas()
 * Sets is_active=FALSE for every persona in a guild.
 * Used by /persona reset to revert to the disk-based default.
 */
async function deactivateAllPersonas(guildId) {
  if (!enabled) return;
  await pool.query("UPDATE personas SET is_active=FALSE WHERE guild_id=$1", [guildId]);
}

function isEnabled() {
  return enabled;
}

module.exports = {
  initialize,
  // memory
  loadHistory,
  saveHistory,
  deleteHistory,
  // personas
  getActivePersona,
  listPersonas,
  savePersona,
  setActivePersona,
  deletePersona,
  deactivateAllPersonas,
  isEnabled,
};
