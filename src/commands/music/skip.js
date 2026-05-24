/**
 * src/commands/music/skip.js — Skip Command
 *
 * Skips the current song and plays the next one in the queue.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createNowPlayingEmbed, createErrorEmbed, createInfoEmbed } = require("../../music/musicUtils");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song and play the next one."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const state = musicManager.getState(guildId);

    if (!state.currentTrack) {
      return interaction.reply({
        embeds: [createErrorEmbed("No song is currently playing.")],
        flags: 64,
      });
    }

    if (state.queue.length === 0) {
      // No next song — stop and leave
      try {
        await musicManager.stop(guildId);
      } catch (_) {}
      return interaction.reply({
        embeds: [createInfoEmbed("⏭️ Skipped", "No more songs in the queue.")],
      });
    }

    try {
      const nextSong = await musicManager.skip(guildId);
      if (nextSong) {
        return interaction.reply({
          embeds: [createNowPlayingEmbed({
            title: nextSong.name,
            url: nextSong.url,
            duration: nextSong.duration,
            thumbnail: nextSong.thumbnail,
            channel: nextSong.uploader?.name ?? "Unknown",
            requesterName: nextSong.member?.user?.username ?? "Unknown",
          })],
        });
      }
      return interaction.reply({
        embeds: [createInfoEmbed("⏭️ Skipped", "No more songs in the queue.")],
      });
    } catch (err) {
      logger.error(`Skip command error:`, err);
      return interaction.reply({
        embeds: [createErrorEmbed("Failed to skip the song.")],
        flags: 64,
      });
    }
  },
};
