/**
 * src/commands/music/volume.js — Volume Command
 *
 * Adjusts the playback volume (0-100).
 * DisTube uses 0-100 natively — no conversion needed.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createInfoEmbed, createErrorEmbed } = require("../../music/musicUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Adjust the playback volume.")
    .addIntegerOption((opt) =>
      opt
        .setName("level")
        .setDescription("Volume level (0-100).")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const level = interaction.options.getInteger("level", true);
    const state = musicManager.getState(guildId);

    if (!state.currentTrack) {
      return interaction.reply({
        embeds: [createErrorEmbed("No song is currently playing.")],
        flags: 64,
      });
    }

    // DisTube setVolume takes 0-100 directly
    const applied = musicManager.setVolume(guildId, level);

    if (!applied) {
      return interaction.reply({
        embeds: [createErrorEmbed("Failed to set volume.")],
        flags: 64,
      });
    }

    return interaction.reply({
      embeds: [createInfoEmbed("🔊 Volume", `Volume set to **${level}%**.`)],
    });
  },
};
