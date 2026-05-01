/**
 * commands/utility/help.js
 * Dynamically lists all registered slash commands from the client collection.
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Display available Protocol Network directives."),

  async execute(interaction, client) {
    const commands = [...client.commands.values()];

    // Group by directory/category based on __filename proximity — simple approach:
    // Just list everything in a clean embed.
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle("⟨ Protocol Network — Command Registry ⟩")
      .setDescription(
        "Interact with the Endministrator by **@mentioning** me in any channel.\n" +
          "Slash commands are available for direct system access.\n\u200b"
      )
      .setFooter({ text: 'Classification: PUBLIC // "Knowledge is control."' });

    // Add each command as an inline field
    for (const cmd of commands) {
      embed.addFields({
        name: `/${cmd.data.name}`,
        value: cmd.data.description || "No description.",
        inline: true,
      });
    }

    if (!commands.length) {
      embed.setDescription("`*No directives registered.*`");
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
