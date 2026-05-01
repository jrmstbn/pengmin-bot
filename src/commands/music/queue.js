/**
 * src/commands/music/queue.js — Queue Command
 *
 * Displays the current music queue.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createQueueEmbed } = require("../../music/musicUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Display the current music queue."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const state = musicManager.getState(guildId);

    const embed = createQueueEmbed(state.currentTrack, state.queue);

    return interaction.reply({
      embeds: [embed],
    });
  },
};
