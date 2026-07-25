/**
 * src/ai/streamingResponder.js — Streaming Response Delivery
 *
 * Delivers GPT completions to Discord via progressive message edits,
 * creating the appearance of a live transmission.
 *
 * Design:
 *   1. Send an initial placeholder reply
 *   2. Consume an AsyncGenerator of string deltas
 *   3. Accumulate deltas and edit the message every STREAM_EDIT_INTERVAL_MS
 *   4. Perform a final edit with the complete text on stream end
 *   5. On any edit failure, fall back to message.channel.send()
 *
 * The typing indicator is NOT managed here — aiController.js owns it.
 * Enable by setting STREAMING_ENABLED=true in .env
 */

const logger = require("../utils/logger");

const STREAM_EDIT_INTERVAL_MS = parseInt(process.env.STREAM_EDIT_INTERVAL_MS || "800");
const STREAM_MIN_LENGTH = parseInt(process.env.STREAM_MIN_LENGTH || "200");

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * shouldStream()
 * Returns false for short responses — they don't need streaming.
 *
 * @param {number} estimatedLength  Estimated character count of the response.
 * @returns {boolean}
 */
function shouldStream(estimatedLength) {
  return estimatedLength >= STREAM_MIN_LENGTH;
}

/**
 * send()
 * Streams an AsyncGenerator of string deltas to Discord via message edits.
 *
 * @param {Message}        message          discord.js Message to reply to.
 * @param {AsyncGenerator} streamGenerator  Yields string deltas.
 * @returns {Promise<void>}
 */
async function send(message, streamGenerator) {
  let accumulated = "";
  let sentMessage = null;
  let lastEditTime = 0;

  // ── Send initial placeholder ───────────────────────────────────────────
  try {
    sentMessage = await message.reply("`*…receiving transmission…*`");
  } catch (err) {
    logger.error("[Streaming] Failed to send initial placeholder:", err.message);
    return;
  }

  // ── Consume the stream ─────────────────────────────────────────────────
  try {
    for await (const delta of streamGenerator) {
      if (typeof delta !== "string") continue;
      accumulated += delta;

      const now = Date.now();
      if (now - lastEditTime >= STREAM_EDIT_INTERVAL_MS && accumulated.trim()) {
        lastEditTime = now;
        await editMessage(sentMessage, message, accumulated);
      }
    }

    // ── Final edit — complete text ─────────────────────────────────────
    if (accumulated.trim()) {
      await editMessage(sentMessage, message, accumulated);
    }
  } catch (err) {
    logger.error("[Streaming] Stream consumption error:", err.message);
    // Attempt final fallback
    if (accumulated.trim()) {
      await editMessage(sentMessage, message, accumulated);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function editMessage(sentMessage, originalMessage, text) {
  // Discord message limit
  const safe = text.slice(0, 1990);

  try {
    await sentMessage.edit(safe);
  } catch (editErr) {
    logger.warn("[Streaming] Edit failed, falling back to new message:", editErr.message);
    try {
      await originalMessage.channel.send(safe);
    } catch (sendErr) {
      logger.error("[Streaming] Fallback send also failed:", sendErr.message);
    }
  }
}

module.exports = { send, shouldStream };
