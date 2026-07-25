/**
 * src/ai/sentimentAnalyzer.js — Sentiment Analyzer
 *
 * Lightweight in-process sentiment analysis with optional AI-assisted mode.
 * Runs on every incoming message to produce a SentimentResult that feeds
 * into the system prompt as a behavioral modifier.
 *
 * Default mode: pure heuristic (no external API, zero latency cost).
 * AI mode: set SENTIMENT_AI_MODE=true — calls OpenAI with a minimal
 *          classification prompt to override tone/emotion/confidence while
 *          preserving the heuristic urgency score.
 *
 * SentimentResult shape:
 *   { tone, urgency, primaryEmotion, confidence }
 *   tone: 'positive' | 'neutral' | 'negative' | 'distressed'
 *   urgency: 0.0–1.0
 *   primaryEmotion: string (e.g. 'curious', 'frustrated', 'excited')
 *   confidence: 0.0–1.0
 */

const logger = require("../utils/logger");

// ── Keyword Dictionaries ──────────────────────────────────────────────────────

const POSITIVE_KEYWORDS = [
  "love", "great", "awesome", "amazing", "happy", "excited", "wonderful",
  "fantastic", "good", "nice", "excellent", "beautiful", "perfect", "thanks",
  "thank", "appreciate", "grateful", "glad", "joy", "fun", "cool", "brilliant",
  "incredible", "superb", "delighted", "pleased", "enjoy", "enjoyed",
];

const NEGATIVE_KEYWORDS = [
  "hate", "bad", "terrible", "awful", "horrible", "disgusting", "angry",
  "annoyed", "frustrated", "sad", "depressed", "awful", "worst", "stupid",
  "useless", "broken", "failed", "wrong", "error", "bug", "crash", "mad",
  "disappointed", "boring", "dumb", "ugly", "terrible", "trash", "garbage",
];

const URGENCY_PATTERNS = [
  /\bhelp\b/i,
  /\burgent\b/i,
  /\basap\b/i,
  /\bplease\b.*\bhelp\b/i,
  /\bcan('t|not)\b/i,
  /\bstuck\b/i,
  /\bbroken\b/i,
  /\bcrash(ing|ed)?\b/i,
  /\bemergency\b/i,
  /\bpanic\b/i,
  /\bdesperate\b/i,
  /!!+/,
  /\?\?+/,
];

// Emotion keyword → emotion label mapping
const EMOTION_MAP = [
  { keywords: ["excited", "amazing", "incredible", "wow", "omg", "woah"], emotion: "excited" },
  { keywords: ["curious", "wonder", "how", "why", "what if", "interesting"], emotion: "curious" },
  { keywords: ["frustrated", "annoyed", "ugh", "argh", "ugh", "sigh"], emotion: "frustrated" },
  { keywords: ["confused", "lost", "don't understand", "unclear", "huh", "what"], emotion: "confused" },
  { keywords: ["sad", "depressed", "down", "upset", "crying", "cry"], emotion: "sad" },
  { keywords: ["angry", "furious", "rage", "hate", "mad", "pissed"], emotion: "angry" },
  { keywords: ["grateful", "thankful", "appreciate", "thanks", "thank you"], emotion: "grateful" },
  { keywords: ["worried", "anxious", "scared", "nervous", "fear", "afraid"], emotion: "anxious" },
];

// ── Core Analysis ─────────────────────────────────────────────────────────────

/**
 * analyze()
 * Performs heuristic sentiment analysis on a message string.
 * Optionally upgrades to AI-assisted classification when SENTIMENT_AI_MODE=true.
 *
 * @param {string} text  The message content to analyze. Not mutated.
 * @returns {Promise<SentimentResult> | SentimentResult}
 */
function analyze(text) {
  // Guard: empty or non-string input
  if (typeof text !== "string" || text.length === 0) {
    return { tone: "neutral", urgency: 0, primaryEmotion: "neutral", confidence: 0 };
  }

  const result = heuristicAnalyze(text);

  if (process.env.SENTIMENT_AI_MODE === "true") {
    return aiEnhancedAnalyze(text, result);
  }

  return result;
}

/**
 * analyzeHistory()
 * Analyzes an array of message objects and returns trend info.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {{ trend: string, dominantEmotion: string }}
 */
function analyzeHistory(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { trend: "neutral", dominantEmotion: "neutral" };
  }

  // Only analyze user messages
  const userMessages = messages.filter((m) => m.role === "user" && m.content);
  if (userMessages.length === 0) {
    return { trend: "neutral", dominantEmotion: "neutral" };
  }

  const results = userMessages.map((m) => heuristicAnalyze(m.content));

  // Count tone distribution
  const toneCounts = { positive: 0, neutral: 0, negative: 0, distressed: 0 };
  const emotionCounts = {};

  for (const r of results) {
    toneCounts[r.tone] = (toneCounts[r.tone] || 0) + 1;
    emotionCounts[r.primaryEmotion] = (emotionCounts[r.primaryEmotion] || 0) + 1;
  }

  // Determine trend
  const sorted = Object.entries(toneCounts).sort((a, b) => b[1] - a[1]);
  const trend = sorted[0][0];

  // Determine dominant emotion
  const dominantEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral";

  return { trend, dominantEmotion };
}

