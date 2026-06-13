/**
 * src/commands/music/search.js — Search Command
 *
 * Shows the top 5 YouTube results for a query as a select menu,
 * letting the user pick before the bot starts playing.
 *
 * Flow:
 *   1. Run yt-dlp ytsearch5:<query> to get 5 candidates.
 *   2. Present them as a StringSelectMenu (ephemeral so only the user sees it).
 *   3. On selection, delegate to the same play logic used by /play.
 */

const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  PermissionsBitField,
  ComponentType,
} = require("discord.js");
const { execFile } = require("child_process");
const path = require("path");
const musicManager = require("../../music/musicManager");
const {
  createNowPlayingEmbed,
  createAddedToQueueEmbed,
  createErrorEmbed,
  formatDuration,
} = require("../../music/musicUtils");
const logger = require("../../utils/logger");

// Reuse the same yt-dlp binary path that musicManager uses.
const YTDLP_BIN = path.join(
  path.dirname(require.resolve("@distube/yt-dlp")),
  "..",
  "bin",
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
);

const RESULT_COUNT = 5;
const SELECT_TIMEOUT_MS = 30_000; // 30 s to pick before menu expires

/**
 * Runs yt-dlp ytsearch:<n>:<query> and returns up to n result objects.
 */
function searchYouTube(query, count) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP_BIN,
      [
        `ytsearch${count}:${query}`,
        "--dump-single-json",
        "--no-warnings",
        "--skip-download",
        "--simulate",
        "--quiet",
      ],
      { maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        try {
          const data = JSON.parse(stdout);
          // ytsearch returns a playlist-style wrapper with an entries array.
          resolve(data.entries ?? [data]);
        } catch (parseErr) {
          reject(new Error(`yt-dlp JSON parse failed: ${stdout.slice(0, 200)}`));
        }
      }
    );
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search YouTube and choose a song from the top results.")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Song title, artist, or lyrics to search for.")
        .setRequired(true)
        .setMaxLength(200)
    ),

  async execute(interaction) {
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        embeds: [createErrorEmbed("You must be in a voice channel to use /search.")],
        flags: 64,
      });
    }

    const botPermissions = voiceChannel.permissionsFor(interaction.guild.members.me);
    if (
      !botPermissions?.has(PermissionsBitField.Flags.Connect) ||
      !botPermissions?.has(PermissionsBitField.Flags.Speak)
    ) {
      return interaction.reply({
        embeds: [createErrorEmbed("I don't have permission to join or speak in that voice channel.")],
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: 64 }); // ephemeral — only the searcher sees it

    const query = interaction.options.getString("query", true);

    // ── Fetch results ─────────────────────────────────────────────────────
    let results;
    try {
      results = await searchYouTube(query, RESULT_COUNT);
    } catch (err) {
      logger.error(`[Search] yt-dlp search failed for "${query}":`, err.message);
      return interaction.editReply({
        embeds: [createErrorEmbed("Search failed. Try a different query or use `/play` directly.")],
      });
    }

    if (!results || results.length === 0) {
      return interaction.editReply({
        embeds: [createErrorEmbed("No results found. Try a different search term.")],
      });
    }

    // ── Build select menu ─────────────────────────────────────────────────
    const options = results.slice(0, RESULT_COUNT).map((entry, i) => {
      const title = (entry.title ?? "Unknown title").slice(0, 100);
      const channel = (entry.channel ?? entry.uploader ?? "Unknown").slice(0, 50);
      const duration = formatDuration(entry.duration ?? 0);
      const url = entry.webpage_url ?? entry.url ?? "";

      return new StringSelectMenuOptionBuilder()
        .setLabel(`${i + 1}. ${title}`)
        .setDescription(`${channel} • ${duration}`)
        .setValue(url);
    });

    const menu = new StringSelectMenuBuilder()
      .setCustomId("search_select")
      .setPlaceholder("Choose a song to play...")
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);

    const response = await interaction.editReply({
      content: `**Search results for:** \`${query}\`\nPick a song below (expires in ${SELECT_TIMEOUT_MS / 1000}s):`,
      components: [row],
    });

    // ── Await selection ───────────────────────────────────────────────────
    let selection;
    try {
      selection = await response.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === interaction.user.id,
        time: SELECT_TIMEOUT_MS,
      });
    } catch {
      // Timed out
      return interaction.editReply({
        content: "`*Selection window expired.*`",
        components: [],
      });
    }

    // Disable menu immediately to prevent double-clicks
    menu.setDisabled(true);
    await interaction.editReply({ components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => {});

    const selectedUrl = selection.values[0];
    const guildId = interaction.guildId;

    await selection.deferUpdate().catch(() => {});

    // ── Play the selected track ───────────────────────────────────────────
    const playTimeoutId = setTimeout(() => {
      musicManager.clearPendingCallback(guildId);
      interaction.editReply({
        content: "",
        embeds: [createErrorEmbed("Request timed out. Could not load the song.")],
        components: [],
      }).catch(() => {});
    }, 15_000);

    musicManager.setPendingCallback(guildId, {
      onPlay: (queue, song) => {
        clearTimeout(playTimeoutId);
        interaction.editReply({
          content: "",
          embeds: [createNowPlayingEmbed({
            title: song.name,
            url: song.url,
            duration: song.duration,
            thumbnail: song.thumbnail,
            channel: song.uploader?.name ?? "Unknown",
            requesterName: song.member?.user?.username ?? interaction.user.username,
          })],
          components: [],
        }).catch(() => {});
      },
      onAdd: (queue, song) => {
        clearTimeout(playTimeoutId);
        const position = queue.songs.length - 1;
        interaction.editReply({
          content: "",
          embeds: [createAddedToQueueEmbed({
            title: song.name,
            url: song.url,
            duration: song.duration,
            thumbnail: song.thumbnail,
            channel: song.uploader?.name ?? "Unknown",
            requesterName: song.member?.user?.username ?? interaction.user.username,
          }, position)],
          components: [],
        }).catch(() => {});
      },
      onErr: (error) => {
        clearTimeout(playTimeoutId);
        logger.error(`[Search] DisTube play error [${guildId}]:`, error);
        interaction.editReply({
          content: "",
          embeds: [createErrorEmbed("Failed to play that song. Try a different one.")],
          components: [],
        }).catch(() => {});
      },
    });

    try {
      await musicManager.play(voiceChannel, selectedUrl, interaction.member, interaction.channel);
    } catch (err) {
      clearTimeout(playTimeoutId);
      musicManager.clearPendingCallback(guildId);
      logger.error(`[Search] Play error [${guildId}]:`, err);
      interaction.editReply({
        content: "",
        embeds: [createErrorEmbed("An error occurred while processing your request.")],
        components: [],
      }).catch(() => {});
    }
  },
};
