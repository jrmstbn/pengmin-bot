/**
 * src/commands/fun/coinflip.js — /coinflip command
 *
 * Flip a coin with AI-delivered in-character commentary.
 * PvAI: player picks heads/tails, coin flips, result shown.
 * PvP:  both players pick independently, coin flips after both pick (or timeout),
 *       winner = player whose pick matches the flip. Draw if both or neither match.
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
const SIDES = ["heads", "tails"];
const SIDE_EMOJI = { heads: "🟡", tails: "⚪" };

function flipCoin() {
  return Math.random() < 0.5 ? "heads" : "tails";
}

function resolveCoinflip(p1pick, p2pick, flipResult) {
  const p1match = p1pick === flipResult;
  const p2match = p2pick === flipResult;
  if (p1match && p2match) return "draw";
  if (!p1match && !p2match) return "draw";
  if (p1match) return "p1";
  return "p2";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flip a coin. The Protocol Network does not believe in luck.")
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
        const result = await awaitOpponentAccept(interaction, challengerId, opponentUser.id, "Coin Flip");
        if (result !== "accepted") {
          await interaction.followUp(result === "declined" ? "`*Challenge declined.*`" : "`*Challenge timed out.*`");
          return;
        }
      }

      const sessionId = newSessionId();
      const buttonIds = SIDES.map((s) => makeButtonId("coin", sessionId, s));

      const choiceRow = buildChoiceRow([
        { label: "Heads", emoji: SIDE_EMOJI.heads, customId: buttonIds[0], style: ButtonStyle.Primary },
        { label: "Tails", emoji: SIDE_EMOJI.tails, customId: buttonIds[1], style: ButtonStyle.Secondary },
      ]);

      const footerText = mode === "pvp"
        ? `${interaction.user.displayName} vs ${opponentUser?.displayName} — 30s`
        : `${interaction.user.displayName} — 30s`;

      const gameEmbed = buildGameEmbed({
        title: "⟨ Protocol Probability Arbitration ⟩",
        description: mode === "pvp"
          ? "Both operators: choose your side. The coin will flip when both have picked."
          : "Choose your side. Probability is immutable.",
        footer: footerText,
      });

      const gameMessage = await interaction.editReply({ embeds: [gameEmbed], components: [choiceRow] });
      const picks = new Map(); // userId → side

      if (mode === "pvai") {
        await new Promise((resolve) => {
          const collector = gameMessage.createMessageComponentCollector({
            filter: (i) => i.user.id === challengerId && buttonIds.includes(i.customId),
            time: TIMEOUT_MS,
            max: 1,
          });
          collector.on("collect", async (i) => {
            await i.deferUpdate();
            picks.set(challengerId, SIDES[buttonIds.indexOf(i.customId)]);
            resolve();
          });
          collector.on("end", () => resolve());
        });

        const playerPick = picks.get(challengerId);
        const flipResult = flipCoin();
        const won = playerPick === flipResult;
        const outcome = playerPick ? (won ? "win" : "loss") : "default";

        const commentPrompt = playerPick
          ? `Coin flip: player chose ${playerPick}, coin landed ${flipResult}. Player ${won ? "won" : "lost"}.`
          : `Coin flip: player did not pick in time. Coin landed ${flipResult}.`;
        const commentary = await generateCommentary(interaction.guildId, commentPrompt, outcome);
        const disabledRow = buildDisabledRow(choiceRow);

        const title = playerPick
          ? (won ? "🏆 Correct Call." : "💀 Wrong Side.")
          : "⏱️ No pick.";

        const resultEmbed = buildResultEmbed({
          title,
          description:
            `The coin landed: **${SIDE_EMOJI[flipResult]} ${flipResult.toUpperCase()}**\n` +
            (playerPick ? `You picked: **${SIDE_EMOJI[playerPick]} ${playerPick.toUpperCase()}**\n` : "") +
            `\n*${commentary}*`,
          outcome,
        });

        await gameMessage.edit({ embeds: [resultEmbed], components: [disabledRow] });

      } else {
        // PvP — collect both picks
        const players = [challengerId, opponentUser.id];

        await new Promise((resolve) => {
          const collector = gameMessage.createMessageComponentCollector({
            filter: (i) => players.includes(i.user.id) && buttonIds.includes(i.customId),
            time: TIMEOUT_MS,
          });
          collector.on("collect", async (i) => {
            await i.deferUpdate();
            if (!picks.has(i.user.id)) {
              picks.set(i.user.id, SIDES[buttonIds.indexOf(i.customId)]);
              const waiting = buildGameEmbed({
                title: "⟨ Protocol Probability Arbitration ⟩",
                description: `Picks received: **${picks.size}/2**\n\nWaiting...`,
                footer: footerText,
              });
              await gameMessage.edit({ embeds: [waiting], components: [choiceRow] }).catch(() => {});
            }
            if (picks.size >= 2) collector.stop("both_picked");
          });
          collector.on("end", () => resolve());
        });

        const p1pick = picks.get(challengerId);
        const p2pick = picks.get(opponentUser.id);
        const flipResult = flipCoin();
        const resolution = resolveCoinflip(p1pick ?? "none", p2pick ?? "none", flipResult);

        let titleText = "⚖️ Draw.";
        let outcome = "draw";
        if (resolution === "p1" || (!p2pick && p1pick)) {
          titleText = `🏆 ${interaction.user.displayName} wins!`;
          outcome = "win";
        } else if (resolution === "p2" || (!p1pick && p2pick)) {
          titleText = `🏆 ${opponentUser.displayName} wins!`;
        }

        const commentPrompt = `PvP Coin Flip: coin=${flipResult}. ${interaction.user.displayName} picked ${p1pick ?? "nothing"}, ${opponentUser.displayName} picked ${p2pick ?? "nothing"}. ${titleText.replace(/[🏆⚖️]/g, "").trim()}`;
        const commentary = await generateCommentary(interaction.guildId, commentPrompt, outcome);
        const disabledRow = buildDisabledRow(choiceRow);

        const resultEmbed = buildResultEmbed({
          title: titleText,
          description:
            `The coin landed: **${SIDE_EMOJI[flipResult]} ${flipResult.toUpperCase()}**\n\n` +
            `*${commentary}*`,
          outcome,
          fields: [
            { name: interaction.user.displayName, value: p1pick ? `${SIDE_EMOJI[p1pick]} ${p1pick}` : "*No pick*", inline: true },
            { name: opponentUser.displayName, value: p2pick ? `${SIDE_EMOJI[p2pick]} ${p2pick}` : "*No pick*", inline: true },
          ],
        });

        await gameMessage.edit({ embeds: [resultEmbed], components: [disabledRow] });
      }

    } catch (err) {
      logger.error("[CoinFlip] Error:", err);
      await interaction.followUp({ content: "`*Protocol disruption. Session terminated.*`", flags: 64 }).catch(() => {});
    } finally {
      unlock(channelId);
    }
  },
};
