# Project Structure

```
pengmin-bot/
├── index.js                  # Entry point — env validation, process guards, bot boot
├── src/
│   ├── bot.js                # Discord client setup, event routing (keep thin)
│   ├── ai/
│   │   ├── aiController.js   # Orchestration: memory → prompt → AI → Discord reply
│   │   ├── aiService.js      # OpenAI API only: chat() agentic loop + summarize()
│   │   ├── prompts.js        # System prompt builder (persona + context + role modifiers)
│   │   └── tools.js          # Tool definitions (OpenAI format) + executors
│   ├── commands/
│   │   ├── fun/              # gif.js, guess.js
│   │   ├── music/            # play, pause, resume, skip, stop, queue, loop, volume, nowplaying, leave
│   │   └── utility/          # ping, help, userinfo, memory
│   ├── handlers/
│   │   └── commandHandler.js # Recursively auto-loads all commands from commands/
│   ├── memory/
│   │   ├── memoryManager.js  # Two-tier memory: in-process Map + optional PostgreSQL
│   │   └── database.js       # PostgreSQL adapter (no-op if DATABASE_URL not set)
│   ├── middleware/
│   │   ├── rateLimiter.js    # Per-user rate limiting for AI interactions
│   │   └── security.js       # Input sanitization, URL safety checks
│   ├── music/
│   │   ├── musicManager.js   # DisTube wrapper — singleton, exposes play/pause/skip/etc.
│   │   └── musicUtils.js     # Embed builders for music responses
│   └── utils/
│       ├── logger.js         # Shared logger
│       └── helpers.js        # chunkMessage() and other utilities
├── data/
│   ├── persona.md            # Bot character definition (loaded once at startup)
│   └── context.md            # World/lore context for the AI system prompt
├── scripts/
│   └── auth.js               # Standalone utility script
└── .env                      # Environment variables (never commit)
```

## Key Architectural Patterns

- **Layered AI pipeline**: `bot.js` → `aiController.js` (orchestration) → `aiService.js` (API only). Each layer has a single responsibility. Swap the AI provider by changing only `aiService.js`.
- **Auto-loading commands**: Drop any `.js` file with `{ data, execute }` exports into `src/commands/**` and it loads automatically. No imports needed elsewhere.
- **Singleton services**: `musicManager` and `memoryManager` are module-level singletons — import directly, don't instantiate.
- **Per-guild callbacks**: Music commands register one-shot `{ onPlay, onAdd, onErr }` callbacks via `musicManager.setPendingCallback()` before calling `play()`. Central DisTube event handlers dispatch and clean up immediately.
- **Optional persistence**: All DB calls are guarded by `db.isEnabled()`. The bot runs fully in-memory without `DATABASE_URL`.
- **Persona files loaded once**: `data/persona.md` and `data/context.md` are read at `prompts.js` module load time, not on every message.

## Adding New Things

- **New slash command**: Create a `.js` file in the appropriate `src/commands/<category>/` subfolder exporting `{ data: SlashCommandBuilder, execute(interaction, client) }`.
- **New AI tool**: Add a definition to `TOOL_DEFINITIONS` and a case in `executeTool()` in `src/ai/tools.js`. No other file needs to change.
- **New role modifier**: Add an entry to `ROLE_MODIFIERS` in `src/ai/prompts.js`. Order determines priority — first match wins.
