/**
 * src/commands/music/resume.js — Resume Command
 *
 * Resumes paused song playback.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createErrorEmbed, createInfoEmbed } = require("../../music/musicUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume the paused song."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const state = musicManager.getState(guildId);

    if (!state.currentTrack) {
      return interaction.reply({
        embeds: [createErrorEmbed("No song is currently playing.")],
        flags: 64,
      });
    }

    if (!state.isPaused) {
      return interaction.reply({
        embeds: [createErrorEmbed("The song is already playing.")],
        flags: 64,
      });
    }

    const resumed = musicManager.resume(guildId);

    if (resumed) {
      return interaction.reply({
        embeds: [createInfoEmbed("▶️ Resumed", `**${state.currentTrack.title}** is now playing.`)],
      });
    }

    return interaction.reply({
      embeds: [createErrorEmbed("Failed to resume the song.")],
      flags: 64,
    });
  },
};
