/**
 * src/ai/tools.js — Tool Definitions & Registration
 *
 * Registers all AI tools with the central ToolRegistry.
 * Each tool has an OpenAI function-calling definition and an executor.
 *
 * To add a new tool:
 *   1. Call ToolRegistry.register(definition, executor) below.
 *   2. That's it — aiService.js picks up all tools via ToolRegistry.getDefinitions().
 *
 * Legacy exports (TOOL_DEFINITIONS, executeTool) are kept for backward
 * compatibility but now delegate to the registry.
 */

const logger = require("../utils/logger");
const { isSafeUrl } = require("../middleware/security");
const ToolRegistry = require("./toolRegistry");

// ── Existing Tools ────────────────────────────────────────────────────────────

ToolRegistry.register(
  {
    type: "function",
    function: {
      name: "get_current_time",
      description:
        "Returns the current date and time. Use when the user asks about the time or date.",
      parameters: { type: "object", properties: {} },
    },
  },
  async () => getCurrentTime()
);

ToolRegistry.register(
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
  async (args) => getLatestNews(args.country, args.category)
);

ToolRegistry.register(
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
  async (args) => searchWeb(args.query)
);

ToolRegistry.register(
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
  async (args) => getGif(args.search_term)
);

// ── New Tools ─────────────────────────────────────────────────────────────────

ToolRegistry.register(
  {
    type: "function",
    function: {
      name: "analyze_image",
      description:
        "Analyzes an image from a URL and returns a description, detected objects, " +
        "estimated mood, and safety classification. Use when the user shares an image " +
        "and wants commentary or analysis.",
      parameters: {
        type: "object",
        properties: {
          image_url: {
            type: "string",
            description: "The direct URL to the image.",
          },
          prompt: {
            type: "string",
            description: "Optional instruction for what to focus on in the image.",
          },
        },
        required: ["image_url"],
      },
    },
  },
  async (args) => {
    // Implemented in Task 4 (visionService.js).
    // This stub is replaced once VisionService is available.
    try {
      const VisionService = require("./visionService");
      return await VisionService.describeImage(args.image_url, args.prompt || "Describe this image.");
    } catch {
      return { error: "Vision service not yet available." };
    }
  }
);

ToolRegistry.register(
  {
    type: "function",
    function: {
      name: "read_code_snippet",
      description:
        "Analyzes a code snippet and returns a plain-language summary, the detected " +
        "programming language, and line count. Use when a user pastes code and asks " +
        "what it does.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The code snippet to analyze.",
          },
          language: {
            type: "string",
            description: "Optional hint for the programming language.",
          },
        },
        required: ["code"],
      },
    },
  },
  async (args) => readCodeSnippet(args.code, args.language)
);

ToolRegistry.register(
  {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "Gets the current weather conditions for a city. Use when the user asks " +
        "about weather, temperature, or forecast.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "City name to look up.",
          },
          units: {
            type: "string",
            enum: ["metric", "imperial"],
            description: "Temperature units — metric (Celsius) or imperial (Fahrenheit). Default: metric.",
          },
        },
        required: ["city"],
      },
    },
  },
  async (args) => getWeather(args.city, args.units || "metric")
);

ToolRegistry.register(
  {
    type: "function",
    function: {
      name: "translate_text",
      description:
        "Translates text into a target language. Use when the user asks for a " +
        "translation or to communicate in another language.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to translate.",
          },
          target_language: {
            type: "string",
            description: "Target language name or ISO 639-1 code (e.g. 'Spanish', 'ja').",
          },
        },
        required: ["text", "target_language"],
      },
    },
  },
  async (args) => translateText(args.text, args.target_language)
);

ToolRegistry.register(
  {
    type: "function",
    function: {
      name: "create_poll",
      description:
        "Formats a poll with a question and answer options, ready to post in Discord. " +
        "Use when the user asks to create a vote or poll.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The poll question.",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Array of answer options (2–10 items).",
          },
        },
        required: ["question", "options"],
      },
    },
  },
  async (args) => createPoll(args.question, args.options)
);

