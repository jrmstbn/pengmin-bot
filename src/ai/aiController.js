/**
 * src/ai/aiController.js — AI Message Controller
 *
 * Orchestrates the full message pipeline:
 *   1. Moderation pre-check (if MODERATION_ENABLED=true)
 *   2. Sentiment analysis
 *   3. Enriched memory fetch (history + userProfile)
 *   4. Persona load
 *   5. System prompt assembly (with sentiment + profile)
 *   6. AI call (with streaming if STREAMING_ENABLED=true)
 *   7. History save + user profile update
 *   8. Discord reply
 *
 * Image handling:
 *   If VISION_ENABLED=true and the message has image attachments,
 *   the image is described and its description injected into the
 *   message content before the standard pipeline continues.
 *
 * The typing indicator is always cleared in the finally block.
 */

const logger = require("../utils/logger");
const memoryManager = require("../memory/memoryManager");
const UserProfileStore = require("../memory/userProfileStore");
const { chat } = require("./aiService");
const { buildSystemPrompt } = require("./prompts");
const { getActivePersona } = require("./personaManager");
const { chunkMessage } = require("../utils/helpers");
const { analyze: analyzeSentiment } = require("./sentimentAnalyzer");
const ModerationService = require("./moderationService");
const VisionService = require("./visionService");

// ── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * handleMessage()
 * Called from bot.js for every qualifying Discord message.
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
    // ── 0. Image routing (before moderation, uses text content if no image text) ──
    if (process.env.VISION_ENABLED === "true" && VisionService.hasImages(message)) {
      clearInterval(typingInterval);
      return await handleImageMessage(message, content, client);
    }

    // ── 1. Moderation pre-check ────────────────────────────────────────────
    const modResult = await ModerationService.check(content);

    if (modResult.action === "block") {
      ModerationService.logEvent(userId, guildId, content, modResult);
      await message.reply(
        "`*Signal rejected. The Protocol Network does not engage with that frequency.*`"
      );
      return; // Do NOT save history for blocked content
    }

    if (modResult.action === "warn") {
      ModerationService.logEvent(userId, guildId, content, modResult);
      await message.channel
        .send(
          "`*Anomalous signal pattern detected. Proceeding with caution.*`"
        )
        .catch(() => {});
    }

    // ── 2. Sentiment analysis ──────────────────────────────────────────────
    const sentimentHint = await Promise.resolve(analyzeSentiment(content));

    // ── 3. Enriched memory fetch ───────────────────────────────────────────
    const { history, summary, userProfile } = await memoryManager.getHistory(userId, guildId);

    // ── 4. Persona load ────────────────────────────────────────────────────
    const { persona, context } = await getActivePersona(guildId);

    // ── 5. Discord context ─────────────────────────────────────────────────
    const userRoles = message.member?.roles.cache.map((r) => r.name) ?? [];
    const channelName = message.channel?.name ?? "";
    const guildName = message.guild?.name ?? "";

    // ── 6. Build system prompt ─────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt({
      persona,
      context,
      userRoles,
      summary,
      channelName,
      guildName,
      sentimentHint,
      userProfile,
    });

    // ── 7. Append user message to history ──────────────────────────────────
    const updatedHistory = [...history, { role: "user", content }];

    // ── 8. AI call ─────────────────────────────────────────────────────────
    const context_obj = { message, client, guild: message.guild };
    const reply = await chat(updatedHistory, systemPrompt, {}, context_obj);

    // ── 9. Save history ────────────────────────────────────────────────────
    await memoryManager.saveHistory(userId, guildId, [
      ...updatedHistory,
      { role: "assistant", content: reply },
    ]);

    // ── 10. Update user profile ────────────────────────────────────────────
    await UserProfileStore.update(userId, guildId, {
      interactionCount: (userProfile.interactionCount || 0) + 1,
      sentimentHistory: [sentimentHint.tone],
      preferredTone: sentimentHint.tone === "positive" ? "casual" : userProfile.preferredTone,
    });

    // ── 11. Send reply ─────────────────────────────────────────────────────
    if (process.env.STREAMING_ENABLED === "true") {
      const { send, shouldStream } = require("./streamingResponder");
      if (shouldStream(reply.length)) {
        const fakeGenerator = (async function* () { yield reply; })();
        await send(message, fakeGenerator);
        return;
      }
    }

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
    clearInterval(typingInterval); // Always cleared — requirement 12.7
  }
}

