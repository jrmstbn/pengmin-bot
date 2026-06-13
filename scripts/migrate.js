/**
 * scripts/migrate.js — One-time DB migration
 *
 * Run this once after pulling these changes to:
 *   1. Create the new `personas` table
 *   2. Add the `guild_id` column to `conversation_memory` and migrate
 *      existing rows from channel_id → guild_id (best-effort, sets guild_id
 *      to the old channel_id value since we can't recover the original guild)
 *   3. Recreate the primary key on conversation_memory
 *
 * Safe to run multiple times — all operations are idempotent.
 *
 * Usage:
 *   node scripts/migrate.js
 */

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "false" ? false : process.env.DB_SSL === "no-verify" ? { rejectUnauthorized: false } : true,
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("1/4  Checking conversation_memory schema...");

    // Check if guild_id column already exists
    const { rows: cols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'conversation_memory'
    `);
    const colNames = cols.map((c) => c.column_name);

    if (!colNames.includes("guild_id")) {
      console.log("     Adding guild_id column and migrating data...");

      // Add guild_id, copy channel_id values into it (best-effort migration)
      await client.query(`ALTER TABLE conversation_memory ADD COLUMN IF NOT EXISTS guild_id TEXT`);
      await client.query(`UPDATE conversation_memory SET guild_id = channel_id WHERE guild_id IS NULL`);
      await client.query(`ALTER TABLE conversation_memory ALTER COLUMN guild_id SET NOT NULL`);

      // Drop old PK and column, recreate with new PK
      await client.query(`ALTER TABLE conversation_memory DROP CONSTRAINT IF EXISTS conversation_memory_pkey`);
      await client.query(`ALTER TABLE conversation_memory DROP COLUMN IF EXISTS channel_id`);
      await client.query(`ALTER TABLE conversation_memory ADD PRIMARY KEY (user_id, guild_id)`);
      console.log("     conversation_memory migrated.");
    } else {
      console.log("     guild_id column already exists — skipping.");
    }

    console.log("2/4  Creating personas table if not exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS personas (
        guild_id   TEXT        NOT NULL,
        name       TEXT        NOT NULL,
        persona    TEXT        NOT NULL DEFAULT '',
        context    TEXT        NOT NULL DEFAULT '',
        is_active  BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, name)
      )
    `);

    console.log("3/4  Verifying indexes...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_personas_guild_active
      ON personas (guild_id, is_active)
      WHERE is_active = TRUE
    `);

    await client.query("COMMIT");
    console.log("4/4  Migration complete.");

    // Print current table state
    const { rows: tables } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    console.log("\nTables:", tables.map((t) => t.table_name).join(", "));

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed — rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