ToolRegistry.register(
  {
    type: "function",
    function: {
      name: "get_server_stats",
      description:
        "Returns basic statistics about the current Discord server: member count, " +
        "channel count, and role count. Use when asked about server size or composition.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  async (_args, context) => getServerStats(context)
);

ToolRegistry.register(
  {
    type: "function",
    function: {
      name: "recall_user_facts",
      description:
        "Recalls notable facts the Endministrator has noted about a specific user " +
        "from previous interactions. Use to personalize responses for known operators.",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Discord user ID.",
          },
          guildId: {
            type: "string",
            description: "Discord guild ID.",
          },
        },
        required: ["userId", "guildId"],
      },
    },
  },
  async (args) => {
    // Stub: replaced in Task 13 once UserProfileStore is available.
    try {
      const UserProfileStore = require("../memory/userProfileStore");
      const facts = await UserProfileStore.getUserFacts(args.userId, args.guildId);
      return { facts };
    } catch {
      return { facts: [] };
    }
  }
);

ToolRegistry.register(
  {
    type: "function",
    function: {
      name: "summarize_channel",
      description:
        "Fetches recent messages from a Discord channel and returns a concise summary " +
        "of what was discussed. Use when asked to recap recent activity.",
      parameters: {
        type: "object",
        properties: {
          channel_id: {
            type: "string",
            description: "The Discord channel ID to summarize.",
          },
          limit: {
            type: "number",
            description: "Number of recent messages to fetch (default: 20, max: 50).",
          },
        },
        required: ["channel_id"],
      },
    },
  },
  async (args, context) => summarizeChannel(args.channel_id, args.limit || 20, context)
);

// ── Individual Tool Implementations ──────────────────────────────────────────

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
      content: r.content?.slice(0, 500),
      url: r.url,
    })),
  };
}

