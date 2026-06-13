require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

(async () => {
  const { rows: tables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );

  if (tables.length === 0) {
    console.log("No tables yet — will be auto-created on first bot start.");
  } else {
    console.log("Tables:", tables.map((t) => t.table_name).join(", "));
  }

  const hasMemory = tables.some((t) => t.table_name === "conversation_memory");
  if (hasMemory) {
    const { rows } = await pool.query("SELECT COUNT(*) AS rows FROM conversation_memory");
    console.log("conversation_memory rows:", rows[0].rows);
  } else {
    console.log("conversation_memory: not yet created (will be on bot start)");
  }

  await pool.end();
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
