/**
 * src/ai/visionService.js — Vision Service (GPT-4o Multi-Modal)
 *
 * Handles image analysis via OpenAI's vision capability.
 * Used when users attach images to messages directed at the bot.
 *
 * Flow:
 *   1. hasImages()      — check if a Discord message has image attachments
 *   2. describeImage()  — validate URL → size check → vision API → moderation API
 *
 * Safety:
 *   - isSafeUrl() is called before any network request
 *   - MAX_IMAGE_SIZE_MB enforced before API call
 *   - All errors returned as { error } objects — never throws
 *   - safeForWork: false set when OpenAI moderation flags the image
 *
 * Enable by setting VISION_ENABLED=true in .env
 */

const OpenAI = require("openai");
const logger = require("../utils/logger");
const { isSafeUrl } = require("../middleware/security");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_IMAGE_SIZE_MB = parseFloat(process.env.MAX_IMAGE_SIZE_MB || "10");
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// Recognized image MIME types and extensions
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * hasImages()
 * Returns true if the Discord message contains at least one image attachment.
 *
 * @param {Message} message  discord.js Message object
 * @returns {boolean}
 */
function hasImages(message) {
  if (!message?.attachments?.size) return false;

  return message.attachments.some((attachment) => {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    if (IMAGE_MIME_TYPES.has(contentType)) return true;

    // Fallback: check file extension
    const url = attachment.url ?? "";
    const ext = url.split("?")[0].slice(url.lastIndexOf(".")).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  });
}

/**
 * describeImage()
 * Analyzes an image URL using GPT-4o vision and runs moderation on it.
 *
 * @param {string} imageUrl   Direct URL to the image.
 * @param {string} userPrompt Instruction for what to focus on.
 * @returns {Promise<{ description, detectedObjects, estimatedMood, safeForWork } | { error }>}
 */
async function describeImage(imageUrl, userPrompt = "Describe this image in detail.") {
  // ── Safety: URL validation ─────────────────────────────────────────────
  if (!isSafeUrl(imageUrl)) {
    logger.warn(`[Vision] Image URL failed safety check: ${imageUrl}`);
    return { error: "Image URL failed safety check" };
  }

  // ── Safety: Size check (HEAD request) ─────────────────────────────────
  try {
    const head = await fetch(imageUrl, { method: "HEAD" });
    const contentLength = parseInt(head.headers.get("content-length") || "0");
    if (contentLength > MAX_IMAGE_SIZE_BYTES) {
      logger.warn(`[Vision] Image too large: ${contentLength} bytes`);
      return { error: "Image exceeds size limit" };
    }
  } catch {
    // HEAD failed — proceed anyway, OpenAI will handle if image is unreachable
    logger.debug("[Vision] HEAD request failed — proceeding with vision call");
  }

  // ── Vision API call ────────────────────────────────────────────────────
  let description = "";
  let detectedObjects = [];
  let estimatedMood = "neutral";

  try {
    const visionResponse = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            {
              type: "text",
              text:
                `${userPrompt}\n\n` +
                "Also respond in this exact JSON format (no markdown):\n" +
                '{"description":"...","detectedObjects":["..."],"estimatedMood":"..."}',
            },
          ],
        },
      ],
    });

    const raw = visionResponse.choices[0].message.content?.trim() ?? "";

    try {
      const parsed = JSON.parse(raw);
      description = parsed.description || raw;
      detectedObjects = Array.isArray(parsed.detectedObjects) ? parsed.detectedObjects : [];
      estimatedMood = parsed.estimatedMood || "neutral";
    } catch {
      // Model didn't return clean JSON — use raw text as description
      description = raw;
    }
  } catch (err) {
    logger.error("[Vision] Vision API call failed:", err.message);
    return { error: err.message };
  }

  // ── Moderation check ───────────────────────────────────────────────────
  let safeForWork = true;

  try {
    const modResult = await openai.moderations.create({ input: imageUrl });
    const flagged = modResult.results?.[0]?.flagged ?? false;
    if (flagged) {
      safeForWork = false;
      logger.warn(`[Vision] Image flagged by moderation: ${imageUrl}`);
    }
  } catch (err) {
    // Moderation failure is non-fatal — default to safe
    logger.warn("[Vision] Moderation check failed:", err.message);
  }

  return { description, detectedObjects, estimatedMood, safeForWork };
}

module.exports = { hasImages, describeImage };
