/**
 * src/commands/music/leave.js — Leave Command
 *
 * Disconnects the bot from the voice channel.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createInfoEmbed, createErrorEmbed } = require("../../music/musicUtils");

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
        ephemeral: true,
      });
    }

    musicManager.leaveVoice(guildId);

    return interaction.reply({
      embeds: [createInfoEmbed("👋 Left", "Disconnected from the voice channel.")],
    });
  },
};
