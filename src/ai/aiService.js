/**
 * src/ai/aiService.js — Core AI Service
 *
 * Abstracts all OpenAI API interactions. Provides:
 *  - chat() — multi-turn conversation with tool calling (agentic loop)
 *  - summarize() — compress long histories to save tokens
 *
 * Architecture decision: This module ONLY knows about the OpenAI API.
 * It does not know about Discord, memory, or personas — those are
 * assembled by the caller (aiController.js) before passing in.
 */

const OpenAI = require("openai");
const logger = require("../utils/logger");
const { TOOL_DEFINITIONS, executeTool } = require("./tools");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Model configuration — swap model names here without touching logic.
const AI_CONFIG = {
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  max_tokens: parseInt(process.env.MAX_TOKENS || "1024"),
  temperature: parseFloat(process.env.TEMPERATURE || "0.7"),
  // Max tool-call iterations per user message (prevents infinite loops)
  maxToolIterations: 4,
};

/**
 * chat()
 * Runs an agentic loop: sends messages → handles tool calls → collects
 * the final text response.
 *
 * @param {Array}  messages   Full message array: [{role, content}, ...]
 * @param {string} systemPrompt  Injected as the first system message.
 * @returns {Promise<string>}  The assistant's final text reply.
 */
async function chat(messages, systemPrompt) {
  // Prepend system prompt — always first in the array.
  const fullMessages = [{ role: "system", content: systemPrompt }, ...messages];

  let iterations = 0;

  while (iterations < AI_CONFIG.maxToolIterations) {
    iterations++;

    const response = await openai.chat.completions.create({
      model: AI_CONFIG.model,
      max_tokens: AI_CONFIG.max_tokens,
      temperature: AI_CONFIG.temperature,
      messages: fullMessages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto", // let the model decide when to use tools
    });

    const choice = response.choices[0];
    const assistantMsg = choice.message;

    // Always append the assistant's reply so the loop stays coherent.
    fullMessages.push(assistantMsg);

    // ── Case 1: Model wants to call one or more tools ────────────────────
    if (choice.finish_reason === "tool_calls" && assistantMsg.tool_calls) {
      // Execute all requested tool calls in parallel.
      const toolResults = await Promise.all(
        assistantMsg.tool_calls.map(async (tc) => {
          const args = safeParseJSON(tc.function.arguments);
          logger.debug(`Tool call: ${tc.function.name}`, args);

          const result = await executeTool(tc.function.name, args);
          return {
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          };
        }),
      );

      // Append all results so the model can see them on the next pass.
      fullMessages.push(...toolResults);
      continue; // loop back — model now processes tool results
    }

    // ── Case 2: Normal text response ─────────────────────────────────────
    const text = assistantMsg.content?.trim();
    if (text) return text;

    // Edge case: empty response
    logger.warn("AI returned empty content.");
    return "*…*"; // in-character silence fallback
  }

  // Iteration cap hit — return a safe fallback.
  logger.warn("AI tool iteration cap reached.");
  return "`*Processing limit reached. Stand by.*`";
}

/**
 * summarize()
 * Compresses an array of message objects into a single summary string.
 * Used by the memory layer when history grows too long.
 *
 * @param {Array} messages  History to summarize.
 * @returns {Promise<string>}
 */
async function summarize(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    logger.warn("summarize() called with empty or invalid messages array — skipping.");
    return "";
  }

  const response = await openai.chat.completions.create({
    model: AI_CONFIG.model,
    max_tokens: 256,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "Summarize the following conversation in 3-5 concise bullet points. " +
          "Preserve key facts, decisions, and user intent. Be neutral in tone.",
      },
      {
        role: "user",
        content: messages
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n"),
      },
    ],
  });

  return response.choices[0].message.content?.trim() ?? "";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJSON(str) {
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

module.exports = { chat, summarize };
