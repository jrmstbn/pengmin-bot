/**
 * src/commands/music/nowplaying.js — Now Playing Command
 *
 * Displays the currently playing song.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createNowPlayingEmbed, createErrorEmbed } = require("../../music/musicUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Display the currently playing song."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const currentTrack = musicManager.getCurrentTrack(guildId);

    if (!currentTrack) {
      return interaction.reply({
        embeds: [createErrorEmbed("No song is currently playing.")],
        flags: 64,
      });
    }

    const embed = createNowPlayingEmbed(currentTrack);

    return interaction.reply({
      embeds: [embed],
    });
  },
};
