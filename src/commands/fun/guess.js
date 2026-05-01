/**
 * commands/fun/guess.js
 * A simple number-guessing mini-game using Discord message collectors.
 *
 * Architecture note: Game state is ephemeral (in the closure).
 * For persistent/multi-round games, move state to memoryManager.
 */

const { SlashCommandBuilder } = require("discord.js");

// Track active games per channel to prevent duplicates.
const activeGames = new Set();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("guess")
    .setDescription("Initiate a Protocol Number Calibration test.")
    .addIntegerOption((opt) =>
      opt
        .setName("max")
        .setDescription("Upper bound for the secret number (default: 100).")
        .setMinValue(10)
        .setMaxValue(1000)
    ),

  async execute(interaction) {
    const channelId = interaction.channelId;

    if (activeGames.has(channelId)) {
      return interaction.reply({
        content: "`*A calibration sequence is already active in this channel.*`",
        ephemeral: true,
      });
    }

    const max = interaction.options.getInteger("max") ?? 100;
    const secret = Math.floor(Math.random() * max) + 1;
    const maxAttempts = 7;
    let attempts = 0;

    activeGames.add(channelId);

    await interaction.reply(
      `**⟨ Protocol Calibration Initiated ⟩**\n` +
        `I have selected a number between **1** and **${max}**.\n` +
        `You have **${maxAttempts}** attempts. Type your guess.\n` +
        `\`*Awaiting input...*\``
    );

    const filter = (m) =>
      m.author.id === interaction.user.id && /^\d+$/.test(m.content.trim());

    const collector = interaction.channel.createMessageCollector({
      filter,
      time: 60_000, // 60 second timeout
      max: maxAttempts,
    });

    collector.on("collect", async (m) => {
      const guess = parseInt(m.content.trim(), 10);
      attempts++;
      const remaining = maxAttempts - attempts;

      if (guess === secret) {
        collector.stop("win");
        activeGames.delete(channelId);
        return m.reply(
          `**Correct.** The number was **${secret}**.\n` +
            `Solved in **${attempts}** attempt${attempts !== 1 ? "s" : ""}.\n` +
            `\`*Calibration complete. Protocol integrity: STABLE.*\``
        );
      }

      if (remaining === 0) return; // collector max hit → "end" fires

      const hint = guess < secret ? "higher" : "lower";
      await m.reply(
        `\`${guess}\` is incorrect. The target is **${hint}**. ` +
          `\`[${remaining} attempt${remaining !== 1 ? "s" : ""} remaining]\``
      );
    });

    collector.on("end", (collected, reason) => {
      activeGames.delete(channelId);
      if (reason === "win") return;

      if (reason === "time") {
        interaction.followUp(
          `\`*Calibration sequence timed out. The number was **${secret}**.*\``
        );
        return;
      }

      // Exhausted all attempts
      if (reason === "limit") {
        interaction.followUp(
          `**Calibration failed.** Attempts exhausted.\n` +
            `The correct number was **${secret}**.\n` +
            `\`*Protocol integrity: DEGRADED.*\``
        );
      }
    });
  },
};
