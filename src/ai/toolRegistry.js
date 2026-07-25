/**
 * src/ai/toolRegistry.js — Central Tool Registry
 *
 * Provides a dynamic registry for all AI tools (OpenAI function-calling format).
 * Tools are registered by name; the registry dispatches execution and surfaces
 * all definitions to the AI model.
 *
 * Design:
 *   - register(definition, executor) — adds a tool by its function name
 *   - execute(name, args, context)   — dispatches to the registered executor
 *   - getDefinitions()               — returns all definitions for OpenAI
 *
 * Errors from executors are always caught and returned as { error } objects
 * so the AI model can handle failures gracefully without crashing the loop.
 */

const logger = require("../utils/logger");

// ── Internal state ────────────────────────────────────────────────────────────

/** @type {Map<string, { definition: object, executor: Function }>} */
const _registry = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * register()
 * Registers a tool definition and its executor function.
 * Re-registering the same name overwrites the previous entry.
 *
 * @param {object}   definition  OpenAI function-calling definition object.
 *                               Must have `function.name` set.
 * @param {Function} executor    Async function (args, context) => result.
 */
function register(definition, executor) {
  const name = definition?.function?.name;
  if (!name) {
    throw new Error("ToolRegistry.register: definition must have function.name");
  }
  if (typeof executor !== "function") {
    throw new Error(`ToolRegistry.register: executor for "${name}" must be a function`);
  }
  _registry.set(name, { definition, executor });
  logger.debug(`[ToolRegistry] Registered tool: ${name}`);
}

/**
 * execute()
 * Dispatches a tool call to its registered executor.
 * Always returns a plain object — never throws.
 *
 * @param {string} name     The tool name to invoke.
 * @param {object} args     Parsed argument object from the model.
 * @param {object} context  Optional runtime context (e.g. { client, message }).
 * @returns {Promise<object>}
 */
async function execute(name, args = {}, context = {}) {
  const entry = _registry.get(name);

  if (!entry) {
    logger.warn(`[ToolRegistry] Unknown tool called: ${name}`);
    return { error: `Unknown tool: ${name}` };
  }

  try {
    const result = await entry.executor(args, context);
    return result;
  } catch (err) {
    logger.error(`[ToolRegistry] Tool "${name}" threw an error:`, err.message);
    return { error: err.message };
  }
}

/**
 * getDefinitions()
 * Returns an array of all registered OpenAI function-calling definition objects.
 * Pass the result directly to `tools:` in an OpenAI chat completions call.
 *
 * @returns {object[]}
 */
function getDefinitions() {
  return Array.from(_registry.values()).map((entry) => entry.definition);
}

/**
 * has()
 * Returns true if a tool with the given name is registered.
 * Used by SkillChainExecutor to detect name conflicts.
 *
 * @param {string} name
 * @returns {boolean}
 */
function has(name) {
  return _registry.has(name);
}

/**
 * clear()
 * Removes all registered tools. Intended for testing only.
 */
function clear() {
  _registry.clear();
}

module.exports = { register, execute, getDefinitions, has, clear };
