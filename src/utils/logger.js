/**
 * src/utils/logger.js — Structured Logger
 *
 * A lightweight logger that:
 *   - Prefixes every line with a timestamp and log level
 *   - Reads LOG_LEVEL from the environment (default: "info")
 *   - In production, only "info" and above are printed
 *   - In development (LOG_LEVEL=debug), all levels print
 *
 * To swap for a heavier library (Winston, Pino), replace this file only.
 * All callers use the same interface: logger.info(), logger.warn(), etc.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: "\x1b[36m",  // cyan
  info: "\x1b[32m",   // green
  warn: "\x1b[33m",   // yellow
  error: "\x1b[31m",  // red
  reset: "\x1b[0m",
};

const currentLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function log(level, ...args) {
  if (LEVELS[level] < currentLevel) return;

  const ts = new Date().toISOString();
  const color = COLORS[level] ?? "";
  const tag = `${color}[${level.toUpperCase()}]${COLORS.reset}`;

  const stream = level === "error" ? process.stderr : process.stdout;
  const prefix = `${ts} ${tag}`;

  // Format Error objects nicely
  const formatted = args.map((a) =>
    a instanceof Error ? `${a.message}\n${a.stack}` : a
  );

  stream.write(`${prefix} ${formatted.join(" ")}\n`);
}

module.exports = {
  debug: (...args) => log("debug", ...args),
  info:  (...args) => log("info",  ...args),
  warn:  (...args) => log("warn",  ...args),
  error: (...args) => log("error", ...args),
};
