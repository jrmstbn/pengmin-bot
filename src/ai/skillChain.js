/**
 * src/ai/skillChain.js — Skill Chain Executor
 *
 * Allows the AI to compose multiple tools into a sequential pipeline
 * within a single user turn. Each step's output feeds into the next
 * step's argsMapper, enabling "research → transform → respond" flows.
 *
 * Design:
 *   - define(chainName, config)               — registers a named chain
 *   - execute(chainName, initialArgs, context) — runs the chain
 *   - hasChain(name)                           — checks if a chain exists
 *
 * Chains take priority over tools in the agentic loop. Chain names and
 * tool names occupy separate namespaces; defining a chain whose name
 * matches a registered tool throws immediately at registration time.
 *
 * Safety:
 *   - Depth is capped at MAX_CHAIN_DEPTH (default 5)
 *   - Wall-clock time is capped at CHAIN_TIMEOUT_MS (default 15 000 ms)
 *   - Any step that returns { error } short-circuits the chain
 *   - argsMapper functions must be registered code — never eval'd strings
 */

const logger = require("../utils/logger");
const ToolRegistry = require("./toolRegistry");

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_CHAIN_DEPTH = parseInt(process.env.MAX_CHAIN_DEPTH || "5");
const CHAIN_TIMEOUT_MS = parseInt(process.env.CHAIN_TIMEOUT_MS || "15000");

// ── Internal state ─────────────────────────────────────────────────────────────

/** @type {Map<string, SkillChainDefinition>} */
const _chains = new Map();

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * define()
 * Registers a named skill chain definition.
 *
 * @param {string} chainName  Unique identifier for this chain.
 * @param {object} config
 * @param {string}   config.description  Human-readable purpose.
 * @param {Array}    config.steps        Array of { tool, argsMapper } objects.
 * @param {number}  [config.maxDepth]    Override global MAX_CHAIN_DEPTH.
 * @throws {Error} If chainName conflicts with a registered tool name.
 */
function define(chainName, config) {
  if (ToolRegistry.has(chainName)) {
    throw new Error(
      `Chain name '${chainName}' conflicts with a registered tool name`
    );
  }

  if (!Array.isArray(config?.steps) || config.steps.length === 0) {
    throw new Error(`Chain '${chainName}' must have at least one step`);
  }

  const definition = {
    name: chainName,
    description: config.description || "",
    steps: config.steps,
    maxDepth: config.maxDepth ?? MAX_CHAIN_DEPTH,
  };

  _chains.set(chainName, definition);
  logger.debug(`[SkillChain] Registered chain: ${chainName} (${definition.steps.length} steps)`);
}

/**
 * execute()
 * Runs a named skill chain, or falls back to ToolRegistry if no chain
 * is found under chainName.
 *
 * @param {string} chainName    Registered chain name (or tool name as fallback).
 * @param {object} initialArgs  Starting arguments passed to the first step.
 * @param {object} context      Runtime context forwarded to each tool executor.
 * @returns {Promise<{ result: object, steps: Array }>}
 */
async function execute(chainName, initialArgs = {}, context = {}) {
  // ── Fallback: not a chain — delegate to ToolRegistry ────────────────────
  if (!_chains.has(chainName)) {
    if (ToolRegistry.has(chainName)) {
      const result = await ToolRegistry.execute(chainName, initialArgs, context);
      return { result, steps: [] };
    }
    return { error: `Unknown chain: ${chainName}` };
  }

  const chain = _chains.get(chainName);
  const steps = [];
  let prevOutput = null;

  // ── Race the whole chain against the timeout ───────────────────────────
  const chainWork = async () => {
    for (const step of chain.steps) {
      // Depth cap — stop and return partial results
      if (steps.length >= chain.maxDepth) {
        logger.debug(`[SkillChain] "${chainName}" hit depth cap (${chain.maxDepth})`);
        break;
      }

      // Map args for this step
      let mappedArgs;
      try {
        mappedArgs = step.argsMapper(prevOutput, initialArgs);
      } catch (err) {
        logger.error(`[SkillChain] "${chainName}" argsMapper threw:`, err.message);
        const errObj = { error: `argsMapper failed: ${err.message}` };
        steps.push({ tool: step.tool, args: null, output: errObj });
        return { result: errObj, steps };
      }

      // Execute the step's tool
      const output = await ToolRegistry.execute(step.tool, mappedArgs, context);

      logger.debug(
        `[SkillChain] "${chainName}" step ${steps.length + 1}: tool=${step.tool}`,
        { args: mappedArgs, output }
      );

      steps.push({ tool: step.tool, args: mappedArgs, output });

      // Short-circuit on tool error
      if (output && output.error !== undefined) {
        logger.warn(`[SkillChain] "${chainName}" halted at step ${steps.length} — tool returned error`);
        return { result: output, steps };
      }

      prevOutput = output;
    }

    return { result: prevOutput, steps };
  };

  // Timeout wrapper
  const timeout = new Promise((resolve) =>
    setTimeout(
      () => resolve({ error: "chain timeout", steps }),
      CHAIN_TIMEOUT_MS
    )
  );

  return Promise.race([chainWork(), timeout]);
}

/**
 * hasChain()
 * Returns true if a chain is registered under the given name.
 * Used by aiService.js to decide whether to route through chains first.
 *
 * @param {string} name
 * @returns {boolean}
 */
function hasChain(name) {
  return _chains.has(name);
}

/**
 * clear()
 * Removes all registered chains. Intended for testing only.
 */
function clear() {
  _chains.clear();
}

module.exports = { define, execute, hasChain, clear };
