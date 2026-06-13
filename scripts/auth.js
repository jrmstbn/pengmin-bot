/**
 * scripts/auth.js — YouTube OAuth Helper (Legacy)
 *
 * NOTE: This script was used when the bot relied on play-dl for YouTube
 * playback. The bot now uses @distube/yt-dlp, which does NOT require OAuth
 * authentication. You do not need to run this script for normal operation.
 *
 * It is kept here for reference in case you switch back to play-dl or need
 * to authenticate a play-dl instance for a different use case.
 *
 * Usage (only if using play-dl):
 *   node scripts/auth.js
 *
 * play-dl will save the token to .data/youtube.data, which it reads at startup.
 * Re-run if you see "Invalid URL" errors on valid YouTube links (expired session).
 */

const play = require("play-dl");

(async () => {
  try {
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
