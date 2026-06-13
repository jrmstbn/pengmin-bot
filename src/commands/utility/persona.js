/**
 * src/commands/utility/persona.js — Persona Management Command
 *
 * Allows server admins to create, switch, and delete custom AI personas.
 * Changes take effect immediately for the next message — no restart needed.
 *
 * Subcommands:
 *   /persona list             — lists all saved personas for this guild
 *   /persona set <name>       — switches the active persona
 *   /persona create <name>    — opens a modal to write persona + context
 *   /persona delete <name>    — removes a custom persona
 *   /persona reset            — reverts to the default Endministrator persona
 *
 * All write operations require the ManageGuild permission so only admins
 * can change the bot's personality.
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const db = require("../../memory/database");
const { invalidateCache } = require("../../ai/personaManager");
const logger = require("../../utils/logger");

// Max characters Discord modals allow in a TextInput (paragraph style).
const MODAL_MAX = 4000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("persona")
    .setDescription("Manage the bot's active persona for this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List all personas saved for this server.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Switch the active persona.")
        .addStringOption((opt) =>
          opt.setName("name").setDescription("Name of the persona to activate.").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create or update a persona using a modal form.")
        .addStringOption((opt) =>
          opt.setName("name").setDescription("Unique name for this persona.").setRequired(true).setMaxLength(50)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a custom persona.")
        .addStringOption((opt) =>
          opt.setName("name").setDescription("Name of the persona to delete.").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("reset").setDescription("Revert to the default Endministrator persona.")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (!guildId) {
      return interaction.reply({
        content: "`*Persona management is not available in DMs.*`",
        flags: 64,
      });
    }

    if (!db.isEnabled()) {
      return interaction.reply({
        content:
          "`*Database is not connected. Persona management requires PostgreSQL.*`\n" +
          "`*(Set DATABASE_URL in .env to enable it.)*`",
        flags: 64,
      });
    }

    // ── /persona list ──────────────────────────────────────────────────────
    if (sub === "list") {
      const personas = await db.listPersonas(guildId);

      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle("⟨ Protocol Network — Persona Registry ⟩")
        .setFooter({ text: "Use /persona set <name> to switch the active persona." });

      if (personas.length === 0) {
        embed.setDescription(
          "No custom personas saved.\nUsing the default **Endministrator** persona.\n\n" +
          "Use `/persona create` to add one."
        );
      } else {
        const lines = personas.map(
          (p) => `${p.is_active ? "▶ " : "  "}**${p.name}**`
        );
        embed.setDescription(
          `**▶** = active\n\n${lines.join("\n")}\n\n` +
          "*(The default Endministrator is used as fallback if none are active.)*"
        );
      }

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ── /persona set ───────────────────────────────────────────────────────
    if (sub === "set") {
      const name = interaction.options.getString("name", true).toLowerCase();
      await interaction.deferReply({ flags: 64 });

      try {
        const success = await db.setActivePersona(guildId, name);
        if (!success) {
          return interaction.editReply(
            `\`*Persona "${name}" not found. Use /persona list to see available personas.*\``
          );
        }
        invalidateCache(guildId);
        logger.info(`[Persona] Guild ${guildId} switched to persona: ${name}`);
        return interaction.editReply(
          `\`*Persona switched to "${name}". Changes take effect on the next message.*\``
        );
      } catch (err) {
        logger.error("[Persona] set error:", err);
        return interaction.editReply("`*Failed to switch persona. Database error.*`");
      }
    }

    // ── /persona create ────────────────────────────────────────────────────
    if (sub === "create") {
      const name = interaction.options.getString("name", true).toLowerCase();

      // Use a modal so the admin can write multi-line persona and context text.
      const modal = new ModalBuilder()
        .setCustomId(`persona_create:${guildId}:${name}`)
        .setTitle(`Create Persona: ${name}`);

      const personaInput = new TextInputBuilder()
        .setCustomId("persona_text")
        .setLabel("Character / Personality")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Describe the character's personality, tone, speech style, and rules...")
        .setRequired(true)
        .setMaxLength(MODAL_MAX);

      const contextInput = new TextInputBuilder()
        .setCustomId("context_text")
        .setLabel("World Knowledge / Lore (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Describe the world, lore, or factual context the character is aware of...")
        .setRequired(false)
        .setMaxLength(MODAL_MAX);

      modal.addComponents(
        new ActionRowBuilder().addComponents(personaInput),
        new ActionRowBuilder().addComponents(contextInput)
      );

      await interaction.showModal(modal);

      // Await modal submission (up to 5 minutes).
      let modalInteraction;
      try {
        modalInteraction = await interaction.awaitModalSubmit({
          filter: (i) =>
            i.customId === `persona_create:${guildId}:${name}` &&
            i.user.id === interaction.user.id,
          time: 5 * 60 * 1000,
        });
      } catch {
        return; // Timed out — nothing to do
      }

      await modalInteraction.deferReply({ flags: 64 });

      const personaText = modalInteraction.fields.getTextInputValue("persona_text").trim();
      const contextText = modalInteraction.fields.getTextInputValue("context_text")?.trim() ?? "";

      try {
        await db.savePersona(guildId, name, { persona: personaText, context: contextText });
        invalidateCache(guildId);
        logger.info(`[Persona] Guild ${guildId} created/updated persona: ${name}`);
        return modalInteraction.editReply(
          `\`*Persona "${name}" saved. Use /persona set ${name} to activate it.*\``
        );
      } catch (err) {
        logger.error("[Persona] create error:", err);
        return modalInteraction.editReply("`*Failed to save persona. Database error.*`");
      }
    }

    // ── /persona delete ────────────────────────────────────────────────────
    if (sub === "delete") {
      const name = interaction.options.getString("name", true).toLowerCase();
      await interaction.deferReply({ flags: 64 });

      try {
        const deleted = await db.deletePersona(guildId, name);
        if (!deleted) {
          return interaction.editReply(
            `\`*Persona "${name}" not found.*\``
          );
        }
        invalidateCache(guildId);
        logger.info(`[Persona] Guild ${guildId} deleted persona: ${name}`);
        return interaction.editReply(
          `\`*Persona "${name}" deleted. The default Endministrator will be used if no other is active.*\``
        );
      } catch (err) {
        logger.error("[Persona] delete error:", err);
        return interaction.editReply("`*Failed to delete persona. Database error.*`");
      }
    }

    // ── /persona reset ─────────────────────────────────────────────────────
    if (sub === "reset") {
      await interaction.deferReply({ flags: 64 });

      try {
        await db.deactivateAllPersonas(guildId);
        invalidateCache(guildId);
        logger.info(`[Persona] Guild ${guildId} reset to default persona`);
        return interaction.editReply(
          "`*All custom personas deactivated. Reverting to default Endministrator persona.*`"
        );
      } catch (err) {
        logger.error("[Persona] reset error:", err);
        return interaction.editReply("`*Failed to reset persona. Database error.*`");
      }
    }
  },
};
