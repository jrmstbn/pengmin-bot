/**
 * src/commands/music/play.js — Play Command
 *
 * Searches for a song by query (title, artist, lyrics, or URL) and plays it.
 * If a song is already playing, adds it to the queue.
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const {
  createAddedToQueueEmbed,
  createNowPlayingEmbed,
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
        ephemeral: true,
      });
    }

    const query = interaction.options.getString("query", true);
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const userName = interaction.user.username;

    await interaction.deferReply();

    try {
      // Search for the song
      logger.info(`Searching for: ${query}`);
      const trackInfo = await musicManager.search(query);

      if (!trackInfo) {
        return interaction.editReply({
          embeds: [createErrorEmbed(`No results found for "${query}".`)],
        });
      }

      // Join voice channel if not already connected
      const state = musicManager.getState(guildId);
      if (!state.connection || !state.player) {
        try {
          await musicManager.joinVoice(voiceChannel, guildId);
        } catch (err) {
          logger.error(`Failed to join voice channel:`, err);
          return interaction.editReply({
            embeds: [createErrorEmbed("Failed to join your voice channel.")],
          });
        }
      }

      // Create track object with metadata
      const track = {
        title: trackInfo.title,
        url: trackInfo.url,
        duration: trackInfo.duration,
        thumbnail: trackInfo.thumbnail,
        channel: trackInfo.channel,
        requesterId: userId,
        requesterName: userName,
        videoObject: trackInfo.videoObject,
      };

      // Add to queue
      const queueLength = state.queue.length;
      musicManager.addToQueue(guildId, track);

      // If nothing is playing, start playback
      if (!state.currentTrack) {
        // Setup auto-play for next tracks
        musicManager.setupAutoPlay(guildId, (nextTrack) => {
          if (nextTrack) {
            logger.info(`Auto-playing next track: ${nextTrack.title}`);
          }
        });

        const playingTrack = await musicManager.play(guildId);
        if (playingTrack) {
          return interaction.editReply({
            embeds: [createNowPlayingEmbed(playingTrack)],
          });
        }
      }

      // Song added to queue
      return interaction.editReply({
        embeds: [createAddedToQueueEmbed(track, queueLength + 1)],
      });
    } catch (err) {
      logger.error(`Play command error:`, err);
      return interaction.editReply({
        embeds: [createErrorEmbed("An error occurred while processing your request.")],
      });
    }
  },
};
