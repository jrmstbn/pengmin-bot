/**
 * commands/fun/gif.js
 * Searches Giphy or Tenor and posts the top result.
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { executeTool } = require("../../ai/tools");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gif")
    .setDescription("Retrieve a GIF from the Protocol Network archives.")
    .addStringOption((opt) =>
      opt
        .setName("search")
        .setDescription("What to search for.")
        .setRequired(true)
        .setMaxLength(100)
    ),

  async execute(interaction) {
    const search = interaction.options.getString("search", true);
    await interaction.deferReply();

    const result = await executeTool("get_gif", { search_term: search });

    if (result.error || !result.url) {
      return interaction.editReply("`*No GIF signal detected. Archives returned nothing.*`");
    }

    const embed = new EmbedBuilder()
      .setColor(0xff6bcb)
      .setTitle(`GIF: "${search}"`)
      .setImage(result.url)
      .setFooter({ text: "Endfield Media Archives" });

    await interaction.editReply({ embeds: [embed] });
  },
};
