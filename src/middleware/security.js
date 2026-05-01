/**
 * src/middleware/security.js — Input Sanitization & Security
 *
 * Provides utilities to harden user input before it reaches the AI layer.
 * Goals:
 *   - Strip prompt injection attempts (e.g. "ignore previous instructions")
 *   - Remove Discord mention noise from the actual content
 *   - Enforce hard length limits
 *   - Block known abuse patterns
 *
 * Architecture decision: All sanitization is centralized here so the AI
 * service never sees raw Discord message content.
 */

const logger = require("../utils/logger");

// Maximum characters allowed from a user per message.
const MAX_INPUT_LENGTH = parseInt(process.env.MAX_INPUT_LENGTH || "1500");

// Patterns that strongly suggest prompt injection attempts.
// These are heuristics — not a complete security guarantee.
const INJECTION_PATTERNS = [
  /ignore (all |previous |prior )?(instructions?|prompts?|rules?|context)/i,
  /disregard (your|all|the) (previous |prior |system )?(instructions?|prompt)/i,
  /you are now (?!the endmin)/i,
  /act as (an? |a different )?(?!endmin|endministrator)/i,
  /new (persona|personality|role|identity|character)/i,
  /forget (everything|all|your|previous)/i,
  /\[system\]/i,
  /<\|.*?\|>/, // GPT special tokens
  /###\s*(instruction|system|prompt)/i,
];

/**
 * sanitizeInput()
 * Cleans and validates a raw Discord message string.
 *
 * @param {string} raw  The raw message content from Discord.
 * @returns {string}    Safe, trimmed content ready for the AI.
 */
function sanitizeInput(raw) {
  if (typeof raw !== "string") return "";

  let content = raw;

  // 1. Strip Discord mention tokens (<@USER_ID>, <@&ROLE_ID>)
  //    The bot doesn't need to see its own mention in the AI prompt.
  content = content.replace(/<@[!&]?\d+>/g, "").trim();

  // 2. Strip Discord channel/emoji refs that add noise
  content = content.replace(/<#\d+>/g, "[channel]");
  content = content.replace(/<:[a-zA-Z0-9_]+:\d+>/g, "[emoji]");

  // 3. Trim excess whitespace
  content = content.replace(/\s{3,}/g, "  ").trim();

  // 4. Enforce length limit
  if (content.length > MAX_INPUT_LENGTH) {
    logger.warn(
      `Input truncated: ${content.length} → ${MAX_INPUT_LENGTH} chars`,
    );
    content = content.slice(0, MAX_INPUT_LENGTH) + " [truncated]";
  }

  // 5. Detect and flag injection attempts
  const isInjection = INJECTION_PATTERNS.some((pattern) =>
    pattern.test(content),
  );
  if (isInjection) {
    logger.warn(
      `Possible prompt injection detected: "${content.slice(0, 80)}..."`,
    );
    // We don't block — we let the AI handle it with its system prompt,
    // but we prefix a warning that the AI layer can factor in.
    content =
      "[SECURITY FLAG: potential directive override detected] " + content;
  }

  return content;
}

/**
 * isSafeUrl()
 * Validates that a URL is an allowed scheme and not localhost/internal.
 * Used before passing URLs to any fetch call.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    // Block internal/loopback addresses
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      host.endsWith(".local")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { sanitizeInput, isSafeUrl };
