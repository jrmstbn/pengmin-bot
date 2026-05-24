/**
 * src/commands/music/stop.js — Stop Command
 *
 * Stops playback, clears the queue, and disconnects the bot.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createInfoEmbed, createErrorEmbed } = require("../../music/musicUtils");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const state = musicManager.getState(guildId);

    if (!state.connection) {
      return interaction.reply({
        embeds: [createErrorEmbed("The bot is not playing anything.")],
        flags: 64,
      });
    }

    try {
      await musicManager.stop(guildId);
      return interaction.reply({
        embeds: [createInfoEmbed("⏹️ Stopped", "Playback stopped and queue cleared.")],
      });
    } catch (err) {
      logger.error(`Stop command error:`, err);
      return interaction.reply({
        embeds: [createErrorEmbed("Failed to stop playback.")],
        flags: 64,
      });
    }
  },
};
