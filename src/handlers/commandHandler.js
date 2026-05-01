/**
 * src/commands/commandHandler.js — Dynamic Command Loader
 *
 * Recursively scans the commands/ directory tree and registers every
 * file that exports a valid command object. No imports needed in bot.js.
 *
 * Command contract: each command file must export:
 *   {
 *     data: SlashCommandBuilder,    // discord.js builder
 *     execute(interaction, client)  // async handler
 *   }
 *
 * To add a new command: drop a new .js file in any subfolder.
 * Nothing else needs to change.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

class CommandHandler {
  constructor(client) {
    this.client = client;
    this.commandsDir = path.join(__dirname, "..", "commands");
  }

  /**
   * loadAll() — walks the directory tree and loads every valid command.
   */
  async loadAll() {
    const files = this.#walkDir(this.commandsDir).filter(
      (f) => f.endsWith(".js") && !f.includes("commandHandler.js"),
    );

    let loaded = 0;
    for (const file of files) {
      try {
        // Clear require cache in development for hot reloads
        delete require.cache[require.resolve(file)];
        const command = require(file);

        if (!command.data || !command.execute) {
          logger.warn(
            `Skipping ${path.basename(file)} — missing data or execute`,
          );
          continue;
        }

        this.client.commands.set(command.data.name, command);
        logger.debug(`Loaded command: /${command.data.name}`);
        loaded++;
      } catch (err) {
        logger.error(`Failed to load command ${file}:`, err);
      }
    }

    logger.info(`Loaded ${loaded} slash command(s).`);
  }

  /**
   * Recursively returns all .js file paths under a directory.
   * @private
   */
  #walkDir(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.#walkDir(full));
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        results.push(full);
      }
    }
    return results;
  }
}

module.exports = CommandHandler;
