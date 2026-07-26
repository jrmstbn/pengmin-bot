/**
 * src/commands/fun/gameUtils.js — Shared Game Infrastructure
 *
 * Provides all common utilities for Phase 1 Games:
 *   - Session locking (activeGames Set)
 *   - AI commentary wrapper (persona-aware, with fallback)
 *   - PvP opponent invitation flow
 *   - Embed and button builders
 *   - Button customId namespacing
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { randomUUID } = require("crypto");
const logger = require("../../utils/logger");
const { chat } = require("../../ai/aiService");
const { buildSystemPrompt } = require("../../ai/prompts");
const { getActivePersona } = require("../../ai/personaManager");

// ── Session Management ────────────────────────────────────────────────────────

/** Channels that currently have an active game session */
const activeGames = new Set();

/**
 * checkAndLock()
 * Adds channelId to activeGames. Returns false if already locked.
 */
function checkAndLock(channelId) {
  if (activeGames.has(channelId)) return false;
  activeGames.add(channelId);
  return true;
}

/**
 * unlock()
 * Removes channelId from activeGames. Safe to call multiple times.
 */
function unlock(channelId) {
  activeGames.delete(channelId);
}

// ── AI Commentary ─────────────────────────────────────────────────────────────

const FALLBACK_MESSAGES = {
  default: "`*Signal processing complete. Result recorded.*`",
  win: "`*Victory confirmed. Protocol integrity: STABLE.*`",
  loss: "`*Defeat logged. Recalibrate and retry.*`",
  draw: "`*Equilibrium achieved. Neither variable dominates.*`",
};

/**
 * getPersona()
 * Resolves the active persona for a guild. Falls back to disk defaults.
 */
async function getPersona(guildId) {
  try {
    return await getActivePersona(guildId);
  } catch {
    return { name: "endministrator", persona: "", context: "" };
  }
}

/**
 * generateCommentary()
 * Calls the AI with the active persona to generate a short in-character comment.
 * Prompt is capped at 200 characters. Falls back to a static string on any error.
 *
 * @param {string} guildId   Discord guild ID for persona resolution.
 * @param {string} prompt    Game result description (≤ 200 chars enforced).
 * @param {string} fallbackKey  Key for FALLBACK_MESSAGES ('win'|'loss'|'draw'|'default')
 * @returns {Promise<string>}
 */
async function generateCommentary(guildId, prompt, fallbackKey = "default") {
  const safeprompt = String(prompt).slice(0, 200);
  try {
    const persona = await getPersona(guildId);
    const systemPrompt = buildSystemPrompt({
      persona: persona.persona,
      context: persona.context,
    });
    const messages = [{ role: "user", content: safeprompt }];
    const result = await chat(messages, systemPrompt);
    return result || FALLBACK_MESSAGES[fallbackKey] || FALLBACK_MESSAGES.default;
  } catch (err) {
    logger.warn("[GameUtils] Commentary failed, using fallback:", err.message);
    return FALLBACK_MESSAGES[fallbackKey] || FALLBACK_MESSAGES.default;
  }
}

// ── PvP Invitation Flow ───────────────────────────────────────────────────────

/**
 * awaitOpponentAccept()
 * Sends an invitation embed and waits for the opponent to Accept or Decline.
 *
 * @param {Interaction} interaction   The original slash command interaction.
 * @param {string}      challengerId  Challenger's user ID.
 * @param {string}      opponentId    Opponent's user ID.
 * @param {string}      gameName      Display name of the game.
 * @returns {Promise<'accepted'|'declined'|'timeout'>}
 */
async function awaitOpponentAccept(interaction, challengerId, opponentId, gameName) {
  const sessionId = randomUUID().slice(0, 8);
  const acceptId = makeButtonId("invite", sessionId, "accept");
  const declineId = makeButtonId("invite", sessionId, "decline");

  const inviteEmbed = buildInviteEmbed(
    interaction.guild?.members.cache.get(challengerId)?.displayName ?? "Challenger",
    `<@${opponentId}>`,
    gameName
  );

  const inviteRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(acceptId)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId(declineId)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌")
  );

  const inviteMessage = await interaction.followUp({
    content: `<@${opponentId}>`,
    embeds: [inviteEmbed],
    components: [inviteRow],
  });

  return new Promise((resolve) => {
    const collector = inviteMessage.createMessageComponentCollector({
      filter: (i) => i.user.id === opponentId && [acceptId, declineId].includes(i.customId),
      time: 60_000,
      max: 1,
    });

    collector.on("collect", async (i) => {
      await i.deferUpdate();
      const disabled = buildDisabledRow(inviteRow);
      await inviteMessage.edit({ components: [disabled] }).catch(() => {});
      resolve(i.customId === acceptId ? "accepted" : "declined");
    });

    collector.on("end", (collected, reason) => {
      if (reason === "time") {
        buildDisabledRow(inviteRow);
        inviteMessage.edit({ components: [buildDisabledRow(inviteRow)] }).catch(() => {});
        resolve("timeout");
      }
    });
  });
}

