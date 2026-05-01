/**
 * src/utils/helpers.js — General Utility Functions
 *
 * Small, pure helper functions used across the codebase.
 * No Discord or AI dependencies — easy to unit-test.
 */

/**
 * chunkMessage()
 * Splits a long string into chunks that fit within Discord's message limit.
 * Splits on newlines when possible to avoid cutting mid-sentence.
 *
 * @param {string} text       The full text to split.
 * @param {number} maxLength  Max characters per chunk (default 1990).
 * @returns {string[]}
 */
function chunkMessage(text, maxLength = 1990) {
  if (!text) return ["`*…*`"];
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    // If adding this line would exceed the limit, flush current chunk first.
    if (current.length + line.length + 1 > maxLength) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }

      // If a single line is longer than maxLength, hard-split it.
      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
        continue;
      }
    }

    current += (current ? "\n" : "") + line;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : ["`*…*`"];
}

/**
 * sleep()
 * Promise-based delay — useful for retry logic.
 *
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * truncate()
 * Shortens a string and appends an ellipsis if it exceeds maxLen.
 *
 * @param {string} str
 * @param {number} maxLen
 */
function truncate(str, maxLen = 100) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * escapeMarkdown()
 * Escapes Discord markdown special characters.
 *
 * @param {string} str
 */
function escapeMarkdown(str) {
  return str.replace(/([*_`~\\|>])/g, "\\$1");
}

/**
 * formatMs()
 * Converts milliseconds to a human-readable duration string.
 *
 * @param {number} ms
 * @returns {string}  e.g. "2h 34m 12s"
 */
function formatMs(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

module.exports = { chunkMessage, sleep, truncate, escapeMarkdown, formatMs };
