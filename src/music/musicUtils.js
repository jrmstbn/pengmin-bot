/**
 * src/music/musicUtils.js — Music Utility Functions
 *
 * Helper functions for formatting embeds, duration strings, and error messages.
 */

const { EmbedBuilder } = require("discord.js");

/**
 * formatDuration()
 * Converts seconds to MM:SS or HH:MM:SS format.
 */
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return "0:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/**
 * createNowPlayingEmbed()
 * Creates a "now playing" embed.
 */
function createNowPlayingEmbed(track) {
  return new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle("🎵 Now Playing")
    .setDescription(`**${track.title}**`)
    .addFields(
      { name: "Channel", value: track.channel || "Unknown", inline: true },
      { name: "Duration", value: formatDuration(track.duration), inline: true },
      { name: "Requested by", value: track.requesterName || "Unknown", inline: true }
    )
    .setThumbnail(track.thumbnail || null)
    .setFooter({ text: "AIC Audio Relay" });
}

/**
 * createQueueEmbed()
 * Creates a queue display embed.
 */
function createQueueEmbed(currentTrack, queue) {
  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle("🎵 Music Queue");

  if (currentTrack) {
    embed.addFields({
      name: "Currently Playing",
      value: `**${currentTrack.title}** (${formatDuration(currentTrack.duration)})`,
      inline: false,
    });
  }

  if (queue.length === 0) {
    embed.addFields({
      name: "Queue",
      value: "Queue is empty.",
      inline: false,
    });
  } else {
    const queueList = queue
      .slice(0, 10)
      .map((track, i) => `${i + 1}. **${track.title}** (${formatDuration(track.duration)})`)
      .join("\n");

    embed.addFields({
      name: `Queue (${queue.length} songs)`,
      value: queueList,
      inline: false,
    });

    if (queue.length > 10) {
      embed.addFields({
        name: "And more...",
        value: `+${queue.length - 10} more songs`,
        inline: false,
      });
    }
  }

  embed.setFooter({ text: "AIC Audio Relay" });
  return embed;
}

/**
 * createAddedToQueueEmbed()
 * Creates an "added to queue" embed.
 */
function createAddedToQueueEmbed(track, position) {
  return new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle("✅ Added to Queue")
    .setDescription(`**${track.title}**`)
    .addFields(
      { name: "Channel", value: track.channel || "Unknown", inline: true },
      { name: "Duration", value: formatDuration(track.duration), inline: true },
      { name: "Position", value: `#${position}`, inline: true }
    )
    .setThumbnail(track.thumbnail || null)
    .setFooter({ text: "AIC Audio Relay" });
}

/**
 * createErrorEmbed()
 * Creates an error embed.
 */
function createErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("❌ Error")
    .setDescription(message)
    .setFooter({ text: "AIC Audio Relay" });
}

/**
 * createInfoEmbed()
 * Creates an info embed.
 */
function createInfoEmbed(title, message) {
  return new EmbedBuilder()
    .setColor(0x4e5058)
    .setTitle(title)
    .setDescription(message)
    .setFooter({ text: "AIC Audio Relay" });
}

module.exports = {
  formatDuration,
  createNowPlayingEmbed,
  createQueueEmbed,
  createAddedToQueueEmbed,
  createErrorEmbed,
  createInfoEmbed,
};
