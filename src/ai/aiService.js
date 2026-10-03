/**
 * src/ai/aiService.js — Core AI Service
 *
 * Abstracts all OpenAI API interactions. Provides:
 *  - chat()                    — multi-turn conversation with tool calling (agentic loop)
 *  - summarize()               — compress long histories to save tokens
 *  - extractProfileInsights()  — extract topics + notable facts from a single exchange
 *
 * Agentic loop:
 *  - Routes tool calls through SkillChainExecutor first (chains take priority)
 *  - Falls back to ToolRegistry for individual tool calls
 *  - Supports real OpenAI streaming (stream: true) when STREAMING_ENABLED=true;
 *    the token stream is piped through StreamingResponder and the accumulated
 *    text is returned so history saving works normally.
 *  - fullMessages array grows monotonically — no removal during a turn
 *
 * Architecture: This module ONLY knows about the OpenAI API.
 * Discord, memory, and personas are assembled by aiController.js before passing in.
 */

const OpenAI = require("openai");
const logger = require("../utils/logger");
const ToolRegistry = require("./toolRegistry");
const SkillChainExecutor = require("./skillChain");

// Lazy-load tools + chain registration (ensures all are registered at startup)
require("./tools");
require("./chains");

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
 * When STREAMING_ENABLED=true and the final response is long enough, the last
 * completion call uses stream:true and pipes real token deltas through
 * StreamingResponder. The complete accumulated text is still returned so
 * aiController.js can save history normally.
 *
 * @param {Array}  messages      Full message array: [{role, content}, ...]
 * @param {string} systemPrompt  Injected as the first system message.
 * @param {object} options       { streaming: boolean }
 * @param {object} context       Runtime context forwarded to tools: { message, client, guild }
 * @returns {Promise<string>}    The assistant's final text reply.
 */
async function chat(messages, systemPrompt, options = {}, context = {}) {
  const fullMessages = [{ role: "system", content: systemPrompt }, ...messages];
  const streamingEnabled =
    (options.streaming ?? process.env.STREAMING_ENABLED === "true") &&
    !!context.message;

  let iterations = 0;

  while (iterations < AI_CONFIG.maxToolIterations) {
    iterations++;

    // ── Determine if this is likely the final turn ─────────────────────────
    // We only stream on the final text response. Tool call turns always use
    // the non-streaming path because they must return structured JSON.
    // We optimistically stream if streaming is enabled; if the model returns
    // tool_calls instead of text, we simply fall through.
    const isOptimisticFinalTurn = streamingEnabled && iterations > 1;

    const response = await openai.chat.completions.create({
      model: AI_CONFIG.model,
      max_tokens: AI_CONFIG.max_tokens,
      temperature: AI_CONFIG.temperature,
      messages: fullMessages,
      tools: ToolRegistry.getDefinitions(),
      tool_choice: "auto",
      // Stream only on optimistic final turns — iteration 1 is always a
      // non-stream call so we can check for tool_calls first.
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

    // ── Case 2: Text response — check if we should stream ─────────────────
    const text = assistantMsg.content?.trim();
    if (text) {
      if (streamingEnabled) {
        try {
          const { send, shouldStream } = require("./streamingResponder");
          if (shouldStream(text.length)) {
            // Re-issue this same completion as a real stream so tokens arrive live.
            const streamed = await streamFinalResponse(fullMessages, context.message);
            // streamed may be null if streaming fails — fall through to normal reply.
            if (streamed !== null) return streamed;
          }
        } catch (err) {
          logger.warn("[AI] Streaming setup failed, replying normally:", err.message);
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
 * streamFinalResponse()
 * Issues the final completion with stream:true and pipes real token deltas
 * through StreamingResponder. Returns the full accumulated text on success,
 * or null on failure (caller falls back to the already-retrieved text reply).
 *
 * @param {Array}   messages   The full conversation at the point of final reply.
 * @param {Message} discordMsg discord.js Message to stream into.
 * @returns {Promise<string|null>}
 */
async function streamFinalResponse(messages, discordMsg) {
  const { send } = require("./streamingResponder");

  try {
    const stream = await openai.chat.completions.create({
      model: AI_CONFIG.model,
      max_tokens: AI_CONFIG.max_tokens,
      temperature: AI_CONFIG.temperature,
      messages,
      stream: true,
    });

    // Wrap the OpenAI token stream into an AsyncGenerator of string deltas
    // and simultaneously accumulate the full text for the return value.
    let accumulated = "";

    async function* tokenGenerator() {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          accumulated += delta;
          yield delta;
        }
      }
    }

    await send(discordMsg, tokenGenerator());
    return accumulated.trim() || null;
  } catch (err) {
    logger.warn("[AI] Real streaming call failed:", err.message);
    return null;
  }
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

/**
 * extractProfileInsights()
 * Runs a cheap, focused extraction call on a single user↔assistant exchange
 * to pull out topics the user cares about and notable facts worth remembering.
 *
 * Returns null if extraction is disabled (PROFILE_EXTRACTION_ENABLED != 'true')
 * or if nothing useful was found.
 *
 * @param {string} userContent   The user's message text.
 * @param {string} replyContent  The assistant's reply text.
 * @returns {Promise<{ topics: string[], facts: string[] } | null>}
 */
async function extractProfileInsights(userContent, replyContent) {
  if (process.env.PROFILE_EXTRACTION_ENABLED !== "true") return null;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 256,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract structured profile data from a conversation exchange. " +
            "Return a JSON object with two arrays:\n" +
            "- topics: up to 3 short topic labels the user is interested in (e.g. 'anime', 'Arknights lore', 'music production'). Empty array if none.\n" +
            "- facts: up to 2 brief notable facts about the user revealed in this exchange (e.g. 'plays guitar', 'lives in Manila'). Empty array if nothing specific.\n" +
            "Be conservative — only include things clearly stated or implied. Never invent. Return {\"topics\":[],\"facts\":[]} if unsure.",
        },
        {
          role: "user",
          content: `User said: ${userContent}\n\nAssistant replied: ${replyContent}`,
        },
      ],
    });

    const raw = response.choices[0].message.content?.trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const topics = Array.isArray(parsed.topics) ? parsed.topics.filter((t) => typeof t === "string" && t.trim()) : [];
    const facts = Array.isArray(parsed.facts) ? parsed.facts.filter((f) => typeof f === "string" && f.trim()) : [];

    return topics.length || facts.length ? { topics, facts } : null;
  } catch (err) {
    logger.warn("[AI] Profile extraction failed:", err.message);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeParseJSON(str) {
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

module.exports = { chat, summarize, extractProfileInsights };
