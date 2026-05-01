/**
 * commands/utility/userinfo.js
 * Displays information about a Discord user — styled as an Endfield dossier.
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Pull a dossier from Endfield records.")
    .addUserOption((opt) =>
      opt
        .setName("target")
        .setDescription("The entity to query. Defaults to yourself.")
        .setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getMember("target") ?? interaction.member;
    const user = target.user ?? target;

    const joinedAt = target.joinedAt
      ? `<t:${Math.floor(target.joinedAt / 1000)}:R>`
      : "Unknown";
    const createdAt = `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`;
    const roles =
      target.roles?.cache
        .filter((r) => r.name !== "@everyone")
        .map((r) => r.toString())
        .join(", ") || "None";

    const embed = new EmbedBuilder()
      .setColor(0x1e1e2e)
      .setAuthor({
        name: "Endfield Industries — Personnel Record",
        iconURL: interaction.client.user.displayAvatarURL(),
      })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setTitle(`Dossier: ${user.globalName ?? user.username}`)
      .addFields(
        { name: "User ID", value: `\`${user.id}\``, inline: true },
        { name: "Status", value: target.presence?.status ?? "offline", inline: true },
        { name: "Account Created", value: createdAt, inline: false },
        { name: "Joined Server", value: joinedAt, inline: false },
        { name: "Assigned Roles", value: roles || "None", inline: false }
      )
      .setFooter({ text: "Classification: RESTRICTED // Handle with discretion." })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
