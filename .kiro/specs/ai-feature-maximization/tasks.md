# Implementation Plan: AI Feature Maximization

## Overview

Full AI pipeline expansion for the Endministrator bot. Adds dynamic tool registry, skill chain execution, sentiment analysis, vision, user profiles, moderation, proactive engine, and streaming responses — all opt-in via env vars, slotting into the existing layered architecture.

## Tasks

- [x] 1. Create `src/ai/toolRegistry.js` with a Map-backed registry
  - Export `register(definition, executor)`, `execute(name, args, context)`, `getDefinitions()`, `has(name)`
  - All executor errors caught and returned as `{ error }` — never throws
  - **Requirement**: 1.1–1.5

- [x] 2. Migrate four existing tools into the registry and add eight new tools in `src/ai/tools.js`
  - Register `get_current_time`, `get_latest_news`, `search_web`, `get_gif` via `ToolRegistry.register()`
  - Register `analyze_image`, `read_code_snippet`, `get_weather`, `translate_text`, `create_poll`, `get_server_stats`, `recall_user_facts`, `summarize_channel`
  - Keep legacy `TOOL_DEFINITIONS` and `executeTool` exports as thin wrappers for backward compat
  - **Requirement**: 1.1–1.8

- [x] 3. Create `src/ai/skillChain.js` — Skill Chain Executor
  - Export `define(chainName, config)`, `execute(chainName, initialArgs, context)`, `hasChain(name)`
  - Throw on tool name conflict; enforce `MAX_CHAIN_DEPTH` and `CHAIN_TIMEOUT_MS` via `Promise.race`
  - Short-circuit on `{ error }` from any step; log each step at debug level
  - **Requirement**: 2.1–2.9

- [x] 4. Create `src/ai/sentimentAnalyzer.js`
  - Export `analyze(text)` returning `{ tone, urgency, primaryEmotion, confidence }`
  - Export `analyzeHistory(messages)` returning `{ trend, dominantEmotion }`
  - Optional AI mode via `SENTIMENT_AI_MODE=true`; never mutates input
  - **Requirement**: 3.1–3.8

- [x] 5. Create `src/ai/visionService.js`
  - Export `hasImages(message)` and `async describeImage(imageUrl, userPrompt)`
  - Validate URL with `isSafeUrl()`, enforce `MAX_IMAGE_SIZE_MB`, run moderation after vision call
  - Return `{ description, detectedObjects, estimatedMood, safeForWork }` or `{ error }`
  - **Requirement**: 4.1–4.8

- [x] 6. Wire image handling into `src/ai/aiController.js`
  - Add `handleImageMessage()` that describes image and injects `[Image attached: ...]` into content
  - In `handleMessage`, check `VISION_ENABLED=true` and route to image handler when images present
  - **Requirement**: 4.9–4.10

- [x] 7. Create `src/memory/userProfileStore.js`
  - Export `get(userId, guildId)`, `update(userId, guildId, delta)`, `getUserFacts(userId, guildId)`
  - Enforce caps: `topicsOfInterest <= 10`, `notableFacts <= 20`, `sentimentHistory <= 5`
  - In-memory Map with optional PostgreSQL persistence via `database.js`
  - **Requirement**: 5.1–5.10

- [x] 8. Add `user_profiles` and `proactive_configs` tables to `src/memory/database.js`
  - Add `CREATE TABLE IF NOT EXISTS` for both tables in `initialize()`
  - Add `loadUserProfile`, `saveUserProfile`, `loadProactiveConfig`, `saveProactiveConfig` methods
  - **Requirement**: 5.10, 7.7

- [x] 9. Update `src/memory/memoryManager.js` `getHistory()` to return `userProfile`
  - Import `UserProfileStore`, call `UserProfileStore.get()` inside `getHistory()`
  - Return `{ history, summary, userProfile }` instead of `{ history, summary }`
  - **Requirement**: 9.6

- [x] 10. Create `src/ai/moderationService.js`
  - Export `check(content)` returning `{ safe, categories, scores, action, source }`
  - Local blocklist fast-check first; OpenAI moderation API when `MODERATION_ENABLED=true`
  - Export `logEvent(userId, guildId, content, result)` — logs only, no raw content stored
  - **Requirement**: 6.1–6.10

