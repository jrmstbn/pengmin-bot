/**
 * src/index.js — Entry Point
 *
 * Bootstraps the bot: loads env, initializes the Discord client,
 * registers all event listeners, and starts the login sequence.
 */

require("dotenv").config();
const http = require("http");
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
let botClient = null;

// ── Health check HTTP server ──────────────────────────────────────────────────
// Responds 200 on GET /health so uptime monitors (UptimeRobot, Railway, etc.)
// can confirm the process is alive. Disabled if HEALTH_PORT is set to "0".
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || "8080");
if (HEALTH_PORT > 0) {
  http
    .createServer((req, res) => {
      const isReady = botClient?.isReady() ?? false;
      res.writeHead(isReady ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: isReady ? "ok" : "starting" }));
    })
    .listen(HEALTH_PORT, () => {
      logger.info(`[Health] HTTP server listening on port ${HEALTH_PORT}`);
    });
}

(async () => {
  try {
    botClient = await createBot();
    await botClient.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    logger.error("Failed to start bot:", err);
    process.exit(1);
  }
})();

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Flush any pending state and disconnect cleanly on SIGTERM (Docker/PM2 stop)
// and SIGINT (Ctrl+C during development).
async function shutdown(signal) {
  logger.info(`[Shutdown] Received ${signal}. Shutting down gracefully...`);
  try {
    if (botClient) {
      // Let discord.js close the WebSocket connection cleanly.
      botClient.destroy();
      logger.info("[Shutdown] Discord client destroyed.");
    }
  } catch (err) {
    logger.error("[Shutdown] Error during cleanup:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
