/**
 * src/ai/tools.js — Tool Definitions & Executor
 *
 * Defines all tools available to the AI model (OpenAI function-calling format)
 * and implements each tool's execution logic.
 *
 * To add a new tool:
 *   1. Add a definition object to TOOL_DEFINITIONS.
 *   2. Add a matching case in executeTool().
 *   3. That's it — aiService.js automatically passes them to the model.
 */

const logger = require("../utils/logger");
const { isSafeUrl } = require("../middleware/security");

// ─── Tool Definitions (OpenAI format) ────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description:
        "Returns the current date and time. Use when the user asks about the time or date.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_latest_news",
      description:
        "Fetches the latest top headlines. Use for questions about current events or recent news.",
      parameters: {
        type: "object",
        properties: {
          country: {
            type: "string",
            description: "ISO 3166-1 alpha-2 country code (default: ph).",
          },
          category: {
            type: "string",
            enum: [
              "business",
              "entertainment",
              "general",
              "health",
              "science",
              "sports",
              "technology",
            ],
            description: "News category filter.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "Searches the internet for factual or up-to-date information. " +
        "Use for specific questions where internal knowledge may be outdated.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query string.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_gif",
      description: "Finds a relevant GIF URL for a given search term.",
      parameters: {
        type: "object",
        properties: {
          search_term: {
            type: "string",
            description: "The topic or emotion to find a GIF for.",
          },
        },
        required: ["search_term"],
      },
    },
  },
];

// ─── Tool Executors ───────────────────────────────────────────────────────────

/**
 * Dispatches a tool call by name and returns the result.
 * All tool functions are async-safe — errors are caught and returned
 * as structured error objects so the AI can handle them gracefully.
 */
async function executeTool(name, args = {}) {
  try {
    switch (name) {
      case "get_current_time":
        return getCurrentTime();

      case "get_latest_news":
        return await getLatestNews(args.country, args.category);

      case "search_web":
        return await searchWeb(args.query);

      case "get_gif":
        return await getGif(args.search_term);

      default:
        logger.warn(`Unknown tool called: ${name}`);
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    logger.error(`Tool [${name}] failed:`, err.message);
    return { error: err.message };
  }
}

// ─── Individual Tool Implementations ─────────────────────────────────────────

function getCurrentTime() {
  const now = new Date();
  return {
    utc: now.toUTCString(),
    iso: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    unix: Math.floor(now.getTime() / 1000),
  };
}

async function getLatestNews(country = "ph", category = "general") {
  if (!process.env.NEWS_API_KEY) {
    return { error: "NEWS_API_KEY not configured." };
  }

  const url = new URL("https://newsapi.org/v2/top-headlines");
  url.searchParams.set("country", country);
  url.searchParams.set("category", category);
  url.searchParams.set("pageSize", "5");
  url.searchParams.set("apiKey", process.env.NEWS_API_KEY);

  const urlStr = url.toString();
  if (!isSafeUrl(urlStr)) throw new Error("NewsAPI URL failed safety check.");

  const res = await fetch(urlStr);
  if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`);

  const data = await res.json();
  return {
    articles: data.articles.map((a) => ({
      title: a.title,
      source: a.source?.name,
      description: a.description,
      url: a.url,
      publishedAt: a.publishedAt,
    })),
  };
}

async function searchWeb(query) {
  if (!process.env.TAVILY_API_KEY) {
    return { error: "TAVILY_API_KEY not configured." };
  }

  const endpoint = "https://api.tavily.com/search";
  if (!isSafeUrl(endpoint)) throw new Error("Tavily URL failed safety check.");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 5,
    }),
  });

  if (!res.ok) throw new Error(`Tavily error: ${res.status}`);

  const data = await res.json();
  return {
    results: (data.results || []).map((r) => ({
      title: r.title,
      content: r.content?.slice(0, 500), // trim to save tokens
      url: r.url,
    })),
  };
}

async function getGif(searchTerm) {
  const key = process.env.GIPHY_API_KEY || process.env.TENOR_API_KEY;
  if (!key) return { error: "No GIF API key configured." };

  // Prefer Tenor if key is set for it specifically
  if (process.env.TENOR_API_KEY) {
    const url = new URL("https://tenor.googleapis.com/v2/search");
    url.searchParams.set("q", searchTerm);
    url.searchParams.set("key", process.env.TENOR_API_KEY);
    url.searchParams.set("limit", "1");
    url.searchParams.set("contentfilter", "medium");

    const urlStr = url.toString();
    if (!isSafeUrl(urlStr)) throw new Error("Tenor URL failed safety check.");

    const res = await fetch(urlStr);
    const data = await res.json();
    const gif = data.results?.[0]?.media_formats?.gif?.url;
    return gif ? { url: gif } : { error: "No GIF found." };
  }

  // Fallback to Giphy
  const url = new URL("https://api.giphy.com/v1/gifs/search");
  url.searchParams.set("q", searchTerm);
  url.searchParams.set("api_key", process.env.GIPHY_API_KEY);
  url.searchParams.set("limit", "1");
  url.searchParams.set("rating", "pg-13");

  const urlStr = url.toString();
  if (!isSafeUrl(urlStr)) throw new Error("Giphy URL failed safety check.");

  const res = await fetch(urlStr);
  const data = await res.json();
  const gif = data.data?.[0]?.images?.original?.url;
  return gif ? { url: gif } : { error: "No GIF found." };
}

module.exports = { TOOL_DEFINITIONS, executeTool };
