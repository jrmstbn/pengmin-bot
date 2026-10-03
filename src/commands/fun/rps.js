/**
 * src/commands/fun/rps.js — /rps command
 *
 * Rock Paper Scissors with PvAI and PvP modes.
 * PvAI: player picks, bot picks randomly, result shown instantly.
 * PvP:  both players pick independently (hidden until both submit), then reveal.
 */

const { SlashCommandBuilder, ButtonStyle } = require("discord.js");
const logger = require("../../utils/logger");
const {
  checkAndLock, unlock,
  generateCommentary,
  awaitOpponentAccept,
  buildGameEmbed, buildResultEmbed,
  buildChoiceRow, buildDisabledRow,
  makeButtonId, newSessionId,
} = require("./gameUtils");

const TIMEOUT_MS = 30_000;
const MOVES = ["rock", "paper", "scissors"];
const MOVE_EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };
const MOVE_LABEL = { rock: "Rock", paper: "Paper", scissors: "Scissors" };

// Rock beats Scissors, Paper beats Rock, Scissors beats Paper
function resolveRps(p1, p2) {
  if (p1 === p2) return "draw";
  if (
    (p1 === "rock" && p2 === "scissors") ||
    (p1 === "paper" && p2 === "rock") ||
    (p1 === "scissors" && p2 === "paper")
  ) return "win";
  return "loss";
}