- [x] 11. Wire moderation, sentiment, and profile into `src/ai/aiController.js`
  - Moderation block: skip `chat()` and `saveHistory()`; moderation warn: send warning then proceed
  - Call `SentimentAnalyzer.analyze()` before prompt build; pass `sentimentHint` + `userProfile` to `buildSystemPrompt()`
  - Call `UserProfileStore.update()` after successful reply to increment `interactionCount`
  - Typing indicator always cleared in `finally` block
  - **Requirement**: 6.4–6.8, 9.1, 9.7, 5.3, 5.8, 12.7

- [x] 12. Extend `buildSystemPrompt()` in `src/ai/prompts.js`
  - Add `sentimentHint` and `userProfile` parameters
  - Append `## OPERATOR SIGNAL` when `tone === 'distressed'`
  - Append `## OPERATOR PROFILE` when `interactionCount > 50`
  - Update tools list to all 12 tools
  - **Requirement**: 9.2–9.4

- [x] 13. Create `src/ai/streamingResponder.js`
  - Export `shouldStream(estimatedLength)` and `async send(message, streamGenerator)`
  - Rate-limited edits every `STREAM_EDIT_INTERVAL_MS`; fallback to `channel.send()` on edit failure
  - Does NOT manage typing indicator
  - **Requirement**: 8.1–8.7

- [x] 14. Update `src/ai/aiService.js` — extended agentic loop
  - Use `ToolRegistry.getDefinitions()` live for tool list
  - Check `SkillChainExecutor.hasChain(name)` first; inject `steps` trace as tool result content
  - `fullMessages` grows monotonically; cap at `maxToolIterations`; fallback string on cap
  - Accept `options` and `context` params; streaming path via `StreamingResponder`
  - **Requirement**: 10.1–10.6, 8.8

- [x] 15. Install `node-cron` and create `src/ai/proactiveEngine.js`
  - Export `init(client)`, `registerBehavior(name, handler)`, `trigger(behaviorName, guildId, channelId, context)`
  - Implement `dailyInsight`, `memberWelcome`, `silenceBreaker`, `milestone` behaviors
  - Each guild wrapped in independent try/catch; suspend behavior on channel fetch failure
  - No-op unless `PROACTIVE_ENABLED=true`
  - **Requirement**: 7.1–7.12

- [x] 16. Wire `ProactiveEngine.init(client)` into `src/bot.js`
  - Import and call `proactiveEngine.init(client)` inside the `clientReady` handler
  - **Requirement**: 7.1, 7.11

- [x] 17. Create `src/commands/utility/proactive.js`
  - Subcommands: `status` (read-only) and `configure` (admin-only)
  - `configure`: update `ProactiveBehaviorConfig` via `proactiveEngine.setConfig()`; persist to DB or memory
  - In-character permission denial for non-admins; auto-loaded by `commandHandler.js`
  - **Requirement**: 11.1–11.5

- [x] 18. Final integration verification
  - Confirm `recall_user_facts` tool calls `UserProfileStore.getUserFacts()` correctly (stub → real)
  - Confirm `get_server_stats` and `summarize_channel` receive `context` with `message` and `client`
  - Confirm `handleMessage` flow: sanitize → moderation → sentiment → memory+profile → prompt → chat → stream/chunk → save → update profile
  - Confirm typing indicator cleared in `finally` in all code paths
  - Confirm blocked messages never reach `saveHistory()`
  - **Requirement**: 1.8, 1.6, 12.7, 6.7, 9.5

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3", "4", "5", "7", "8", "10", "12", "13"] },
    { "wave": 4, "tasks": ["6", "9", "11", "14", "15"] },
    { "wave": 5, "tasks": ["16", "17"] },
    { "wave": 6, "tasks": ["18"] }
  ]
}
```

## Notes

- All new features are opt-in via env vars — bot runs fine without any set
- `recall_user_facts` and `analyze_image` use lazy `require()` so they work as stubs before their services exist
- `context` object `{ message, client, guild }` flows from `aiController` → `aiService` → `ToolRegistry.execute()` for server-aware tools
