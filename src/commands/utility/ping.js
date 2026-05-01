/**
 * commands/utility/ping.js
 * Returns the bot's API and WebSocket latency.
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check Protocol Network latency."),

  async execute(interaction, client) {
    const sent = await interaction.reply({
      content: "`*Pinging Protocol Network...*`",
      fetchReply: true,
    });

    const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
    const wsHeartbeat = client.ws.ping;

    const embed = new EmbedBuilder()
      .setColor(0x00ffcc)
      .setTitle("📡 Protocol Network — Latency Report")
      .addFields(
        { name: "Round-trip", value: `\`${roundTrip}ms\``, inline: true },
        { name: "WebSocket", value: `\`${wsHeartbeat}ms\``, inline: true }
      )
      .setFooter({ text: "Endfield Industries // All systems nominal." });

    await interaction.editReply({ content: null, embeds: [embed] });
  },
};
