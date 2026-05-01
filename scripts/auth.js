const play = require("play-dl");

(async () => {
  try {
    console.log("Starting YouTube authentication...");
    await play.authorization();
    console.log("✓ Authentication successful! youtube.data.json created.");
  } catch (err) {
    console.error("Authentication failed:", err.message);
    process.exit(1);
  }
})();
