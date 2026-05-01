/**
 * src/ai/aiController.js — AI Message Controller
 *
 * Sits between the Discord event handler (bot.js) and the AI service.
 * Responsibilities:
 *   1. Retrieve user conversation history from memory
 *   2. Build the system prompt (persona + context + role modifiers)
 *   3. Call the AI service
 *   4. Save the updated history back to memory
 *   5. Send the reply to Discord (with typing indicator + chunking)
 *
 * Architecture decision: This is the "orchestration" layer.
 * aiService.js is the "API" layer. Keeping them separate means you can
 * swap OpenAI for Anthropic or Gemini without touching Discord logic.
 */

const logger = require("../utils/logger");
const memoryManager = require("../memory/memoryManager");
const { chat } = require("./aiService");
const { buildSystemPrompt } = require("./prompts");
const { chunkMessage } = require("../utils/helpers");

/**
 * handleMessage()
 * Main entry point called from bot.js on each qualifying Discord message.
 *
 * @param {Message} message    discord.js Message object
 * @param {string}  content    Pre-sanitized message content
 * @param {Client}  client     Discord Client (for any bot-level info)
 */
async function handleMessage(message, content, client) {
  const userId = message.author.id;
  const channelId = message.channelId;
  const guildId = message.guildId ?? "DM";

  // ── Typing indicator ──────────────────────────────────────────────────────
  // Show typing for the duration of the AI call so the user knows we're alive.
  await message.channel.sendTyping().catch(() => {});

  // Keep typing alive during long AI calls (Discord clears it after ~10 s).
  const typingInterval = setInterval(
    () => message.channel.sendTyping().catch(() => {}),
    8_000
  );

  try {
    // ── 1. Fetch user history from memory ─────────────────────────────────
    const { history, summary } = await memoryManager.getHistory(userId, channelId);

    // ── 2. Resolve Discord roles for persona modifiers ─────────────────────
    const userRoles = message.member?.roles.cache.map((r) => r.name) ?? [];
    const channelName = message.channel?.name ?? "";

    // ── 3. Build system prompt ─────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt({ userRoles, summary, channelName });

    // ── 4. Append the new user message to history ─────────────────────────
    const updatedHistory = [
      ...history,
      { role: "user", content },
    ];

    // ── 5. Call AI (with tool loop handled inside aiService) ───────────────
    const reply = await chat(updatedHistory, systemPrompt);

    // ── 6. Persist assistant reply to memory ──────────────────────────────
    await memoryManager.saveHistory(userId, channelId, [
      ...updatedHistory,
      { role: "assistant", content: reply },
    ]);

    // ── 7. Send reply to Discord ──────────────────────────────────────────
    // Discord has a 2000-character message limit. chunkMessage() splits safely.
    const chunks = chunkMessage(reply, 1990);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } catch (err) {
    logger.error(`AI controller error [user=${userId}]:`, err);
    await message.reply(
      "`*Connection to Protocol Network lost. Re-initiating hibernation sequence.*`\n" +
        "`(Error: AI service unavailable)`"
    );
  } finally {
    clearInterval(typingInterval);
  }
}

module.exports = { handleMessage };