// ── Image Handling ────────────────────────────────────────────────────────────

/**
 * handleImageMessage()
 * Describes an image attachment then continues with the standard pipeline.
 *
 * @param {Message} message
 * @param {string}  content  Original user text (may be empty)
 * @param {Client}  client
 */
async function handleImageMessage(message, content, client) {
  const userId = message.author.id;
  const guildId = message.guildId ?? "DM";

  await message.channel.sendTyping().catch(() => {});
  const typingInterval = setInterval(
    () => message.channel.sendTyping().catch(() => {}),
    8_000
  );

  try {
    const attachment = message.attachments.first();
    const imageResult = await VisionService.describeImage(
      attachment.url,
      content || "Describe this image."
    );

    if (imageResult.error) {
      await message.reply("`*Image signal corrupted. Cannot process.*`");
      return;
    }

    // Inject image description into the content
    const imageContext = `[Image attached: ${imageResult.description}]`;
    const enrichedContent = content
      ? `${content}\n\n${imageContext}`
      : imageContext;

    // Continue with standard pipeline (moderation, sentiment, etc.)
    // We call handleMessageCore which is the inner logic without the typing setup
    await handleMessageCore(message, enrichedContent, client, typingInterval);
  } catch (err) {
    logger.error(`Image handler error [user=${userId}, guild=${guildId}]:`, err);
    await message.reply("`*Image transmission failed. Protocol error.*`");
    clearInterval(typingInterval);
  }
}

/**
 * handleMessageCore()
 * Inner pipeline shared by handleMessage (text) and handleImageMessage (vision).
 * Typing interval is managed by the caller.
 */
async function handleMessageCore(message, content, client, typingInterval) {
  const userId = message.author.id;
  const guildId = message.guildId ?? "DM";

  try {
    // Moderation
    const modResult = await ModerationService.check(content);
    if (modResult.action === "block") {
      ModerationService.logEvent(userId, guildId, content, modResult);
      await message.reply("`*Signal rejected. The Protocol Network does not engage with that frequency.*`");
      return;
    }
    if (modResult.action === "warn") {
      ModerationService.logEvent(userId, guildId, content, modResult);
      await message.channel.send("`*Anomalous signal pattern detected. Proceeding with caution.*`").catch(() => {});
    }

    const sentimentHint = await Promise.resolve(analyzeSentiment(content));
    const { history, summary, userProfile } = await memoryManager.getHistory(userId, guildId);
    const { persona, context } = await getActivePersona(guildId);

    const userRoles = message.member?.roles.cache.map((r) => r.name) ?? [];
    const systemPrompt = buildSystemPrompt({
      persona, context, userRoles, summary,
      channelName: message.channel?.name ?? "",
      guildName: message.guild?.name ?? "",
      sentimentHint, userProfile,
    });

    const updatedHistory = [...history, { role: "user", content }];
    const context_obj = { message, client, guild: message.guild };
    const reply = await chat(updatedHistory, systemPrompt, {}, context_obj);

    await memoryManager.saveHistory(userId, guildId, [
      ...updatedHistory,
      { role: "assistant", content: reply },
    ]);

    await UserProfileStore.update(userId, guildId, {
      interactionCount: (userProfile.interactionCount || 0) + 1,
      sentimentHistory: [sentimentHint.tone],
    });

    const chunks = chunkMessage(reply, 1990);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } finally {
    clearInterval(typingInterval);
  }
}

module.exports = { handleMessage, handleImageMessage };