async function getGif(searchTerm) {
  const key = process.env.GIPHY_API_KEY || process.env.TENOR_API_KEY;
  if (!key) return { error: "No GIF API key configured." };

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

function readCodeSnippet(code, languageHint) {
  if (!code || typeof code !== "string") {
    return { error: "No code provided." };
  }

  const lines = code.split("\n");
  const lineCount = lines.length;

  // Heuristic language detection
  const detectedLanguage = languageHint || detectLanguage(code);

  // Build a basic structural summary
  const summary = buildCodeSummary(code, detectedLanguage, lines);

  return { summary, detectedLanguage, lineCount };
}

function detectLanguage(code) {
  if (/^\s*(import|export|const|let|var|=>|async\s+function)/m.test(code)) return "JavaScript";
  if (/^\s*(def |class |import |from .+ import|print\()/m.test(code)) return "Python";
  if (/^\s*(public|private|protected|class\s+\w+|void\s+\w+\s*\()/m.test(code)) return "Java";
  if (/#include|int\s+main\s*\(/m.test(code)) return "C/C++";
  if (/^\s*(fn |use |let\s+mut|impl\s+)/m.test(code)) return "Rust";
  if (/^\s*(func |package |import\s+")/m.test(code)) return "Go";
  if (/<\?php/i.test(code)) return "PHP";
  if (/^\s*<[a-zA-Z][\s\S]*>/m.test(code)) return "HTML/XML";
  if (/^\s*[\.\#][a-zA-Z][\w-]*\s*\{/m.test(code)) return "CSS";
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\s/im.test(code)) return "SQL";
  return "Unknown";
}

function buildCodeSummary(code, language, lines) {
  const parts = [];

  // Count functions/methods
  const fnMatches = code.match(/\b(function\s+\w+|def\s+\w+|func\s+\w+|\w+\s*=\s*(async\s*)?\()/g);
  if (fnMatches && fnMatches.length > 0) {
    parts.push(`${fnMatches.length} function(s) or method(s) detected`);
  }

  // Count classes
  const classMatches = code.match(/\bclass\s+\w+/g);
  if (classMatches && classMatches.length > 0) {
    parts.push(`${classMatches.length} class definition(s)`);
  }

  // Detect imports
  const importMatches = code.match(/^\s*(import|require|from|#include)/gm);
  if (importMatches && importMatches.length > 0) {
    parts.push(`${importMatches.length} import/include statement(s)`);
  }

  // Detect loops
  const loopMatches = code.match(/\b(for|while|forEach|map|filter|reduce)\b/g);
  if (loopMatches && loopMatches.length > 0) {
    parts.push(`${loopMatches.length} loop or iteration construct(s)`);
  }

  if (parts.length === 0) {
    return `${lines.length}-line ${language} snippet with no immediately identifiable structures.`;
  }

  return `${language} snippet (${lines.length} lines): ${parts.join(", ")}.`;
}

async function getWeather(city, units = "metric") {
  if (!process.env.WEATHER_API_KEY) {
    return { error: "WEATHER_API_KEY not configured." };
  }

  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("q", city);
  url.searchParams.set("appid", process.env.WEATHER_API_KEY);
  url.searchParams.set("units", units);

  const urlStr = url.toString();
  if (!isSafeUrl(urlStr)) return { error: "Weather API URL failed safety check." };

  const res = await fetch(urlStr);
  if (!res.ok) {
    if (res.status === 404) return { error: `City not found: ${city}` };
    throw new Error(`OpenWeatherMap error: ${res.status}`);
  }

  const data = await res.json();
  const unitSymbol = units === "imperial" ? "°F" : "°C";

  return {
    city: data.name,
    country: data.sys?.country,
    temperature: `${Math.round(data.main.temp)}${unitSymbol}`,
    feelsLike: `${Math.round(data.main.feels_like)}${unitSymbol}`,
    description: data.weather[0]?.description,
    humidity: `${data.main.humidity}%`,
    windSpeed: `${data.wind?.speed} ${units === "imperial" ? "mph" : "m/s"}`,
  };
}

async function translateText(text, targetLanguage) {
  if (!process.env.TRANSLATE_API_KEY) {
    return { error: "TRANSLATE_API_KEY not configured." };
  }

  const url = new URL("https://translation.googleapis.com/language/translate/v2");
  url.searchParams.set("key", process.env.TRANSLATE_API_KEY);

  const urlStr = url.toString();
  if (!isSafeUrl(urlStr)) return { error: "Translate API URL failed safety check." };

  const res = await fetch(urlStr, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, target: targetLanguage }),
  });

  if (!res.ok) throw new Error(`Translation API error: ${res.status}`);

  const data = await res.json();
  const translation = data.data?.translations?.[0];
  if (!translation) return { error: "No translation returned." };

  return {
    translatedText: translation.translatedText,
    detectedSourceLanguage: translation.detectedSourceLanguage,
    targetLanguage,
  };
}

function createPoll(question, options) {
  if (!Array.isArray(options) || options.length < 2) {
    return { error: "A poll requires at least 2 options." };
  }
  if (options.length > 10) {
    return { error: "A poll can have at most 10 options." };
  }

  // Standard emoji numbers for Discord polls
  const EMOJI_NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

  const formatted = [
    `📊 **${question}**`,
    "",
    ...options.map((opt, i) => `${EMOJI_NUMBERS[i]} ${opt}`),
  ].join("\n");

  return { pollText: formatted, optionCount: options.length };
}

async function getServerStats(context) {
  const guild = context?.message?.guild ?? context?.guild ?? null;

  if (!guild) {
    return { error: "Server context unavailable — cannot retrieve stats." };
  }

  // Fetch full member list if not already cached
  await guild.members.fetch().catch(() => {});

  return {
    name: guild.name,
    memberCount: guild.memberCount,
    channelCount: guild.channels.cache.size,
    roleCount: guild.roles.cache.size,
    createdAt: guild.createdAt.toISOString(),
    ownerId: guild.ownerId,
  };
}

async function summarizeChannel(channelId, limit, context) {
  const client = context?.client ?? context?.message?.client ?? null;

  if (!client) {
    return { error: "Discord client context unavailable." };
  }

  // Clamp limit to a safe range
  const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 50);

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    return { error: `Could not fetch channel: ${channelId}` };
  }

  if (!channel?.isTextBased?.()) {
    return { error: "Channel is not a text channel." };
  }

  let messages;
  try {
    const fetched = await channel.messages.fetch({ limit: safeLimit });
    messages = Array.from(fetched.values())
      .filter((m) => !m.author.bot && m.content?.trim())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => `${m.author.username}: ${m.content.slice(0, 200)}`);
  } catch {
    return { error: "Failed to fetch messages from channel." };
  }

  if (messages.length === 0) {
    return { summary: "No recent non-bot messages found in this channel." };
  }

  // Simple extractive summary: return first + last few messages and count
  const preview = [
    ...messages.slice(0, 3),
    messages.length > 6 ? `... (${messages.length - 6} more messages) ...` : null,
    ...messages.slice(-3),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: preview,
    messageCount: messages.length,
    channelId,
  };
}

// ── Legacy compatibility exports ──────────────────────────────────────────────
// aiService.js still imports these; they now delegate to the registry.

const TOOL_DEFINITIONS = ToolRegistry.getDefinitions();

async function executeTool(name, args, context) {
  return ToolRegistry.execute(name, args, context);
}

module.exports = { TOOL_DEFINITIONS, executeTool, ToolRegistry };
