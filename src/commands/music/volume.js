/**
 * src/commands/music/volume.js — Volume Command
 *
 * Adjusts the playback volume (0-100).
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
        ephemeral: true,
      });
    }

    if (!state.player || !state.player.state.resource) {
      return interaction.reply({
        embeds: [createErrorEmbed("Cannot adjust volume at this time.")],
        ephemeral: true,
      });
    }

    try {
      // Convert 0-100 to 0-1 scale for Discord.js
      const volume = level / 100;
      state.player.state.resource.volume.setVolume(volume);

      return interaction.reply({
        embeds: [createInfoEmbed("🔊 Volume", `Volume set to **${level}%**.`)],
      });
    } catch (err) {
      return interaction.reply({
        embeds: [createErrorEmbed("Failed to adjust volume.")],
        ephemeral: true,
      });
    }
  },
};
