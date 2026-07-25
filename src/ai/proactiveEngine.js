/**
 * src/ai/proactiveEngine.js — Proactive Behavior Engine
 *
 * Generates AI-driven messages on schedule and in response to guild events.
 * Only initializes when PROACTIVE_ENABLED=true.
 *
 * Built-in behaviors:
 *   dailyInsight   — scheduled cron job (default 9 AM daily)
 *   memberWelcome  — fires on guildMemberAdd
 *   silenceBreaker — checked on cron; posts if channel silent > threshold
 *   milestone      — fires on guildMemberAdd; posts on member count milestones
 *
 * All posting is restricted to channels explicitly configured by an admin.
 * Each guild's job is wrapped in an independent try/catch.
 *
 * Configure per-guild via /proactive configure (or DB).
 */

const cron = require("node-cron");
const logger = require("../utils/logger");
const { chat } = require("./aiService");
const db = require("../memory/database");

// ── Configuration ─────────────────────────────────────────────────────────────

const SILENCE_THRESHOLD_HOURS = parseInt(process.env.SILENCE_THRESHOLD_HOURS || "6");
const GUILD_MILESTONE_THRESHOLDS = (process.env.GUILD_MILESTONE_THRESHOLDS || "100,250,500,1000")
  .split(",")
  .map(Number)
  .filter((n) => !isNaN(n) && n > 0);

// In-memory config store (used when DB is unavailable)
// Shape: Map<guildId, ProactiveBehaviorConfig>
const _memoryConfigs = new Map();

// Track milestones fired this session (persistent via DB when available)
// Shape: Map<guildId, Set<number>>
const _firedMilestones = new Map();

// Registered custom behaviors
// Shape: Map<behaviorName, handler(client, guildId, channelId, context)>
const _behaviors = new Map();

let _client = null;
let _cronJob = null;

// ── System prompt for proactive messages ─────────────────────────────────────

const PROACTIVE_SYSTEM_PROMPT =
  "You are the Endministrator — a stoic, analytical AI guardian of the Protocol Network. " +
  "Generate a short in-character message appropriate to the context. " +
  "Be cryptic, analytical, and minimal. No more than 3 sentences. " +
  "Do not break character. Do not mention being an AI.";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * init()
 * Initializes the engine. No-op if PROACTIVE_ENABLED != 'true'.
 *
 * @param {Client} client  discord.js Client
 */
function init(client) {
  if (process.env.PROACTIVE_ENABLED !== "true") {
    logger.debug("[Proactive] Disabled. Set PROACTIVE_ENABLED=true to enable.");
    return;
  }

  _client = client;

  // Register built-in behaviors
  _behaviors.set("dailyInsight", runDailyInsight);
  _behaviors.set("memberWelcome", runMemberWelcome);
  _behaviors.set("silenceBreaker", runSilenceBreaker);
  _behaviors.set("milestone", runMilestone);

  // ── Discord event: member join ─────────────────────────────────────────
  client.on("guildMemberAdd", async (member) => {
    const guildId = member.guild.id;
    const config = await getConfig(guildId);

    // Member welcome
    if (config?.behaviors?.memberWelcome?.enabled && config.behaviors.memberWelcome.channelId) {
      safeRunForGuild(guildId, "memberWelcome", async () => {
        await runMemberWelcome(client, member, config.behaviors.memberWelcome.channelId);
      });
    }

    // Milestone check on every member join
    if (config?.behaviors?.milestone?.enabled && config.behaviors.milestone?.channelId) {
      safeRunForGuild(guildId, "milestone", async () => {
        await runMilestone(client, member.guild, config.behaviors.milestone.channelId);
      });
    }
  });

  // ── Cron job: daily insight + silence breaker ──────────────────────────
  const defaultCron = "0 9 * * *"; // 9 AM daily

  _cronJob = cron.schedule(defaultCron, async () => {
    logger.info("[Proactive] Running scheduled cron jobs");
    const guilds = _client.guilds.cache;

    for (const [guildId, guild] of guilds) {
      const config = await getConfig(guildId).catch(() => null);
      if (!config) continue;

      // Daily insight
      if (config.behaviors?.dailyInsight?.enabled && config.behaviors.dailyInsight.channelId) {
        safeRunForGuild(guildId, "dailyInsight", async () => {
          await runDailyInsight(client, guild, config.behaviors.dailyInsight.channelId);
        });
      }

      // Silence breaker
      if (config.behaviors?.silenceBreaker?.enabled && config.behaviors.silenceBreaker.channelId) {
        safeRunForGuild(guildId, "silenceBreaker", async () => {
          await runSilenceBreaker(
            client,
            config.behaviors.silenceBreaker.channelId,
            config.behaviors.silenceBreaker.thresholdHours ?? SILENCE_THRESHOLD_HOURS
          );
        });
      }
    }
  });

  logger.info("[Proactive] Engine initialized.");
}

