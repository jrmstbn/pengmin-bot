/**
 * src/commands/utility/proactive.js — /proactive command
 *
 * Allows server administrators to configure and inspect the Proactive Engine.
 *
 * Subcommands:
 *   /proactive status     — show current state of all four behaviors
 *   /proactive configure  — enable/disable a behavior and set its channel
 *
 * Only users with the Administrator permission can use /proactive configure.
 * Auto-loaded by commandHandler.js — no other file changes needed.
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const proactiveEngine = require("../../ai/proactiveEngine");

const BEHAVIOR_NAMES = ["dailyInsight", "memberWelcome", "silenceBreaker", "milestone"];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("proactive")
    .setDescription("Configure and inspect the Proactive Engine behaviors.")
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show the current state of all proactive behaviors for this server.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("configure")
        .setDescription("Enable or disable a proactive behavior and set its channel.")
        .addStringOption((opt) =>
          opt
            .setName("behavior")
            .setDescription("The behavior to configure.")
            .setRequired(true)
            .addChoices(
              { name: "Daily Insight", value: "dailyInsight" },
              { name: "Member Welcome", value: "memberWelcome" },
              { name: "Silence Breaker", value: "silenceBreaker" },
              { name: "Milestone", value: "milestone" }
            )
        )
        .addBooleanOption((opt) =>
          opt
            .setName("enabled")
            .setDescription("Enable or disable this behavior.")
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("The channel where this behavior will post messages.")
            .setRequired(false)
        )
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // ── /proactive status ────────────────────────────────────────────────
    if (sub === "status") {
      await interaction.deferReply({ flags: 64 });

      const guildId = interaction.guildId;
      const config = await proactiveEngine.getConfig(guildId);
      const behaviors = config?.behaviors ?? {};

      const lines = BEHAVIOR_NAMES.map((name) => {
        const b = behaviors[name];
        if (!b) return `**${name}**: \`not configured\``;

        let status = b.enabled ? "✅ enabled" : "❌ disabled";
        if (b.suspended) status = "⚠️ suspended";

        const channel = b.channelId ? `<#${b.channelId}>` : "*no channel set*";
        return `**${name}**: ${status} — ${channel}`;
      });

      const enabled = process.env.PROACTIVE_ENABLED === "true";

      await interaction.editReply(
        `**Protocol Network — Proactive Engine Status**\n` +
        `Engine: ${enabled ? "✅ online" : "❌ offline (PROACTIVE_ENABLED not set)"}\n\n` +
        lines.join("\n")
      );
      return;
    }

    // ── /proactive configure ─────────────────────────────────────────────
    if (sub === "configure") {
      // Permission check — administrator only
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content:
            "`*Clearance insufficient. This configuration node requires Administrator authorization.*`",
          flags: 64,
        });
        return;
      }

      await interaction.deferReply({ flags: 64 });

      const behaviorName = interaction.options.getString("behavior");
      const enabled = interaction.options.getBoolean("enabled");
      const channel = interaction.options.getChannel("channel");

      const guildId = interaction.guildId;
      const existing = await proactiveEngine.getConfig(guildId);
      const currentBehaviors = existing?.behaviors ?? {};

      // Merge update into existing config
      const updatedBehavior = {
        ...(currentBehaviors[behaviorName] ?? {}),
        enabled,
      };

      if (channel) {
        updatedBehavior.channelId = channel.id;
        updatedBehavior.suspended = false; // re-activate if previously suspended
      }

      const updatedBehaviors = {
        ...currentBehaviors,
        [behaviorName]: updatedBehavior,
      };

      await proactiveEngine.setConfig(guildId, updatedBehaviors);

      const channelMention = channel ? `<#${channel.id}>` : "*unchanged*";
      await interaction.editReply(
        `**${behaviorName}** updated:\n` +
        `Status: ${enabled ? "✅ enabled" : "❌ disabled"}\n` +
        `Channel: ${channelMention}`
      );
    }
  },
};
