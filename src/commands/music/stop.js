/**
 * src/commands/music/stop.js — Stop Command
 *
 * Stops playback and clears the queue.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createInfoEmbed } = require("../../music/musicUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue."),

  async execute(interaction) {
    const guildId = interaction.guildId;

    musicManager.stop(guildId);
    musicManager.leaveVoice(guildId);

    return interaction.reply({
      embeds: [createInfoEmbed("⏹️ Stopped", "Playback stopped and queue cleared.")],
    });
  },
};
