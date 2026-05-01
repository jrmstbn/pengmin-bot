/**
 * src/memory/database.js — PostgreSQL Persistence Adapter
 *
 * Optional. Activated only when DATABASE_URL is present in the environment.
 * Uses the `pg` package. If DATABASE_URL is absent, all methods are no-ops
 * and isEnabled() returns false.
 *
 * Schema (auto-created on startup):
 *   TABLE conversation_memory (
 *     user_id     TEXT NOT NULL,
 *     channel_id  TEXT NOT NULL,
 *     history     JSONB NOT NULL DEFAULT '[]',
 *     summary     TEXT NOT NULL DEFAULT '',
 *     updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     PRIMARY KEY (user_id, channel_id)
 *   )
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
      // ssl required for most cloud Postgres providers (Heroku, Railway, Supabase)
      ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
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
 * Creates the table if it doesn't exist. Call once at startup.
 */
async function initialize() {
  if (!enabled) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_memory (
      user_id     TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      history     JSONB NOT NULL DEFAULT '[]',
      summary     TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, channel_id)
    );
  `);
  logger.info("[DB] Schema verified.");
}

/**
 * loadHistory() — Retrieves a stored record or null if not found.
 */
async function loadHistory(userId, channelId) {
  if (!enabled) return null;
  const { rows } = await pool.query(
    "SELECT history, summary FROM conversation_memory WHERE user_id=$1 AND channel_id=$2",
    [userId, channelId]
  );
  if (!rows.length) return null;
  return { history: rows[0].history, summary: rows[0].summary };
}

/**
 * saveHistory() — Upserts a record.
 */
async function saveHistory(userId, channelId, { history, summary }) {
  if (!enabled) return;
  await pool.query(
    `INSERT INTO conversation_memory (user_id, channel_id, history, summary, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, channel_id) DO UPDATE
       SET history = EXCLUDED.history,
           summary = EXCLUDED.summary,
           updated_at = NOW()`,
    [userId, channelId, JSON.stringify(history), summary]
  );
}

/**
 * deleteHistory() — Hard delete of a user's record for a channel.
 */
async function deleteHistory(userId, channelId) {
  if (!enabled) return;
  await pool.query(
    "DELETE FROM conversation_memory WHERE user_id=$1 AND channel_id=$2",
    [userId, channelId]
  );
}

function isEnabled() {
  return enabled;
}

module.exports = { initialize, loadHistory, saveHistory, deleteHistory, isEnabled };
