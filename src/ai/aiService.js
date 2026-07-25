/**
 * src/ai/aiService.js — Core AI Service
 *
 * Abstracts all OpenAI API interactions. Provides:
 *  - chat()      — multi-turn conversation with tool calling (agentic loop)
 *  - summarize() — compress long histories to save tokens
 *
 * Agentic loop enhancements:
 *  - Routes tool calls through SkillChainExecutor first (chains take priority)
 *  - Falls back to ToolRegistry for individual tool calls
 *  - Supports streaming responses via StreamingResponder when options.streaming=true
 *  - fullMessages array grows monotonically — no removal during a turn
 *
 * Architecture: This module ONLY knows about the OpenAI API.
 * Discord, memory, and personas are assembled by aiController.js before passing in.
 */

const OpenAI = require("openai");
const logger = require("../utils/logger");
const ToolRegistry = require("./toolRegistry");
const SkillChainExecutor = require("./skillChain");

// Lazy-load tools registration (ensures all tools are registered at startup)
require("./tools");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AI_CONFIG = {
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  max_tokens: parseInt(process.env.MAX_TOKENS || "1024"),
  temperature: parseFloat(process.env.TEMPERATURE || "0.7"),
  maxToolIterations: 4,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * chat()
 * Runs the agentic loop: send messages → handle tool/chain calls → return text.
 *
 * @param {Array}  messages      Full message array: [{role, content}, ...]
 * @param {string} systemPrompt  Injected as the first system message.
 * @param {object} options       { streaming: boolean }
 * @param {object} context       Runtime context forwarded to tools: { message, client, guild }
 * @returns {Promise<string>}    The assistant's final text reply.
 */
async function chat(messages, systemPrompt, options = {}, context = {}) {
  const fullMessages = [{ role: "system", content: systemPrompt }, ...messages];

  let iterations = 0;

  while (iterations < AI_CONFIG.maxToolIterations) {
    iterations++;

    const response = await openai.chat.completions.create({
      model: AI_CONFIG.model,
      max_tokens: AI_CONFIG.max_tokens,
      temperature: AI_CONFIG.temperature,
      messages: fullMessages,
      tools: ToolRegistry.getDefinitions(),
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const assistantMsg = choice.message;

    // fullMessages grows monotonically — never remove items during a turn
    fullMessages.push(assistantMsg);

    // ── Case 1: Tool / chain calls ────────────────────────────────────────
    if (choice.finish_reason === "tool_calls" && assistantMsg.tool_calls) {
      const toolResults = await Promise.all(
        assistantMsg.tool_calls.map(async (tc) => {
          const args = safeParseJSON(tc.function.arguments);
          const toolName = tc.function.name;
          logger.debug(`[AI] Tool call: ${toolName}`, args);

          let result;

          // Chains take priority over individual tools
          if (SkillChainExecutor.hasChain(toolName)) {
            const chainResult = await SkillChainExecutor.execute(toolName, args, context);
            // Inject the full steps trace so the model can reference what each step retrieved
            result = chainResult;
          } else {
            result = await ToolRegistry.execute(toolName, args, context);
          }

          return {
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          };
        })
      );

      fullMessages.push(...toolResults);
      continue;
    }

    // ── Case 2: Normal text response ──────────────────────────────────────
    const text = assistantMsg.content?.trim();
    if (text) {
      // Streaming path
      if (options.streaming && context.message) {
        try {
          const { send, shouldStream } = require("./streamingResponder");
          if (shouldStream(text.length)) {
            const fakeGen = (async function* () { yield text; })();
            await send(context.message, fakeGen);
            return text;
          }
        } catch (err) {
          logger.warn("[AI] Streaming failed, returning text normally:", err.message);
        }
      }
      return text;
    }

    logger.warn("[AI] Empty response on iteration", iterations);
    return "*…*";
  }

  logger.warn("[AI] Tool iteration cap reached.");
  return "`*Processing limit reached. Stand by.*`";
}

/**
 * summarize()
 * Compresses an array of message objects into a summary string.
 *
 * @param {Array} messages  History to summarize.
 * @returns {Promise<string>}
 */
async function summarize(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    logger.warn("summarize() called with empty array — skipping.");
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeParseJSON(str) {
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

module.exports = { chat, summarize };