/**
 * registerBehavior()
 * Registers a custom behavior handler.
 *
 * @param {string}   name     Behavior identifier.
 * @param {Function} handler  async (client, guildId, channelId, context) => void
 */
function registerBehavior(name, handler) {
  _behaviors.set(name, handler);
  logger.debug(`[Proactive] Registered behavior: ${name}`);
}

/**
 * trigger()
 * Manually fires a specific behavior for a guild.
 *
 * @param {string} behaviorName
 * @param {string} guildId
 * @param {string} channelId
 * @param {object} context
 */
async function trigger(behaviorName, guildId, channelId, context = {}) {
  const handler = _behaviors.get(behaviorName);
  if (!handler) {
    logger.warn(`[Proactive] Unknown behavior: ${behaviorName}`);
    return;
  }
  await safeRunForGuild(guildId, behaviorName, () =>
    handler(_client, guildId, channelId, context)
  );
}

/**
 * getConfig() / setConfig()
 * Per-guild behavior configuration. DB-backed when available.
 */
async function getConfig(guildId) {
  if (db.isEnabled()) {
    try {
      const stored = await db.loadProactiveConfig(guildId);
      if (stored) return { guildId, behaviors: stored };
    } catch (err) {
      logger.error("[Proactive] DB config load failed:", err.message);
    }
  }
  return _memoryConfigs.get(guildId) ?? null;
}

async function setConfig(guildId, behaviors) {
  const config = { guildId, behaviors };
  _memoryConfigs.set(guildId, config);
  if (db.isEnabled()) {
    await db.saveProactiveConfig(guildId, behaviors).catch((err) =>
      logger.error("[Proactive] DB config save failed:", err.message)
    );
  }
  return config;
}

// ── Built-in Behavior Implementations ────────────────────────────────────────

async function runDailyInsight(client, guild, channelId) {
  const channel = await fetchChannel(client, guild.id, channelId);
  if (!channel) return;

  const prompt =
    `Protocol Network status report for ${guild.name}. ` +
    `The server has ${guild.memberCount} registered operators. ` +
    `Generate a brief in-character daily observation or insight.`;

  const insight = await chat(
    [{ role: "user", content: prompt }],
    PROACTIVE_SYSTEM_PROMPT
  );

  await channel.send(insight);
  logger.info(`[Proactive] Daily insight sent to guild: ${guild.id}`);
}

async function runMemberWelcome(client, member, channelId) {
  const channel = await fetchChannel(client, member.guild.id, channelId);
  if (!channel) return;

  const prompt =
    `A new operator has joined the Protocol Network. ` +
    `Their designation: ${member.user.username}. ` +
    `Generate a brief, cryptic, in-character welcome message.`;

  const welcome = await chat(
    [{ role: "user", content: prompt }],
    PROACTIVE_SYSTEM_PROMPT
  );

  await channel.send(welcome);
  logger.info(`[Proactive] Welcome sent for ${member.user.username} in guild: ${member.guild.id}`);
}

