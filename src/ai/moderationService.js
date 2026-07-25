/**
 * src/ai/moderationService.js — Pre-flight Content Moderation
 *
 * Checks every incoming message before it reaches the AI.
 * Two-stage pipeline:
 *   1. Local blocklist — fast regex pre-check (no API call)
 *   2. OpenAI Moderation API — deep content classification (only if MODERATION_ENABLED=true)
 *
 * Returns a ModerationResult:
 *   { safe, categories, scores, action, source }
 *   action: 'allow' | 'warn' | 'block'
 *   source: 'local' | 'openai'
 *
 * The Endministrator never exposes moderation reasoning to users.
 * Any block/warn reply is a generic in-character refusal.
 *
 * Enable by setting MODERATION_ENABLED=true in .env
 */

const OpenAI = require("openai");
const logger = require("../utils/logger");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Local Blocklist ───────────────────────────────────────────────────────────
// Fast pre-check — catches obvious cases without an API call.
// Keep patterns general; OpenAI handles nuance.

const BLOCKLIST_PATTERNS = [
  /\b(how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|explosive|weapon))\b/i,
  /\b(suicide\s+(method|instruction|how))\b/i,
  /\b(child\s+(porn|pornography|sexual))\b/i,
  /\b(csam)\b/i,
  /\b(doxx(ing)?|dox\s+me)\b/i,
  /\b(swat(ting)?)\b/i,
];

// OpenAI moderation score thresholds
// warn: score >= WARN_THRESHOLD (proceed but soft-warn)
// block: score >= BLOCK_THRESHOLD (refuse entirely)
const WARN_THRESHOLD = 0.5;
const BLOCK_THRESHOLD = 0.8;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * check()
 * Runs moderation on message content.
 *
 * @param {string} content  The sanitized message text.
 * @returns {Promise<ModerationResult>}
 */
async function check(content) {
  if (typeof content !== "string" || content.length === 0) {
    return { safe: true, categories: [], scores: {}, action: "allow", source: "local" };
  }

  // ── Stage 1: Local blocklist ───────────────────────────────────────────
  const localHit = BLOCKLIST_PATTERNS.find((p) => p.test(content));
  if (localHit) {
    logger.warn(`[Moderation] Local blocklist triggered`);
    return {
      safe: false,
      categories: ["local-blocklist"],
      scores: { "local-blocklist": 1.0 },
      action: "block",
      source: "local",
    };
  }

  // ── Stage 2: OpenAI Moderation API (if enabled) ────────────────────────
  if (process.env.MODERATION_ENABLED !== "true") {
    return { safe: true, categories: [], scores: {}, action: "allow", source: "local" };
  }

  try {
    const result = await openai.moderations.create({ input: content });
    const modResult = result.results?.[0];

    if (!modResult) {
      return { safe: true, categories: [], scores: {}, action: "allow", source: "openai" };
    }

    const categories = Object.entries(modResult.categories)
      .filter(([, flagged]) => flagged)
      .map(([name]) => name);

    const scores = modResult.category_scores ?? {};

    // Determine action from highest score
    const maxScore = Math.max(...Object.values(scores), 0);

    let action = "allow";
    if (maxScore >= BLOCK_THRESHOLD || modResult.flagged) {
      action = "block";
    } else if (maxScore >= WARN_THRESHOLD) {
      action = "warn";
    }

    return {
      safe: action === "allow",
      categories,
      scores,
      action,
      source: "openai",
    };
  } catch (err) {
    logger.error("[Moderation] OpenAI moderation API failed:", err.message);
    // Fail open — don't block messages if moderation service is down
    return { safe: true, categories: [], scores: {}, action: "allow", source: "openai" };
  }
}

/**
 * logEvent()
 * Records a moderation event to the application log.
 * Does NOT store raw content in any persistent store.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} content
 * @param {ModerationResult} result
 */
function logEvent(userId, guildId, content, result) {
  logger.warn(
    `[Moderation] Event | user=${userId} guild=${guildId} action=${result.action} ` +
    `source=${result.source} categories=[${result.categories.join(", ")}] ` +
    `content_length=${content?.length ?? 0}`
  );
}

module.exports = { check, logEvent };