// ── Embed Builders ────────────────────────────────────────────────────────────

const EMBED_COLOR = 0x2b2d31;
const WIN_COLOR = 0x57f287;
const LOSS_COLOR = 0xed4245;
const DRAW_COLOR = 0xfee75c;

/**
 * buildGameEmbed()
 * General-purpose game state embed.
 */
function buildGameEmbed({ title, description, fields = [], color = EMBED_COLOR, footer = null }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description);
  if (fields.length) embed.addFields(fields);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

/**
 * buildResultEmbed()
 * Final result embed with outcome color coding.
 */
function buildResultEmbed({ title, description, outcome = "default", fields = [], footer = null }) {
  const colorMap = { win: WIN_COLOR, loss: LOSS_COLOR, draw: DRAW_COLOR, default: EMBED_COLOR };
  return buildGameEmbed({
    title,
    description,
    fields,
    color: colorMap[outcome] ?? EMBED_COLOR,
    footer,
  });
}

/**
 * buildInviteEmbed()
 * PvP invitation embed.
 */
function buildInviteEmbed(challengerName, opponentMention, gameName) {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`⟨ ${gameName} — Challenge Issued ⟩`)
    .setDescription(
      `**${challengerName}** has challenged ${opponentMention} to a game of **${gameName}**.\n\n` +
      `${opponentMention}, do you accept?`
    )
    .setFooter({ text: "Challenge expires in 60 seconds." });
}

// ── Button Builders ───────────────────────────────────────────────────────────

/**
 * buildChoiceRow()
 * Builds an ActionRow from an array of choice objects.
 *
 * @param {Array<{label, emoji, customId, style}>} choices
 */
function buildChoiceRow(choices) {
  const buttons = choices.map((c) => {
    const btn = new ButtonBuilder()
      .setCustomId(c.customId)
      .setLabel(c.label)
      .setStyle(c.style ?? ButtonStyle.Secondary);
    if (c.emoji) btn.setEmoji(c.emoji);
    return btn;
  });
  return new ActionRowBuilder().addComponents(...buttons);
}

/**
 * buildDisabledRow()
 * Returns a new ActionRow with all buttons disabled.
 */
function buildDisabledRow(row) {
  const disabledButtons = row.components.map((btn) =>
    ButtonBuilder.from(btn.toJSON()).setDisabled(true)
  );
  return new ActionRowBuilder().addComponents(...disabledButtons);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * makeButtonId()
 * Namespaced button customId: `<gameTag>:<sessionId>:<action>`
 */
function makeButtonId(gameTag, sessionId, action) {
  return `${gameTag}:${sessionId}:${action}`;
}

/**
 * newSessionId()
 * Returns a short random ID for button namespacing.
 */
function newSessionId() {
  return randomUUID().slice(0, 8);
}

/**
 * safeFollowUp()
 * Safely sends a followUp — falls back to channel.send if interaction expired.
 */
async function safeFollowUp(interaction, opts) {
  try {
    return await interaction.followUp(opts);
  } catch {
    return interaction.channel?.send(
      typeof opts === "string" ? opts : opts.content ?? ""
    ).catch(() => null);
  }
}

module.exports = {
  // Session
  checkAndLock,
  unlock,
  activeGames,
  // Commentary
  generateCommentary,
  getPersona,
  // PvP flow
  awaitOpponentAccept,
  // Embeds
  buildGameEmbed,
  buildResultEmbed,
  buildInviteEmbed,
  // Buttons
  buildChoiceRow,
  buildDisabledRow,
  // Helpers
  makeButtonId,
  newSessionId,
  safeFollowUp,
  EMBED_COLOR,
  WIN_COLOR,
  LOSS_COLOR,
  DRAW_COLOR,
};
