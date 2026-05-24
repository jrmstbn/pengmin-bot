/**
 * scripts/auth.js — YouTube OAuth Helper
 *
 * Authenticates play-dl with YouTube and saves the session token to
 * .data/youtube.data — the same path play-dl reads from at startup.
 *
 * Run this once before starting the bot, and again whenever the bot
 * starts logging "Invalid URL" errors on valid YouTube links (expired session).
 *
 * Usage:
 *   node scripts/auth.js
 */

const path = require("path");
const play = require("play-dl");

(async () => {
  try {
    // Tell play-dl where to save (and later read) the token.
    // This must match the path used in index.js.
    play.setToken({
      useragent: ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)"],
    });

    console.log("Starting YouTube authentication...");
    console.log("play-dl will save the token to: .data/youtube.data\n");

    await play.authorization();

    console.log("\n✓ Authentication successful!");
    console.log("Token saved to .data/youtube.data");
    console.log("You can now start the bot with: npm start");
  } catch (err) {
    console.error("Authentication failed:", err.message);
    process.exit(1);
  }
})();
