/**
 * src/bot.js — Discord Client & Event Orchestration
 *
 * Creates the discord.js Client, loads all slash commands via the
 * CommandHandler, and wires up every Discord gateway event.
 *
 * Architecture decision: Keep bot.js thin. All business logic lives
 * in dedicated services so this file only routes events.
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
} = require("discord.js");

const logger = require("./utils/logger");
const CommandHandler = require("./handlers/commandHandler");
const { handleMessage } = require("./ai/aiController");
const RateLimiter = require("./middleware/rateLimiter");
const { sanitizeInput } = require("./middleware/security");
const musicManager = require("./music/musicManager");

/**
 * createBot — initializes and returns a fully configured Discord Client.
 * Call client.login() after this returns.
 */
async function createBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates, // needed for music
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel], // allow DM handling
  });

  // Attach shared state to the client so commands can access it.
  client.commands = new Collection();
  client.rateLimiter = new RateLimiter({
    windowMs: 5_000, // 5 s cooldown window
    maxRequests: 1, // 1 AI request per window per user
  });

  // Initialize DisTube — must happen before any music commands run.
  musicManager.initDistube(client);

  // ─── Load slash commands ──────────────────────────────────────────────────
  const commandHandler = new CommandHandler(client);
  await commandHandler.loadAll();

  // ─── Register slash commands with Discord ─────────────────────────────────
  // Only runs if REGISTER_COMMANDS=true in .env (avoids rate-limit abuse).
  if (process.env.REGISTER_COMMANDS === "true") {
    await registerSlashCommands(client);
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  client.once("clientReady", () => {
    logger.info(
      `[Protocol Network] ${client.user.tag} is online. Endministrator is ready.`
    );
    client.user.setPresence({
      activities: [{ name: "the Protocol Network", type: 3 }], // "Watching"
      status: "online",
    });
  });

  // Slash command interactions
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client);
    } catch (err) {
      logger.error(`Command error [${interaction.commandName}]:`, err);
      // Only respond if the interaction hasn't expired (10062) or been double-acked (40060)
      try {
        const msg = { content: "`*System error. Protocol interrupted.*`", flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg);
        } else {
          await interaction.reply(msg);
        }
      } catch (replyErr) {
        // Interaction expired or already handled — nothing we can do
        logger.warn(`Could not send error reply [${interaction.commandName}]: ${replyErr.message}`);
      }
    }
  });

  // Mention-based AI conversation
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content?.trim()) return;

    // Only respond when the bot is @mentioned or in DMs
    const isDM = message.channel.type === 1; // ChannelType.DM === 1
    const isMentioned = message.mentions.has(client.user);
    if (!isMentioned && !isDM) return;

    // Rate limit check
    const limited = client.rateLimiter.check(message.author.id);
    if (limited) {
      return message.reply(
        `\`*Protocol cooling down. Retry in ${Math.ceil(limited / 1000)}s.*\``
      );
    }

    // Sanitize input before passing to the AI layer
    const cleanContent = sanitizeInput(message.content);

    await handleMessage(message, cleanContent, client);
  });

  client.on("error", (err) => logger.error("Discord client error:", err));
  client.on("warn", (msg) => logger.warn("Discord warning:", msg));

  return client;
}

/**
 * Registers all loaded slash commands with Discord's API.
 * Run once per deploy, not on every startup.
 */
async function registerSlashCommands(client) {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const commandData = client.commands.map((cmd) => cmd.data.toJSON());

  try {
    logger.info(`Registering ${commandData.length} slash commands...`);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commandData }
    );
    logger.info("Slash commands registered successfully.");
  } catch (err) {
    logger.error("Failed to register slash commands:", err);
  }
}

module.exports = { createBot };
