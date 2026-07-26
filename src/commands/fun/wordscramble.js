/**
 * src/commands/fun/wordscramble.js — /wordscramble command
 *
 * AI generates a word, its scrambled version, and a cryptic hint.
 * Player(s) type the answer via message collector.
 *
 * PvAI: one player has 60s. Can request one hint.
 * PvP:  race — first to type the correct answer wins.
 */

const { SlashCommandBuilder, ButtonStyle } = require("discord.js");
const logger = require("../../utils/logger");
const { chat } = require("../../ai/aiService");
const { buildSystemPrompt } = require("../../ai/prompts");
const {
  checkAndLock, unlock,
  generateCommentary,
  awaitOpponentAccept,
  buildGameEmbed, buildResultEmbed,
  buildChoiceRow, buildDisabledRow,
  makeButtonId, newSessionId,
} = require("./gameUtils");

const TIMEOUT_MS = 60_000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("wordscramble")
    .setDescription("Unscramble the word before time runs out.")
    .addStringOption((opt) =>
      opt.setName("mode")
        .setDescription("PvAI (default) or PvP")
        .addChoices({ name: "PvAI — vs the Bot", value: "pvai" }, { name: "PvP — vs a Friend", value: "pvp" })
    )
    .addUserOption((opt) =>
      opt.setName("opponent").setDescription("Opponent for PvP mode")
    ),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: "`*This command requires a server context.*`", flags: 64 });
    }

    const mode = interaction.options.getString("mode") ?? "pvai";
    const opponentUser = interaction.options.getUser("opponent");
    const channelId = interaction.channelId;
    const challengerId = interaction.user.id;

    if (mode === "pvp" && opponentUser?.id === challengerId) {
      return interaction.reply({ content: "`*You cannot challenge yourself.*`", flags: 64 });
    }
    if (mode === "pvp" && !opponentUser) {
      return interaction.reply({ content: "`*PvP mode requires an opponent.*`", flags: 64 });
    }

    if (!checkAndLock(channelId)) {
      return interaction.reply({ content: "`*A game session is already active in this channel.*`", flags: 64 });
    }

    await interaction.deferReply();

    try {
      // Generate word via AI
      const { name: personaName, persona, context } = await require("../../ai/personaManager").getActivePersona(interaction.guildId);
      const wordData = await generateWordData({ persona, context });

      if (!wordData) {
        await interaction.editReply("`*Failed to generate a scramble. Protocol error.*`");
        return;
      }

      const { word, scrambled, hint } = wordData;

      // PvP invitation
      if (mode === "pvp") {
        const result = await awaitOpponentAccept(interaction, challengerId, opponentUser.id, "Word Scramble");
        if (result !== "accepted") {
          await interaction.followUp(result === "declined" ? "`*Challenge declined.*`" : "`*Challenge timed out.*`");
          return;
        }
      }

      const sessionId = newSessionId();
      const hintId = makeButtonId("scramble", sessionId, "hint");
      let hintUsed = false;

      const hintRow = buildChoiceRow([{ label: "Get Hint", emoji: "💡", customId: hintId, style: ButtonStyle.Secondary }]);

      const gameEmbed = buildGameEmbed({
        title: "⟨ Protocol Lexical Decryption ⟩",
        description:
          `**Unscramble this word:**\n\n` +
          `# \`${scrambled.toUpperCase()}\`\n\n` +
          (mode === "pvp"
            ? `${interaction.user.displayName} vs ${opponentUser.displayName} — first correct answer wins`
            : "Type your answer in chat."),
        footer: `${Math.round(TIMEOUT_MS / 1000)}s remaining`,
      });

      const gameMessage = await interaction.editReply({ embeds: [gameEmbed], components: [hintRow] });

      const players = mode === "pvp" ? [challengerId, opponentUser.id] : [challengerId];
      let winner = null;

      // Button collector for hint
      const hintCollector = gameMessage.createMessageComponentCollector({
        filter: (i) => players.includes(i.user.id) && i.customId === hintId,
        time: TIMEOUT_MS,
        max: 1,
      });

      hintCollector.on("collect", async (i) => {
        await i.deferUpdate();
        hintUsed = true;
        const updatedEmbed = buildGameEmbed({
          title: "⟨ Protocol Lexical Decryption ⟩",
          description:
            `**Unscramble this word:**\n\n` +
            `# \`${scrambled.toUpperCase()}\`\n\n` +
            `**Hint:** *${hint}*`,
          footer: "Hint used.",
        });
        const disabledHint = buildDisabledRow(hintRow);
        await gameMessage.edit({ embeds: [updatedEmbed], components: [disabledHint] }).catch(() => {});
      });

      // Message collector for answers
      await new Promise((resolve) => {
        const collector = interaction.channel.createMessageCollector({
          filter: (m) => players.includes(m.author.id) && !m.author.bot,
          time: TIMEOUT_MS,
        });

        collector.on("collect", (m) => {
          if (m.content.trim().toLowerCase() === word.toLowerCase()) {
            winner = m.author.id;
            collector.stop("correct");
            hintCollector.stop("game_over");
          }
        });

        collector.on("end", () => resolve());
      });

      // Build result
      const disabledHintRow = buildDisabledRow(hintRow);

      if (winner) {
        const isChallenger = winner === challengerId;
        const winnerName = isChallenger ? interaction.user.displayName : opponentUser?.displayName ?? "Unknown";
        const commentPrompt = `Word Scramble: word was "${word}". ${winnerName} solved it${hintUsed ? " with hint" : ""}.`;
        const commentary = await generateCommentary(interaction.guildId, commentPrompt, "win");

        const resultEmbed = buildResultEmbed({
          title: mode === "pvp" ? `🏆 ${winnerName} wins!` : "✅ Correct!",
          description: `The word was **${word}**.\n\n*${commentary}*`,
          outcome: "win",
        });
        await gameMessage.edit({ embeds: [resultEmbed], components: [disabledHintRow] });

      } else {
        const commentPrompt = `Word Scramble: word was "${word}". No one solved it in time.`;
        const commentary = await generateCommentary(interaction.guildId, commentPrompt, "loss");

        const resultEmbed = buildResultEmbed({
          title: "⏱️ Time's Up.",
          description: `The word was **${word}**.\n\n*${commentary}*`,
          outcome: "loss",
        });
        await gameMessage.edit({ embeds: [resultEmbed], components: [disabledHintRow] });
      }

    } catch (err) {
      logger.error("[WordScramble] Error:", err);
      await interaction.followUp({ content: "`*Protocol disruption. Session terminated.*`", flags: 64 }).catch(() => {});
    } finally {
      unlock(channelId);
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateWordData({ persona, context }) {
  const systemPrompt = buildSystemPrompt({ persona, context });
  const prompt =
    `Generate a single word and a scrambled version of it for a word puzzle. ` +
    `Also write a short cryptic hint (1 sentence, in character). ` +
    `Reply with ONLY valid JSON, no markdown:\n` +
    `{"word":"example","scrambled":"axpelme","hint":"It describes something used to show how something is done."}`;

  try {
    const raw = await chat([{ role: "user", content: prompt }], systemPrompt);
    const cleaned = raw.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.word || !parsed.scrambled || !parsed.hint) return null;
    // Basic validation: scrambled must be same length as word
    if (parsed.scrambled.length !== parsed.word.length) return null;
    return parsed;
  } catch (err) {
    logger.warn("[WordScramble] Generation failed:", err.message);
    return null;
  }
}
