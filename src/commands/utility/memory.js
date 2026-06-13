/**
 * commands/utility/memory.js
 * Slash commands for managing the bot's memory of a user.
 *
 * /memory status — shows current message count + summary flag
 * /memory forget — wipes conversation history for this guild
 *
 * Memory is now guild-scoped: one record per user per server.
 * Forgetting in one server does not affect DMs or other servers.
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const memoryManager = require("../../memory/memoryManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("memory")
    .setDescription("Manage Protocol Network memory records.")
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Check how much of your interaction the Protocol Network retains.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("forget")
        .setDescription("Purge your conversation history from this server's Protocol Network memory.")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    // Memory is now per-guild, not per-channel.
    const guildId = interaction.guildId ?? "DM";

    if (sub === "status") {
      const stats = memoryManager.getStats(userId, guildId);
      const embed = new EmbedBuilder()
        .setColor(0x4e5058)
        .setTitle("🧠 Protocol Network — Memory Status")
        .addFields(
          { name: "Active Messages", value: `\`${stats.messages}\``, inline: true },
          { name: "Compressed Summary", value: stats.hasSummary ? "`Yes`" : "`No`", inline: true },
          { name: "Total Cached Users", value: `\`${stats.cacheSize}\``, inline: true }
        )
        .setDescription("Memory is guild-scoped — your history carries across all channels in this server.")
        .setFooter({ text: "Memory is finite. Summaries preserve what matters." });

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    if (sub === "forget") {
      await memoryManager.clearHistory(userId, guildId);
      return interaction.reply({
        content:
          "`*Memory purge complete. Your record has been cleared from this server.*`\n" +
          "`*(Other servers and DMs are unaffected.)*`",
        flags: 64,
      });
    }
  },
};