function pickBotMove() {
  return MOVES[Math.floor(Math.random() * 3)];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rps")
    .setDescription("Rock. Paper. Scissors. The Protocol Network arbitrates.")
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
      // PvP invitation
      if (mode === "pvp") {
        const result = await awaitOpponentAccept(interaction, challengerId, opponentUser.id, "Rock Paper Scissors");
        if (result !== "accepted") {
          await interaction.followUp(result === "declined"
            ? "`*Challenge declined.*`"
            : "`*Challenge timed out.*`");
          return;
        }
      }

      const sessionId = newSessionId();
      const buttonIds = MOVES.map((m) => makeButtonId("rps", sessionId, m));

      const choiceRow = buildChoiceRow(
        MOVES.map((m, i) => ({
          label: MOVE_LABEL[m],
          emoji: MOVE_EMOJI[m],
          customId: buttonIds[i],
          style: ButtonStyle.Secondary,
        }))
      );

      const footerText = mode === "pvp"
        ? `${interaction.user.displayName} vs ${opponentUser?.displayName} — 30s`
        : `${interaction.user.displayName} — 30s`;

      const gameEmbed = buildGameEmbed({
        title: "⟨ Protocol RPS Arbitration ⟩",
        description: mode === "pvp"
          ? "Both operators must choose their move. Picks are hidden until both submit."
          : "Choose your move. The Protocol Network will respond.",
        footer: footerText,
      });

      const gameMessage = await interaction.editReply({ embeds: [gameEmbed], components: [choiceRow] });
      const picks = new Map(); // userId → move

      if (mode === "pvai") {
        // Single collector
        await new Promise((resolve) => {
          const collector = gameMessage.createMessageComponentCollector({
            filter: (i) => i.user.id === challengerId && buttonIds.includes(i.customId),
            time: TIMEOUT_MS,
            max: 1,
          });
          collector.on("collect", async (i) => {
            picks.set(challengerId, MOVES[buttonIds.indexOf(i.customId)]);
            await i.deferUpdate().catch(() => {});
            // Stop after picking — 'end' will fire and resolve
            collector.stop("picked");
          });
          // 'end' always fires after collect or timeout — resolve here only
          collector.on("end", () => resolve());
        });

        const playerMove = picks.get(challengerId);
        const botMove = pickBotMove();
        const outcome = playerMove ? resolveRps(playerMove, botMove) : "loss";

        const commentPrompt = playerMove
          ? `RPS result: player chose ${playerMove}, bot chose ${botMove}. Player ${outcome === "win" ? "won" : outcome === "loss" ? "lost" : "drew"}.`
          : `RPS result: player did not pick in time. Bot chose ${botMove}.`;

        const commentary = await generateCommentary(interaction.guildId, commentPrompt, outcome);
        const disabledRow = buildDisabledRow(choiceRow);

        const titleMap = { win: "🏆 You Win.", loss: "💀 You Lose.", draw: "⚖️ Draw." };
        const resultEmbed = buildResultEmbed({
          title: titleMap[outcome] ?? "⚖️ Result.",
          description:
            `${interaction.user.displayName}: **${playerMove ? `${MOVE_EMOJI[playerMove]} ${MOVE_LABEL[playerMove]}` : "*No pick*"}**\n` +
            `Bot: **${MOVE_EMOJI[botMove]} ${MOVE_LABEL[botMove]}**\n\n` +
            `*${commentary}*`,
          outcome,
        });

        await gameMessage.edit({ embeds: [resultEmbed], components: [disabledRow] });

      } else {
        // PvP — two independent collectors, hide picks until both done
        const players = [challengerId, opponentUser.id];

        await new Promise((resolve) => {
          const collector = gameMessage.createMessageComponentCollector({
            filter: (i) => players.includes(i.user.id) && buttonIds.includes(i.customId),
            time: TIMEOUT_MS,
          });
          collector.on("collect", async (i) => {
            await i.deferUpdate();
            if (!picks.has(i.user.id)) {
              picks.set(i.user.id, MOVES[buttonIds.indexOf(i.customId)]);
              // Update embed to show how many have picked (without revealing)
              const waiting = buildGameEmbed({
                title: "⟨ Protocol RPS Arbitration ⟩",
                description: `Picks received: **${picks.size}/2**\n\nWaiting for all operators to submit...`,
                footer: footerText,
              });
              await gameMessage.edit({ embeds: [waiting], components: [choiceRow] }).catch(() => {});
            }
            if (picks.size >= 2) collector.stop("both_picked");
          });
          collector.on("end", () => resolve());
        });

        const p1move = picks.get(challengerId);
        const p2move = picks.get(opponentUser.id);

        // Determine outcome from p1's perspective
        let outcome = "draw";
        let titleText = "⚖️ Draw.";
        if (p1move && p2move) {
          const res = resolveRps(p1move, p2move);
          if (res === "win") { outcome = "win"; titleText = `🏆 ${interaction.user.displayName} wins!`; }
          else if (res === "loss") { titleText = `🏆 ${opponentUser.displayName} wins!`; }
        } else if (p1move && !p2move) {
          outcome = "win"; titleText = `🏆 ${interaction.user.displayName} wins! (opponent forfeited)`;
        } else if (!p1move && p2move) {
          titleText = `🏆 ${opponentUser.displayName} wins! (challenger forfeited)`;
        }

        const commentPrompt = `PvP RPS: ${interaction.user.displayName} chose ${p1move ?? "nothing"}, ${opponentUser.displayName} chose ${p2move ?? "nothing"}. ${titleText.replace(/[🏆⚖️]/g, "").trim()}`;
        const commentary = await generateCommentary(interaction.guildId, commentPrompt, outcome);
        const disabledRow = buildDisabledRow(choiceRow);

        const resultEmbed = buildResultEmbed({
          title: titleText,
          description: `*${commentary}*`,
          outcome,
          fields: [
            {
              name: interaction.user.displayName,
              value: p1move ? `${MOVE_EMOJI[p1move]} ${MOVE_LABEL[p1move]}` : "*No pick*",
              inline: true,
            },
            {
              name: opponentUser.displayName,
              value: p2move ? `${MOVE_EMOJI[p2move]} ${MOVE_LABEL[p2move]}` : "*No pick*",
              inline: true,
            },
          ],
        });

        await gameMessage.edit({ embeds: [resultEmbed], components: [disabledRow] });
      }

    } catch (err) {
      logger.error("[RPS] Error:", err);
      await interaction.followUp({ content: "`*Protocol disruption. Session terminated.*`", flags: 64 }).catch(() => {});
    } finally {
      unlock(channelId);
    }
  },
};
