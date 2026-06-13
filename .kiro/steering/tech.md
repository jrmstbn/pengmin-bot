# Tech Stack

## Runtime & Language
- **Node.js** — CommonJS modules (`require`/`module.exports` throughout, no ESM)
- **JavaScript** — no TypeScript, no transpilation

## Key Libraries

| Library | Purpose |
|---|---|
| `discord.js` v14 | Discord client, slash commands, embeds |
| `distube` v5 | Music queue and playback orchestration |
| `@distube/yt-dlp` | YouTube extraction via yt-dlp binary |
| `@distube/youtube` | Additional YouTube plugin for DisTube |
| `ffmpeg-static` | Bundled ffmpeg binary — no system install needed |
| `openai` v6 | GPT chat completions + tool calling |
| `pg` | PostgreSQL client (optional, only if `DATABASE_URL` is set) |
| `axios` | HTTP requests |
| `dotenv` | Environment variable loading |

## External APIs (configured via `.env`)
- **OpenAI** — AI conversation (`OPENAI_API_KEY`, `OPENAI_MODEL`, `MAX_TOKENS`, `TEMPERATURE`)
- **NewsAPI** — News headlines (`NEWS_API_KEY`)
- **Tavily** — Web search (`TAVILY_API_KEY`)
- **Tenor or Giphy** — GIF search (`TENOR_API_KEY` / `GIPHY_API_KEY`)
- **PostgreSQL** — Conversation persistence (`DATABASE_URL`, `DB_SSL`)

## Environment Variables
Required at startup: `DISCORD_TOKEN`, `OPENAI_API_KEY`  
Optional: `CLIENT_ID` (required for command registration), `DATABASE_URL`, `NEWS_API_KEY`, `TAVILY_API_KEY`, `TENOR_API_KEY`, `GIPHY_API_KEY`, `OPENAI_MODEL`, `MAX_TOKENS`, `TEMPERATURE`, `MAX_HISTORY_MESSAGES`, `SUMMARIZE_THRESHOLD`, `REGISTER_COMMANDS`, `HEALTH_PORT` (default `8080`, set to `0` to disable), `LOG_LEVEL`

## Common Commands

```bash
# Start the bot
node index.js
# or
npm start

# Start with auto-restart on file changes (development)
npm run dev

# Register slash commands with Discord (run once per deploy)
REGISTER_COMMANDS=true node index.js
# or on Windows CMD:
set REGISTER_COMMANDS=true && node index.js
```

## Package Manager
`pnpm` is preferred (pnpm-lock.yaml present), though `package-lock.json` also exists. Use `pnpm install` for dependency management.
