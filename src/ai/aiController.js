/**
 * src/ai/aiController.js — AI Message Controller
 *
 * Sits between the Discord event handler (bot.js) and the AI service.
 * Responsibilities:
 *   1. Retrieve user conversation history from memory (guild-scoped)
 *   2. Load the active persona for this guild (DB or fallback)
 *   3. Build the system prompt
 *   4. Call the AI service
 *   5. Save the updated history back to memory
 *   6. Send the reply to Discord (with typing indicator + chunking)
 *
 * Memory is keyed by userId + guildId so the bot remembers a user across
 * all channels in a server, not just within a single channel.
 */

const logger = require("../utils/logger");
const memoryManager = require("../memory/memoryManager");
const { chat } = require("./aiService");
const { buildSystemPrompt } = require("./prompts");
const { getActivePersona } = require("./personaManager");
const { chunkMessage } = require("../utils/helpers");

/**
 * handleMessage()
 * Main entry point called from bot.js on each qualifying Discord message.
 *
 * @param {Message} message    discord.js Message object
 * @param {string}  content    Pre-sanitized message content
 * @param {Client}  client     Discord Client
 */
async function handleMessage(message, content, client) {
  const userId = message.author.id;
  const guildId = message.guildId ?? "DM";

  await message.channel.sendTyping().catch(() => {});

  const typingInterval = setInterval(
    () => message.channel.sendTyping().catch(() => {}),
    8_000
  );

  try {
    // ── 1. Fetch guild-scoped history from memory ──────────────────────────
    const { history, summary } = await memoryManager.getHistory(userId, guildId);

    // ── 2. Load the active persona for this guild ──────────────────────────
    // Falls back to disk defaults (Endministrator) if DB is unavailable or
    // no custom persona has been configured for this guild.
    const { persona, context } = await getActivePersona(guildId);

    // ── 3. Gather Discord context ──────────────────────────────────────────
    const userRoles = message.member?.roles.cache.map((r) => r.name) ?? [];
    const channelName = message.channel?.name ?? "";
    const guildName = message.guild?.name ?? "";

    // ── 4. Build system prompt ─────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt({
      persona,
      context,
      userRoles,
      summary,
      channelName,
      guildName,
    });

    // ── 5. Append the new user message to history ──────────────────────────
    const updatedHistory = [...history, { role: "user", content }];

    // ── 6. Call AI (agentic tool loop handled inside aiService) ───────────
    const reply = await chat(updatedHistory, systemPrompt);

    // ── 7. Persist updated history (guild-scoped) ─────────────────────────
    await memoryManager.saveHistory(userId, guildId, [
      ...updatedHistory,
      { role: "assistant", content: reply },
    ]);

    // ── 8. Send reply to Discord ───────────────────────────────────────────
    const chunks = chunkMessage(reply, 1990);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } catch (err) {
    logger.error(`AI controller error [user=${userId}, guild=${guildId}]:`, err);
    await message.reply(
      "`*Connection to Protocol Network lost. Re-initiating hibernation sequence.*`\n" +
        "`(Error: AI service unavailable)`"
    );
  } finally {
    clearInterval(typingInterval);
  }
}

module.exports = { handleMessage };
