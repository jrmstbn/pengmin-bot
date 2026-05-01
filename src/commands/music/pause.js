/**
 * src/commands/music/pause.js — Pause Command
 *
 * Pauses the current song playback.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createErrorEmbed, createInfoEmbed } = require("../../music/musicUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the current song."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const state = musicManager.getState(guildId);

    if (!state.currentTrack) {
      return interaction.reply({
        embeds: [createErrorEmbed("No song is currently playing.")],
        ephemeral: true,
      });
    }

    if (state.isPaused) {
      return interaction.reply({
        embeds: [createErrorEmbed("The song is already paused.")],
        ephemeral: true,
      });
    }

    const paused = musicManager.pause(guildId);

    if (paused) {
      return interaction.reply({
        embeds: [createInfoEmbed("⏸️ Paused", `**${state.currentTrack.title}** is now paused.`)],
      });
    }

    return interaction.reply({
      embeds: [createErrorEmbed("Failed to pause the song.")],
      ephemeral: true,
    });
  },
};
