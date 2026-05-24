/**
 * src/commands/music/play.js — Play Command
 *
 * Interaction flow:
 *   1. deferReply() immediately (must be within Discord's 3s window)
 *   2. Register a per-guild one-shot callback via musicManager.setPendingCallback()
 *   3. Call musicManager.play() — DisTube fires playSong or addSong
 *   4. The central handler in musicManager dispatches to our callback → editReply()
 */

const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const musicManager = require("../../music/musicManager");
const {
  createNowPlayingEmbed,
  createAddedToQueueEmbed,
  createErrorEmbed,
} = require("../../music/musicUtils");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Search and play a song or add it to the queue.")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Song title, artist, lyrics, or YouTube URL.")
        .setRequired(true)
    ),

  async execute(interaction) {
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        embeds: [createErrorEmbed("You must be in a voice channel to play music.")],
        flags: 64,
      });
    }

    const botPermissions = voiceChannel.permissionsFor(interaction.guild.members.me);
    if (!botPermissions?.has(PermissionsBitField.Flags.Connect)) {
      return interaction.reply({
        embeds: [createErrorEmbed("I don't have permission to join that voice channel.")],
        flags: 64,
      });
    }
    if (!botPermissions?.has(PermissionsBitField.Flags.Speak)) {
      return interaction.reply({
        embeds: [createErrorEmbed("I don't have permission to speak in that voice channel.")],
        flags: 64,
      });
    }

    // Defer immediately — must happen within Discord's 3-second window
    await interaction.deferReply();

    const query = interaction.options.getString("query", true);
    const guildId = interaction.guildId;

    // Safety timeout — clears the callback if DisTube never fires within 15s
    const timeoutId = setTimeout(() => {
      musicManager.clearPendingCallback(guildId);
      interaction.editReply({
        embeds: [createErrorEmbed("Request timed out. Could not load the song.")],
      }).catch(() => {});
    }, 15_000);

    // Register one-shot callbacks — dispatched by the central handlers in musicManager
    musicManager.setPendingCallback(guildId, {
      onPlay: (queue, song) => {
        clearTimeout(timeoutId);
        interaction.editReply({
          embeds: [createNowPlayingEmbed({
            title: song.name,
            url: song.url,
            duration: song.duration,
            thumbnail: song.thumbnail,
            channel: song.uploader?.name ?? "Unknown",
            requesterName: song.member?.user?.username ?? interaction.user.username,
          })],
        }).catch(() => {});
      },

      onAdd: (queue, song) => {
        clearTimeout(timeoutId);
        const position = queue.songs.length - 1;
        interaction.editReply({
          embeds: [createAddedToQueueEmbed({
            title: song.name,
            url: song.url,
            duration: song.duration,
            thumbnail: song.thumbnail,
            channel: song.uploader?.name ?? "Unknown",
            requesterName: song.member?.user?.username ?? interaction.user.username,
          }, position)],
        }).catch(() => {});
      },

      onErr: (error) => {
        clearTimeout(timeoutId);
        logger.error(`DisTube play error [${guildId}]:`, error);
        interaction.editReply({
          embeds: [createErrorEmbed("Failed to play that song. Try a different search or URL.")],
        }).catch(() => {});
      },
    });

    try {
      await musicManager.play(voiceChannel, query, interaction.member, interaction.channel);
    } catch (err) {
      clearTimeout(timeoutId);
      musicManager.clearPendingCallback(guildId);
      logger.error(`Play command error [${guildId}]:`, err);
      interaction.editReply({
        embeds: [createErrorEmbed("An error occurred while processing your request.")],
      }).catch(() => {});
    }
  },
};
