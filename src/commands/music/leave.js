/**
 * src/commands/music/leave.js — Leave Command
 *
 * Disconnects the bot from the voice channel.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createInfoEmbed, createErrorEmbed } = require("../../music/musicUtils");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Disconnect the bot from the voice channel."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const state = musicManager.getState(guildId);

    if (!state.connection) {
      return interaction.reply({
        embeds: [createErrorEmbed("The bot is not in a voice channel.")],
        flags: 64,
      });
    }

    try {
      await musicManager.leaveVoice(guildId);
      return interaction.reply({
        embeds: [createInfoEmbed("👋 Left", "Disconnected from the voice channel.")],
      });
    } catch (err) {
      logger.error(`Leave command error:`, err);
      return interaction.reply({
        embeds: [createErrorEmbed("Failed to disconnect.")],
        flags: 64,
      });
    }
  },
};
