/**
 * src/commands/music/loop.js — Loop Command
 *
 * Sets the loop mode: off, one (repeat current), all (repeat queue).
 */

const { SlashCommandBuilder } = require("discord.js");
const musicManager = require("../../music/musicManager");
const { createInfoEmbed, createErrorEmbed } = require("../../music/musicUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set the loop mode.")
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Loop mode: off, one, or all.")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "off" },
          { name: "Repeat One", value: "one" },
          { name: "Repeat All", value: "all" }
        )
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const mode = interaction.options.getString("mode", true);

    const success = musicManager.setLoopMode(guildId, mode);

    if (!success) {
      return interaction.reply({
        embeds: [createErrorEmbed("Invalid loop mode.")],
        flags: 64,
      });
    }

    const modeNames = {
      off: "🔁 Loop Off",
      one: "🔂 Repeat One",
      all: "🔁 Repeat All",
    };

    return interaction.reply({
      embeds: [createInfoEmbed(modeNames[mode], `Loop mode set to **${mode}**.`)],
    });
  },
};
