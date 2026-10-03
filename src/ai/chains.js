/**
 * src/ai/chains.js — Skill Chain Definitions
 *
 * Registers all compound tool pipelines with SkillChainExecutor.
 * Each chain is a named sequence of tool calls where each step's output
 * feeds into the next step's argsMapper.
 *
 * To add a new chain:
 *   1. Call SkillChain.define(name, config) below.
 *   2. That's it — aiService.js picks it up via the require('./chains') call.
 *
 * Chain names must NOT conflict with registered tool names.
 * Tool names available: get_current_time, get_latest_news, search_web,
 * send_gif, analyze_image, read_code_snippet, get_weather, translate_text,
 * create_poll, get_server_stats, recall_user_facts, summarize_channel.
 *
 * Chains defined here:
 *   - news_briefing        — fetches headlines then web-searches for deeper context
 *   - weather_and_time     — gets current time then weather for a city
 *   - search_and_translate — web-searches a topic then translates the summary
 *   - user_briefing        — recalls user facts then fetches relevant news for them
 */

const SkillChain = require("./skillChain");
const logger = require("../utils/logger");

// ── Chain: news_briefing ───────────────────────────────────────────────────────
// Fetches top headlines for a category, then does a targeted web search to get
// more depth on the top story. Good for "what's happening in [topic]?" queries.

SkillChain.define("news_briefing", {
  description:
    "Fetches top news headlines for a category then performs a focused web search " +
    "on the leading headline for richer context.",
  steps: [
    {
      tool: "get_latest_news",
      /**
       * Step 1: fetch headlines.
       * initialArgs may carry { category, country } from the AI.
       */
      argsMapper: (_prev, initial) => ({
        country: initial.country ?? "ph",
        category: initial.category ?? "general",
      }),
    },
    {
      tool: "search_web",
      /**
       * Step 2: search for the first article's title to get deeper context.
       * prev is the get_latest_news result: { articles: [{ title, description, url }] }
       */
      argsMapper: (prev, initial) => {
        const firstTitle =
          prev?.articles?.[0]?.title ??
          initial.query ??
          "latest news";
        return { query: firstTitle };
      },
    },
  ],
});

// ── Chain: weather_and_time ────────────────────────────────────────────────────
// Returns the current local time alongside weather for a given city.
// Useful for grounding weather context with the current date/time.

SkillChain.define("weather_and_time", {
  description:
    "Gets the current date/time then fetches current weather for a city, " +
    "returning both in one structured result.",
  steps: [
    {
      tool: "get_current_time",
      /** Step 1: get the current time — no args needed. */
      argsMapper: () => ({}),
    },
    {
      tool: "get_weather",
      /**
       * Step 2: fetch weather for the requested city.
       * initialArgs carries { city, units } from the AI.
       * prev is the time result but we don't need it here — we just pass it
       * through by merging it into the return value via a wrapper.
       */
      argsMapper: (_prev, initial) => ({
        city: initial.city,
        units: initial.units ?? "metric",
      }),
    },
  ],
});

// ── Chain: search_and_translate ────────────────────────────────────────────────
// Searches the web for a topic, then translates the summary snippet into a
// target language. Useful when a user wants information in their language.

SkillChain.define("search_and_translate", {
  description:
    "Performs a web search on a query then translates the result summary into " +
    "the requested target language.",
  steps: [
    {
      tool: "search_web",
      /**
       * Step 1: search for the topic.
       * initialArgs carries { query, target_language }.
       */
      argsMapper: (_prev, initial) => ({
        query: initial.query,
      }),
    },
    {
      tool: "translate_text",
      /**
       * Step 2: translate the search snippet.
       * prev is the search_web result: { results: [{ title, snippet }] }
       */
      argsMapper: (prev, initial) => {
        const snippet =
          prev?.results?.[0]?.snippet ??
          prev?.snippet ??
          JSON.stringify(prev ?? "");
        return {
          text: snippet,
          target_language: initial.target_language ?? "English",
        };
      },
    },
  ],
});

// ── Chain: user_briefing ───────────────────────────────────────────────────────
// Recalls notable facts about a user then fetches news relevant to their
// known interests. Useful for personalised "anything I should know?" queries.

SkillChain.define("user_briefing", {
  description:
    "Recalls a user's stored profile facts and then fetches news matching " +
    "their known interests, producing a personalised briefing.",
  steps: [
    {
      tool: "recall_user_facts",
      /**
       * Step 1: retrieve the user's stored facts.
       * initialArgs carries { userId, guildId } forwarded by the AI from context.
       */
      argsMapper: (_prev, initial) => ({
        userId: initial.userId,
        guildId: initial.guildId,
      }),
    },
    {
      tool: "get_latest_news",
      /**
       * Step 2: fetch news relevant to the user's first topic of interest.
       * prev is { facts: string[] } — we map topics to a news category if
       * possible, otherwise default to "general".
       */
      argsMapper: (prev, initial) => {
        const TOPIC_CATEGORY_MAP = {
          sports: "sports",
          football: "sports",
          basketball: "sports",
          esports: "sports",
          gaming: "technology",
          tech: "technology",
          technology: "technology",
          science: "science",
          health: "health",
          finance: "business",
          business: "business",
          economy: "business",
          entertainment: "entertainment",
          anime: "entertainment",
          music: "entertainment",
          films: "entertainment",
          movies: "entertainment",
        };

        const facts = prev?.facts ?? [];
        let category = "general";
        for (const fact of facts) {
          const lower = fact.toLowerCase();
          for (const [keyword, cat] of Object.entries(TOPIC_CATEGORY_MAP)) {
            if (lower.includes(keyword)) {
              category = cat;
              break;
            }
          }
          if (category !== "general") break;
        }

        return {
          country: initial.country ?? "ph",
          category,
        };
      },
    },
  ],
});

logger.debug("[SkillChain] Chains registered: news_briefing, weather_and_time, search_and_translate, user_briefing");