async function runSilenceBreaker(client, channelId, thresholdHours) {
  if (!_client) return;

  let channel;
  try {
    channel = await _client.channels.fetch(channelId);
  } catch {
    return;
  }

  if (!channel?.isTextBased?.()) return;

  // Check last message timestamp
  const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
  if (!messages || messages.size === 0) return;

  const lastMessage = messages.first();
  const hoursSince = (Date.now() - lastMessage.createdTimestamp) / (1000 * 60 * 60);

  if (hoursSince < thresholdHours) return;

  const prompt =
    `The channel has been silent for ${Math.round(hoursSince)} hours. ` +
    `Generate a cryptic, in-character observation to break the silence.`;

  const observation = await chat(
    [{ role: "user", content: prompt }],
    PROACTIVE_SYSTEM_PROMPT
  );

  await channel.send(observation);
  logger.info(`[Proactive] Silence breaker sent to channel: ${channelId}`);
}

async function runMilestone(client, guild, channelId) {
  const memberCount = guild.memberCount;

  // Get already-fired milestones for this guild
  if (!_firedMilestones.has(guild.id)) {
    _firedMilestones.set(guild.id, new Set());
  }
  const fired = _firedMilestones.get(guild.id);

  const crossed = GUILD_MILESTONE_THRESHOLDS.filter(
    (threshold) => memberCount >= threshold && !fired.has(threshold)
  );

  if (crossed.length === 0) return;

  const channel = await fetchChannel(client, guild.id, channelId);
  if (!channel) return;

  for (const milestone of crossed) {
    const prompt =
      `The Protocol Network has reached ${milestone} registered operators in ${guild.name}. ` +
      `Generate a brief in-character acknowledgment of this growth milestone.`;

    const message = await chat(
      [{ role: "user", content: prompt }],
      PROACTIVE_SYSTEM_PROMPT
    );

    await channel.send(message);
    fired.add(milestone);
    logger.info(`[Proactive] Milestone ${milestone} acknowledged for guild: ${guild.id}`);

    // Persist to DB to survive restarts
    if (db.isEnabled()) {
      const config = await getConfig(guild.id).catch(() => null);
      if (config) {
        const existing = config.behaviors?.milestone?.firedThresholds ?? [];
        await setConfig(guild.id, {
          ...config.behaviors,
          milestone: {
            ...config.behaviors?.milestone,
            firedThresholds: [...new Set([...existing, milestone])],
          },
        }).catch(() => {});
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * fetchChannel() with suspension on failure.
 * Returns null and marks behavior suspended if channel is inaccessible.
 */
async function fetchChannel(client, guildId, channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    return channel;
  } catch (err) {
    logger.error(
      `[Proactive] Could not fetch channel ${channelId} for guild ${guildId}: ${err.message}`
    );
    // Mark behavior as suspended in config
    const config = await getConfig(guildId).catch(() => null);
    if (config?.behaviors) {
      for (const [behaviorName, behavior] of Object.entries(config.behaviors)) {
        if (behavior.channelId === channelId) {
          config.behaviors[behaviorName].suspended = true;
          await setConfig(guildId, config.behaviors).catch(() => {});
          logger.warn(`[Proactive] Behavior '${behaviorName}' suspended for guild ${guildId}`);
        }
      }
    }
    return null;
  }
}

/**
 * safeRunForGuild()
 * Wraps a guild's behavior execution in try/catch.
 * Errors for one guild never block other guilds.
 */
async function safeRunForGuild(guildId, behaviorName, fn) {
  try {
    await fn();
  } catch (err) {
    logger.error(
      `[Proactive] Behavior '${behaviorName}' failed for guild ${guildId}: ${err.message}`
    );
  }
}

module.exports = { init, registerBehavior, trigger, getConfig, setConfig };