// ── Heuristic Engine ──────────────────────────────────────────────────────────

function heuristicAnalyze(text) {
  const lower = text.toLowerCase();

  let score = 0;
  let urgency = 0.0;

  // Score positive keywords
  for (const word of POSITIVE_KEYWORDS) {
    if (lower.includes(word)) score += 1;
  }

  // Score negative keywords
  for (const word of NEGATIVE_KEYWORDS) {
    if (lower.includes(word)) score -= 1;
  }

  // Detect urgency signals
  for (const pattern of URGENCY_PATTERNS) {
    if (pattern.test(lower)) {
      urgency = Math.min(urgency + 0.3, 1.0);
    }
  }

  // Distress override: high urgency + negative score
  if (urgency >= 0.7 && score < 0) {
    return {
      tone: "distressed",
      urgency,
      primaryEmotion: "distressed",
      confidence: 0.8,
    };
  }

  // Standard tone classification
  let tone;
  if (score > 1) tone = "positive";
  else if (score < -1) tone = "negative";
  else tone = "neutral";

  const primaryEmotion = detectPrimaryEmotion(lower);

  return {
    tone,
    urgency,
    primaryEmotion,
    confidence: 0.6,
  };
}

function detectPrimaryEmotion(lowerText) {
  for (const { keywords, emotion } of EMOTION_MAP) {
    if (keywords.some((kw) => lowerText.includes(kw))) {
      return emotion;
    }
  }
  return "neutral";
}

// ── AI-Enhanced Mode ──────────────────────────────────────────────────────────

async function aiEnhancedAnalyze(text, heuristicResult) {
  try {
    const OpenAI = require("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 60,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Classify the sentiment of the message. " +
            "Reply with ONLY a JSON object: " +
            '{"tone":"positive"|"neutral"|"negative"|"distressed","primaryEmotion":"string","confidence":0.0-1.0}. ' +
            "No explanation.",
        },
        { role: "user", content: text.slice(0, 500) },
      ],
    });

    const raw = response.choices[0].message.content?.trim();
    const parsed = JSON.parse(raw);

    return {
      tone: ["positive", "neutral", "negative", "distressed"].includes(parsed.tone)
        ? parsed.tone
        : heuristicResult.tone,
      urgency: heuristicResult.urgency, // always preserved from heuristic
      primaryEmotion: parsed.primaryEmotion || heuristicResult.primaryEmotion,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : heuristicResult.confidence,
    };
  } catch (err) {
    logger.warn("[Sentiment] AI mode failed, using heuristic result:", err.message);
    return heuristicResult;
  }
}

module.exports = { analyze, analyzeHistory };
