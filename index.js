/**
 * src/index.js — Entry Point
 *
 * Bootstraps the bot: loads env, initializes the Discord client,
 * registers all event listeners, and starts the login sequence.
 */

require("dotenv").config();
const { createBot } = require("./src/bot");
const logger = require("./src/utils/logger");

// Validate required environment variables before doing anything else.
const REQUIRED_ENV = ["DISCORD_TOKEN", "OPENAI_API_KEY"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  logger.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

// Unhandled rejection guard — keeps the process from silently dying.
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception:", err);
  process.exit(1);
});

// Boot the bot.
(async () => {
  try {
    const client = await createBot();
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    logger.error("Failed to start bot:", err);
    process.exit(1);
  }
})();
