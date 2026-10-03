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
- **OpenWeatherMap** — Weather tool + `weather_and_time` chain (`WEATHER_API_KEY`). Free tier at openweathermap.org/api.
- **Google Cloud Translation** — Translate tool + `search_and_translate` chain (`TRANSLATE_API_KEY`). Uses Translation API v2 (Basic).

## Environment Variables

**Required at startup:** `DISCORD_TOKEN`, `OPENAI_API_KEY`

**Infrastructure (optional):**

| Variable | Default | Purpose |
|---|---|---|
| `CLIENT_ID` | — | Required for slash command registration |
| `DATABASE_URL` | — | PostgreSQL connection string; bot runs in-memory without it |
| `DB_SSL` | `false` | Set `true` for cloud Postgres (e.g. Heroku, Railway) |
| `HEALTH_PORT` | `8080` | HTTP health check port; set `0` to disable |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `REGISTER_COMMANDS` | `false` | Set `true` once per deploy to register slash commands |

**AI tuning (optional):**

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model to use |
| `MAX_TOKENS` | `1024` | Max tokens per AI response |
| `TEMPERATURE` | `0.7` | Sampling temperature |
| `MAX_HISTORY_MESSAGES` | `16` | Messages kept per user before summarization |
| `SUMMARIZE_THRESHOLD` | `16` | Alias for `MAX_HISTORY_MESSAGES` |

**External tool API keys (optional — tools return errors gracefully without them):**

| Variable | Purpose |
|---|---|
| `NEWS_API_KEY` | `get_latest_news` tool + `news_briefing` chain |
| `TAVILY_API_KEY` | `search_web` tool + `news_briefing` / `search_and_translate` chains |
| `TENOR_API_KEY` | `send_gif` tool (Tenor) |
| `GIPHY_API_KEY` | `send_gif` tool (Giphy fallback) |
| `WEATHER_API_KEY` | `get_weather` tool + `weather_and_time` chain (OpenWeatherMap) |
| `TRANSLATE_API_KEY` | `translate_text` tool + `search_and_translate` chain (Google Cloud Translation v2) |

**Feature flags (all default `false` / disabled):**

| Variable | What it enables |
|---|---|
| `STREAMING_ENABLED` | Real token-by-token streaming via OpenAI `stream:true` + StreamingResponder |
| `PROFILE_EXTRACTION_ENABLED` | Async extraction of `topicsOfInterest` + `notableFacts` per conversation turn |
| `VISION_ENABLED` | Image attachment processing via GPT-4o vision |
| `MODERATION_ENABLED` | OpenAI Moderation API check (local blocklist always runs regardless) |
| `SENTIMENT_AI_MODE` | AI-enhanced sentiment analysis (uses extra tokens per message) |
| `PROACTIVE_ENABLED` | Scheduled/event-driven proactive messages (cron + `guildMemberAdd`) |

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
