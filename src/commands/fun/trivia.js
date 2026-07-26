/**
 * src/commands/fun/trivia.js — /trivia command
 *
 * AI generates a topic-specific trivia question with 4 options (A-D).
 * Supports PvAI and PvP modes. The active persona narrates the result.
 *
 * PvAI: one player answers within 30s.
 * PvP:  two players answer independently within 30s. First both answer,
 *       then reveal simultaneously. Win = correct answer (draw if both right).
 */

const { SlashCommandBuilder, ButtonStyle } = require("discord.js");
const { randomUUID } = require("crypto");
const logger = require("../../utils/logger");
const { chat } = require("../../ai/aiService");
const { buildSystemPrompt } = require("../../ai/prompts");
const { getActivePersona } = require("../../ai/personaManager");
const {
  checkAndLock, unlock,
  generateCommentary,
  awaitOpponentAccept,
  buildGameEmbed, buildResultEmbed,
  buildChoiceRow, buildDisabledRow,
  makeButtonId, newSessionId,
} = require("./gameUtils");

const ANSWER_TIMEOUT_MS = 30_000;
const LABELS = ["A", "B", "C", "D"];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("trivia")
    .setDescription("Test your knowledge. The Protocol Network is watching.")
    .addStringOption((opt) =>
      opt.setName("topic").setDescription("Topic for the question (e.g. science, history, anime)").setRequired(true)
    )
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
    const topic = interaction.options.getString("topic", true);
    const opponentUser = interaction.options.getUser("opponent");
    const channelId = interaction.channelId;
    const challengerId = interaction.user.id;

    // PvP self-invite guard
    if (mode === "pvp" && opponentUser?.id === challengerId) {
      return interaction.reply({ content: "`*You cannot challenge yourself. Designate a separate operator.*`", flags: 64 });
    }
    if (mode === "pvp" && !opponentUser) {
      return interaction.reply({ content: "`*PvP mode requires an opponent. Use the opponent option.*`", flags: 64 });
    }

    // Duplicate session guard
    if (!checkAndLock(channelId)) {
      return interaction.reply({ content: "`*A game session is already active in this channel.*`", flags: 64 });
    }

    await interaction.deferReply();

    try {
      // ── Generate question via AI ─────────────────────────────────────────
      const persona = await getActivePersona(interaction.guildId);
      const question = await generateTriviaQuestion(persona, topic);

      if (!question) {
        await interaction.editReply("`*Failed to generate a trivia question. Protocol error.*`");
        return;
      }

      // ── PvP invitation ───────────────────────────────────────────────────
      if (mode === "pvp") {
        const result = await awaitOpponentAccept(interaction, challengerId, opponentUser.id, "Trivia");
        if (result !== "accepted") {
          const msg = result === "declined"
            ? "`*Challenge declined. The operator refused to engage.*`"
            : "`*Challenge timed out. No response received.*`";
          await interaction.followUp(msg);
          return;
        }
      }

      // ── Build game embed ─────────────────────────────────────────────────
      const sessionId = newSessionId();
      const buttonIds = LABELS.map((l) => makeButtonId("trivia", sessionId, l));

      const choiceRow = buildChoiceRow(
        LABELS.map((label, i) => ({
          label,
          customId: buttonIds[i],
          style: ButtonStyle.Primary,
        }))
      );

      const gameEmbed = buildGameEmbed({
        title: "⟨ Protocol Trivia Calibration ⟩",
        description:
          `**Topic:** ${topic}\n\n` +
          `**${question.question}**\n\n` +
          LABELS.map((l) => `**${l}.** ${question.options[l]}`).join("\n"),
        footer: mode === "pvp"
          ? `${interaction.user.displayName} vs ${opponentUser.displayName} — 30s`
          : `${interaction.user.displayName} — 30s`,
      });

      const gameMessage = await interaction.editReply({
        embeds: [gameEmbed],
        components: [choiceRow],
      });

      // ── Collect answers ──────────────────────────────────────────────────
      const picks = new Map(); // userId → label

      if (mode === "pvai") {
        await collectSingleAnswer(gameMessage, challengerId, buttonIds, picks, ANSWER_TIMEOUT_MS);
      } else {
        await collectPvpAnswers(gameMessage, [challengerId, opponentUser.id], buttonIds, picks, ANSWER_TIMEOUT_MS);
      }

      // ── Resolve and display result ───────────────────────────────────────
      const disabledRow = buildDisabledRow(choiceRow);

      if (mode === "pvai") {
        const picked = picks.get(challengerId);
        const correct = picked === question.answer;
        const outcome = correct ? "win" : "loss";
        const commentPrompt = `Trivia result: topic=${topic}. Player ${correct ? "answered correctly" : "answered incorrectly"}. Correct answer was ${question.answer}.`;
        const commentary = await generateCommentary(interaction.guildId, commentPrompt, outcome);

        const resultEmbed = buildResultEmbed({
          title: correct ? "✅ Correct." : "❌ Incorrect.",
          description:
            `The answer was **${question.answer}. ${question.options[question.answer]}**\n\n` +
            (picked ? `You selected: **${picked}**\n\n` : `*No answer submitted.*\n\n`) +
            `*${commentary}*`,
          outcome,
        });

        await gameMessage.edit({ embeds: [resultEmbed], components: [disabledRow] });

      } else {
        // PvP resolution
        const p1pick = picks.get(challengerId);
        const p2pick = picks.get(opponentUser.id);
        const p1correct = p1pick === question.answer;
        const p2correct = p2pick === question.answer;

        let outcome = "draw";
        let resultTitle = "⚖️ Draw.";
        if (p1correct && !p2correct) { outcome = "win"; resultTitle = `🏆 ${interaction.user.displayName} wins!`; }
        if (!p1correct && p2correct) { outcome = "win"; resultTitle = `🏆 ${opponentUser.displayName} wins!`; }

        const commentPrompt = `PvP Trivia: topic=${topic}. ${resultTitle.replace(/[⚖️🏆]/g, "").trim()} Correct answer: ${question.answer}.`;
        const commentary = await generateCommentary(interaction.guildId, commentPrompt, outcome);

        const resultEmbed = buildResultEmbed({
          title: resultTitle,
          description: `The answer was **${question.answer}. ${question.options[question.answer]}**\n\n*${commentary}*`,
          outcome,
          fields: [
            { name: interaction.user.displayName, value: p1pick ? `Selected **${p1pick}** — ${p1correct ? "✅ Correct" : "❌ Wrong"}` : "*No answer*", inline: true },
            { name: opponentUser.displayName, value: p2pick ? `Selected **${p2pick}** — ${p2correct ? "✅ Correct" : "❌ Wrong"}` : "*No answer*", inline: true },
          ],
        });

        await gameMessage.edit({ embeds: [resultEmbed], components: [disabledRow] });
      }

    } catch (err) {
      logger.error("[Trivia] Error:", err);
      await interaction.followUp({ content: "`*Protocol disruption. Session terminated.*`", flags: 64 }).catch(() => {});
    } finally {
      unlock(channelId);
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateTriviaQuestion(persona, topic) {
  const systemPrompt = buildSystemPrompt({ persona: persona.persona, context: persona.context });
  const prompt =
    `Generate a trivia question about "${topic}". ` +
    `Reply with ONLY valid JSON, no markdown:\n` +
    `{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A"}`;

  try {
    const raw = await chat([{ role: "user", content: prompt }], systemPrompt);
    // Strip any markdown code fences if present
    const cleaned = raw.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.question || !parsed.options?.A || !parsed.answer) return null;
    if (!LABELS.includes(parsed.answer)) return null;
    return parsed;
  } catch (err) {
    logger.warn("[Trivia] Question generation failed:", err.message);
    return null;
  }
}

async function collectSingleAnswer(message, userId, buttonIds, picks, timeout) {
  return new Promise((resolve) => {
    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === userId && buttonIds.includes(i.customId),
      time: timeout,
      max: 1,
    });
    collector.on("collect", async (i) => {
      await i.deferUpdate();
      const label = LABELS[buttonIds.indexOf(i.customId)];
      picks.set(userId, label);
      resolve();
    });
    collector.on("end", () => resolve());
  });
}

async function collectPvpAnswers(message, [p1Id, p2Id], buttonIds, picks, timeout) {
  return new Promise((resolve) => {
    const collector = message.createMessageComponentCollector({
      filter: (i) => [p1Id, p2Id].includes(i.user.id) && buttonIds.includes(i.customId),
      time: timeout,
    });
    collector.on("collect", async (i) => {
      await i.deferUpdate();
      if (!picks.has(i.user.id)) {
        const label = LABELS[buttonIds.indexOf(i.customId)];
        picks.set(i.user.id, label);
      }
      if (picks.size >= 2) collector.stop("both_answered");
    });
    collector.on("end", () => resolve());
  });
}
