# Requirements Document

## Introduction

This document specifies the requirements for the **AI Feature Maximization** expansion of the Endministrator Discord bot (pengmin-bot). The expansion upgrades every layer of the existing AI pipeline: a dynamic tool registry with eight new tools, multi-step skill chain execution, heuristic-plus-AI sentiment analysis, per-user personality profiles, pre-flight content moderation, multi-modal image understanding via GPT-4o Vision, proactive event-driven and scheduled behaviors, and streaming Discord responses. All new capabilities slot into the existing `bot.js` → `aiController.js` → `aiService.js` layered architecture without restructuring the command auto-loader or core Discord event handling.

The guiding principle is "the Protocol Network grows deeper" — every capability makes the Endministrator feel more omniscient and contextually aware while preserving the stoic, analytical character.

---

## Glossary

- **Bot / Endministrator**: The Discord bot persona defined in `data/persona.md`.
- **AI_Controller**: The `aiController.js` orchestration module; routes Discord events to AI services and memory.
- **AI_Service**: The `aiService.js` module; owns all OpenAI API calls and the agentic tool loop.
- **ToolRegistry**: The `src/ai/toolRegistry.js` module; centrally registers and dispatches all AI tools.
- **SkillChainExecutor**: The `src/ai/skillChain.js` module; sequences multiple tool calls within a single user turn.
- **SentimentAnalyzer**: The `src/ai/sentimentAnalyzer.js` module; performs heuristic + optional AI sentiment scoring.
- **VisionService**: The `src/ai/visionService.js` module; wraps GPT-4o Vision for image analysis.
- **UserProfileStore**: The `src/memory/userProfileStore.js` module; persists per-user personality profiles.
- **ModerationService**: The `src/ai/moderationService.js` module; performs pre-flight content moderation.
- **ProactiveEngine**: The `src/ai/proactiveEngine.js` module; emits scheduled and event-triggered AI messages.
- **StreamingResponder**: The `src/ai/streamingResponder.js` module; delivers GPT responses via progressive Discord message edits.
- **UserProfile**: A structured record of a user's interaction count, topics of interest, preferred tone, notable facts, and sentiment history, keyed by `userId` + `guildId`.
- **SentimentResult**: The output of `SentimentAnalyzer.analyze()`: `{ tone, urgency, primaryEmotion, confidence }`.
- **ModerationResult**: The output of `ModerationService.check()`: `{ safe, categories, scores, action, source }`.
- **SkillChainDefinition**: A named sequence of tool steps with `argsMapper` functions and a `maxDepth` cap.
- **ProactiveBehaviorConfig**: Per-guild configuration for proactive behaviors stored in DB or env.
- **MAX_MESSAGES**: The maximum number of messages retained in a user's hot conversation history (env: `MAX_HISTORY_MESSAGES`, default 20).
- **MAX_CHAIN_DEPTH**: The maximum number of tool steps in a single skill chain (default 5).
- **CHAIN_TIMEOUT_MS**: The wall-clock timeout for a full skill chain execution (default 15 000 ms).
- **STREAM_EDIT_INTERVAL_MS**: Minimum milliseconds between Discord message edits during streaming (default 800 ms).
- **STREAM_MIN_LENGTH**: Minimum character count for a response to be delivered via streaming (env: `STREAM_MIN_LENGTH`, default 200).
- **MAX_IMAGE_SIZE_MB**: Maximum accepted image attachment size for vision analysis (default 10 MB).
- **SILENCE_THRESHOLD_HOURS**: Hours of channel inactivity before the `silenceBreaker` behavior triggers (env: `SILENCE_THRESHOLD_HOURS`, default 6).
- **GUILD_MILESTONE_THRESHOLDS**: Comma-separated list of guild member counts that trigger the `milestone` behavior (env: `GUILD_MILESTONE_THRESHOLDS`, default `"100,250,500,1000"`).
- **Protocol_Network**: The in-universe name for the Discord server the bot serves; used in in-character copy.

---

## Requirements

### Requirement 1: Dynamic Tool Registry

**User Story:** As a developer, I want a central tool registry that I can extend with new tools without modifying existing dispatch logic, so that the AI tool surface can grow incrementally.

#### Acceptance Criteria

1. THE ToolRegistry SHALL expose a `register(definition, executor)` function that accepts an OpenAI function-calling definition object and an async executor function, storing both by the tool's `name` field.
2. WHEN `ToolRegistry.execute(name, args)` is called, THE ToolRegistry SHALL invoke the executor registered under `name` and return its result.
3. IF `ToolRegistry.execute(name, args)` is called with an unregistered tool name, THEN THE ToolRegistry SHALL return `{ error: "Unknown tool: <name>" }` without throwing an exception.
4. IF any registered executor throws an exception during execution, THEN THE ToolRegistry SHALL catch the error and return `{ error: <error_message> }` without propagating the exception.
5. THE ToolRegistry SHALL expose a `getDefinitions()` function that returns an array of all currently registered OpenAI function-calling definition objects.
6. THE ToolRegistry SHALL register the following eight new tools in addition to the four existing ones: `analyze_image`, `read_code_snippet`, `get_weather`, `translate_text`, `create_poll`, `get_server_stats`, `recall_user_facts`, and `summarize_channel`.
7. THE `read_code_snippet` tool executor SHALL accept a `{ language: string, code: string }` argument object, apply syntax-aware summarization heuristics, and return `{ summary: string, detectedLanguage: string, lineCount: number }`.
8. THE `recall_user_facts` tool executor SHALL accept a `{ userId: string, guildId: string }` argument object, call `UserProfileStore.getUserFacts()`, and return the resulting `string[]` as `{ facts: string[] }`.

---

### Requirement 2: Skill Chain Executor

**User Story:** As a developer, I want the AI to compose multiple tools into sequential pipelines within a single user turn, so that complex "research → summarize → respond" flows can be expressed cleanly.

#### Acceptance Criteria

1. THE SkillChainExecutor SHALL expose a `define(chainName, config)` function that registers a named `SkillChainDefinition` containing an array of `{ tool, argsMapper }` steps and an optional `maxDepth` override.
2. IF `SkillChainExecutor.define()` is called with a `chainName` that is already registered as a tool name in `ToolRegistry`, THEN THE SkillChainExecutor SHALL throw an error at registration time: `"Chain name '<chainName>' conflicts with a registered tool name"`.
3. WHEN `SkillChainExecutor.execute(chainName, initialArgs, context)` is called, THE SkillChainExecutor SHALL check its own chain registry first and, only if no chain is found, fall back to `ToolRegistry.execute()`; chain names and tool names occupy separate namespaces and chains take priority.
4. WHEN `SkillChainExecutor.execute(chainName, initialArgs, context)` is called, THE SkillChainExecutor SHALL call each step's tool in sequence, passing each step's output as `prevOutput` to the next step's `argsMapper`.
5. THE SkillChainExecutor SHALL enforce that `result.steps.length <= chain.maxDepth` for every execution, stopping the chain and returning partial results once the depth cap is reached.
6. IF any step's tool returns an `{ error }` object, THEN THE SkillChainExecutor SHALL halt the chain immediately and return `{ result: <error_object>, steps: <steps_so_far> }` without executing further steps.
7. IF `SkillChainExecutor.execute()` does not complete within `CHAIN_TIMEOUT_MS`, THEN THE SkillChainExecutor SHALL return `{ error: "chain timeout", steps: <steps_so_far> }`.
8. THE SkillChainExecutor SHALL log each step's tool name, mapped args, and output at debug level for traceability.
9. WHEN `SkillChainExecutor.execute()` is called with an unregistered `chainName`, THE SkillChainExecutor SHALL return `{ error: "Unknown chain: <chainName>" }`.

---

### Requirement 3: Sentiment Analysis

**User Story:** As a developer, I want in-process sentiment analysis of every incoming message, so that the AI can modulate its response tone based on the user's emotional state without adding latency.

#### Acceptance Criteria

1. WHEN `SentimentAnalyzer.analyze(text)` is called, THE SentimentAnalyzer SHALL return a `SentimentResult` object with all four fields populated: `tone`, `urgency`, `primaryEmotion`, and `confidence`.
2. THE SentimentAnalyzer SHALL ensure `SentimentResult.urgency` is a number in the closed interval `[0.0, 1.0]` for all string inputs including empty strings.
3. THE SentimentAnalyzer SHALL ensure `SentimentResult.tone` is exactly one of `'positive'`, `'neutral'`, `'negative'`, or `'distressed'` for all string inputs.
4. WHEN `SentimentAnalyzer.analyze('')` is called with an empty string, THE SentimentAnalyzer SHALL return `{ tone: 'neutral', urgency: 0, primaryEmotion: 'neutral', confidence: 0 }`.
5. THE SentimentAnalyzer SHALL classify `tone` as `'distressed'` when `urgency >= 0.7` and the sentiment score is negative, overriding the standard tone classification.
6. THE SentimentAnalyzer SHALL expose an `analyzeHistory(messages)` function that accepts an array of message objects and returns `{ trend: string, dominantEmotion: string }`.
7. THE SentimentAnalyzer SHALL operate without any external API calls in default mode; external AI-assisted analysis SHALL only activate when `SENTIMENT_AI_MODE=true` is set. WHEN AI mode is active, THE SentimentAnalyzer SHALL call `openai.chat.completions.create()` with a lightweight classification prompt and use the result to override the heuristic `tone`, `primaryEmotion`, and `confidence` fields while preserving the heuristic `urgency` score.
8. THE SentimentAnalyzer SHALL NOT mutate the `text` parameter passed to `analyze()`.

---

### Requirement 4: Vision Service (Multi-Modal Input)

**User Story:** As a server member, I want to send images to the Endministrator and receive an in-character response that references the image content, so that conversations can include visual context.

#### Acceptance Criteria

1. THE VisionService SHALL expose a `hasImages(message)` function that returns `true` if the Discord message contains at least one image attachment and `false` otherwise.
2. WHEN `VisionService.describeImage(imageUrl, userPrompt)` is called, THE VisionService SHALL validate `imageUrl` using `isSafeUrl()` before making any network request.
3. IF `isSafeUrl(imageUrl)` returns `false`, THEN THE VisionService SHALL return `{ error: "Image URL failed safety check" }` without calling the OpenAI API.
4. IF the attachment size exceeds `MAX_IMAGE_SIZE_MB`, THEN THE VisionService SHALL return `{ error: "Image exceeds size limit" }` without calling the OpenAI API.
5. WHEN a valid image URL is provided, THE VisionService SHALL call the OpenAI chat completions endpoint with a vision-format content array: `[{ type: 'image_url', image_url: { url } }, { type: 'text', text: userPrompt }]`.
6. WHEN the vision API call succeeds, THE VisionService SHALL return `{ description: string, detectedObjects: string[], estimatedMood: string, safeForWork: boolean }`.
7. IF the OpenAI API call fails for any reason, THEN THE VisionService SHALL return `{ error: <error_message> }` without throwing an exception.
8. THE VisionService SHALL set `safeForWork: false` in the result when OpenAI's moderation API flags the image content. THE VisionService SHALL call `openai.moderations.create()` on the image URL as a second, separate API request after the vision description call; both calls SHALL be awaited before the final result is returned.
9. WHEN a message contains an image attachment, THE AI_Controller SHALL route handling to `handleImageMessage()`, append the image description as `[Image attached: <description>]` to the user content, and continue with the standard conversation pipeline.
10. WHERE `VISION_ENABLED` is not set to `true`, THE AI_Controller SHALL skip image analysis and process only the text content of messages with attachments.

---

### Requirement 5: User Profile and Personality Adaptation

**User Story:** As a returning server member, I want the Endministrator to adapt its responses based on our interaction history and my known preferences, so that conversations feel progressively more personalized.

#### Acceptance Criteria

1. THE UserProfileStore SHALL expose a `get(userId, guildId)` function that returns a `UserProfile` object, creating a default profile if none exists for that `userId` + `guildId` pair.
2. THE UserProfileStore SHALL expose an `update(userId, guildId, delta)` function that merges the `delta` partial object onto the existing profile without overwriting fields not present in `delta`.
3. WHEN `AI_Controller.handleMessage()` completes a successful interaction, THE AI_Controller SHALL derive a `delta` from the interaction and call `UserProfileStore.update()`; the `delta` SHALL include the current `SentimentResult.tone` as a candidate for `preferredTone` and any topic labels extracted by the AI tool result or prompt response as candidates for `topicsOfInterest`.
4. THE UserProfileStore SHALL ensure `UserProfile.topicsOfInterest.length <= 10` after every `update()` call, dropping the oldest entry when the cap is exceeded.
5. THE UserProfileStore SHALL ensure `UserProfile.notableFacts.length <= 20` after every `update()` call, dropping the oldest entry when the cap is exceeded.
6. THE UserProfileStore SHALL ensure `UserProfile.sentimentHistory.length <= 5` after every `update()` call, prepending the newest entry and dropping the oldest.
7. THE UserProfileStore SHALL expose a `getUserFacts(userId, guildId)` function that returns a `string[]` of notable facts from the user's profile.
8. WHEN `AI_Controller.handleMessage()` completes a successful interaction, THE AI_Controller SHALL call `UserProfileStore.update()` to increment `UserProfile.interactionCount` by 1.
9. WHEN `buildSystemPrompt()` is called with a `userProfile` where `interactionCount > 50`, THE Prompt_Builder SHALL include an `## OPERATOR PROFILE` section listing the user's interaction count, top three topics of interest, and preferred tone.
10. THE UserProfileStore SHALL persist `UserProfile` records to PostgreSQL when `DATABASE_URL` is configured, and operate in-memory only otherwise.

---

### Requirement 6: Moderation Service

**User Story:** As a server administrator, I want all incoming messages to be moderation-checked before reaching the AI, so that harmful content is blocked without requiring manual oversight.

#### Acceptance Criteria

1. WHEN `ModerationService.check(content)` is called, THE ModerationService SHALL return a `ModerationResult` object with `safe`, `categories`, `scores`, `action`, and `source` fields populated.
2. THE ModerationService SHALL apply a local blocklist pattern check as a fast pre-check before calling the OpenAI Moderation API.
3. THE ModerationService SHALL determine `action` as exactly one of `'allow'`, `'warn'`, or `'block'` based on the moderation result.
4. WHEN `ModerationService.check()` returns `action: 'warn'`, THE AI_Controller SHALL prepend an in-character soft-warning message to the channel before invoking `AI_Service.chat()`, and SHALL still call `AI_Service.chat()` and `memoryManager.saveHistory()` as normal. THE ModerationService SHALL also call `logEvent()` for `warn` actions.
5. THE AI_Controller SHALL call `ModerationService.check()` on every incoming message before any call to the AI_Service.
6. WHEN `ModerationService.check()` returns `action: 'block'`, THE AI_Controller SHALL send an in-character refusal reply and SHALL NOT call `openai.chat.completions.create()`.
7. WHEN `ModerationService.check()` returns `action: 'block'`, THE AI_Controller SHALL NOT call `memoryManager.saveHistory()` for that message, preventing blocked content from entering conversation history.
8. THE ModerationService SHALL NOT include moderation category names or reasoning in any user-facing reply; the Endministrator SHALL respond with a generic in-character refusal only.
9. THE ModerationService SHALL expose a `logEvent(userId, guildId, content, result)` function that records moderation events to the application log.
10. WHERE `MODERATION_ENABLED` is not set to `true`, THE AI_Controller SHALL skip the moderation check and proceed directly to the AI_Service.

---

### Requirement 7: Proactive Engine

**User Story:** As a server administrator, I want the Endministrator to post AI-generated messages proactively on schedule and in response to guild events, so that the bot maintains an active presence without requiring explicit commands.

#### Acceptance Criteria

1. THE ProactiveEngine SHALL expose an `init(client)` function that accepts a discord.js `Client` object and registers all built-in behaviors: `dailyInsight`, `memberWelcome`, `silenceBreaker`, and `milestone`.
2. THE ProactiveEngine SHALL expose a `registerBehavior(name, handler)` function for adding custom behaviors beyond the four built-ins.
3. THE ProactiveEngine SHALL expose a `trigger(behaviorName, guildId, channelId, context)` function for manually triggering a specific behavior.
4. WHEN the `dailyInsight` behavior is triggered, THE ProactiveEngine SHALL retrieve the last 24 hours of guild activity, generate an in-character insight via AI_Service, and send it to the guild's configured `channelId`.
5. WHEN a `guildMemberAdd` Discord event fires, THE ProactiveEngine SHALL trigger the `memberWelcome` behavior, generating a personalized in-character welcome message sent to the guild's configured welcome `channelId`.
6. WHEN a configured channel has received no messages for `SILENCE_THRESHOLD_HOURS` consecutive hours, THE ProactiveEngine SHALL trigger the `silenceBreaker` behavior and post a cryptic in-character observation. THE ProactiveEngine SHALL check for silence on the same cron cadence as `dailyInsight`.
7. WHEN the guild's member count crosses a threshold value defined in `GUILD_MILESTONE_THRESHOLDS`, THE ProactiveEngine SHALL trigger the `milestone` behavior and post an in-character acknowledgment of the Protocol Network's growth to the guild's configured milestone `channelId`. Each threshold SHALL only trigger once; THE ProactiveEngine SHALL persist which thresholds have already fired to avoid duplicate posts across restarts.
8. THE ProactiveEngine SHALL wrap each guild's job execution in an independent try/catch block so that a runtime exception for one guild does not prevent job execution for any other guild.
9. IF a configured `channelId` for a behavior cannot be fetched (deleted or permission lost), THEN THE ProactiveEngine SHALL log the error, mark the behavior as `suspended` in the guild config, and continue running other behaviors.
10. THE ProactiveEngine SHALL only post to channels explicitly configured by an admin; it SHALL NOT auto-discover or post to undisclosed channels.
11. WHERE `PROACTIVE_ENABLED` is not set to `true`, THE ProactiveEngine SHALL NOT initialize any scheduler or register any Discord event listeners.
12. THE ProactiveEngine SHALL support cron expression scheduling for `dailyInsight` via the `cronExpression` field in `ProactiveBehaviorConfig` (default: `'0 9 * * *'`).

---

### Requirement 8: Streaming Responses

**User Story:** As a server member, I want to see the Endministrator's response appear progressively, so that long replies feel like a live transmission rather than a sudden wall of text.

#### Acceptance Criteria

1. THE StreamingResponder SHALL expose a `send(message, streamGenerator)` function that accepts a discord.js `Message` and an `AsyncGenerator` yielding string deltas.
2. WHEN `StreamingResponder.send()` is called, THE StreamingResponder SHALL send an initial placeholder reply and then edit it progressively as deltas arrive.
3. THE StreamingResponder SHALL accumulate deltas and edit the Discord message no more frequently than once every `STREAM_EDIT_INTERVAL_MS` milliseconds to comply with Discord rate limits.
4. WHEN the stream ends, THE StreamingResponder SHALL perform a final edit to ensure the complete accumulated text is visible in the message.
5. IF a Discord message edit fails (rate limit exceeded, message deleted, permissions lost), THEN THE StreamingResponder SHALL catch the error and send the complete accumulated text as a new reply via `message.channel.send()`.
6. THE StreamingResponder SHALL expose a `shouldStream(estimatedLength)` function that returns `false` when `estimatedLength < STREAM_MIN_LENGTH`, allowing short responses to bypass streaming and use standard `message.reply()`.
7. THE StreamingResponder SHALL NOT manage the typing indicator; THE AI_Controller SHALL remain responsible for the typing indicator lifecycle.
8. WHERE `STREAMING_ENABLED` is not set to `true`, THE AI_Controller SHALL send responses using the existing `chunkMessage()` + `message.reply()` path without engaging the StreamingResponder.

---

### Requirement 9: Enhanced Memory and Prompt Assembly

**User Story:** As a server member, I want the Endministrator to incorporate my sentiment, profile, and conversation history into every reply, so that responses feel contextually aware and personally calibrated.

#### Acceptance Criteria

1. THE AI_Controller SHALL call `SentimentAnalyzer.analyze()` on every incoming message content before building the system prompt.
2. THE Prompt_Builder SHALL accept `sentimentHint` and `userProfile` parameters in `buildSystemPrompt()` and inject them as named sections.
3. WHEN `buildSystemPrompt()` receives a `sentimentHint` with `tone === 'distressed'`, THE Prompt_Builder SHALL include an `## OPERATOR SIGNAL` section instructing the model to respond with measured clarity and not dismiss the signal.
4. THE Prompt_Builder SHALL return a non-empty string for all valid input combinations of persona, context, roles, summary, channelName, guildName, sentimentHint, and userProfile.
5. THE MemoryManager SHALL ensure `history.length <= MAX_MESSAGES` after every `saveHistory()` call, enforcing the trim and summarize logic unconditionally before writing to hot cache or database.
6. WHEN `getHistory()` is called, THE MemoryManager SHALL also call `UserProfileStore.get(userId, guildId)` and return the resulting `UserProfile` alongside the message history in an enriched context object of the shape `{ history: Message[], userProfile: UserProfile }`. THE MemoryManager SHALL import `UserProfileStore` directly; no additional parameters are required from the caller.
7. THE AI_Controller SHALL pass the `userProfile` and `sentimentHint` from the enriched context to `buildSystemPrompt()` on every interaction.

---

### Requirement 10: Extended Agentic Loop Integration

**User Story:** As a developer, I want the AI service's agentic loop to support skill chains alongside individual tool calls, so that multi-step research and transformation pipelines can run within a single user turn.

#### Acceptance Criteria

1. WHEN the agentic loop receives a tool call, THE AI_Service SHALL first check `SkillChainExecutor`'s chain registry; if a chain is registered under that name, THE AI_Service SHALL invoke `SkillChainExecutor.execute()`. IF no chain matches, THE AI_Service SHALL fall back to `ToolRegistry.execute()`. Chains take priority; the two namespaces are searched in that order.
2. THE AI_Service SHALL inject the full `steps` trace from a completed skill chain as the tool result content, allowing the model to reference what each step retrieved.
3. THE AI_Service SHALL ensure the `fullMessages` array grows monotonically within a single turn; no messages SHALL be removed or reordered during the agentic loop.
4. THE AI_Service SHALL cap tool-call iterations at `AI_CONFIG.maxToolIterations` regardless of whether individual tools or skill chains are invoked.
5. WHEN `AI_Service.chat()` is called with `options.streaming === true`, THE AI_Service SHALL use `StreamingResponder.send()` to deliver the final text response.
6. IF `AI_Service.chat()` reaches the iteration cap without producing a text response, THE AI_Service SHALL return the in-character fallback string `` `*Processing limit reached. Stand by.*` `` without throwing.

---

### Requirement 11: New Slash Command — `/proactive`

**User Story:** As a server administrator, I want a slash command to configure and inspect the Proactive Engine's behaviors, so that I can enable, disable, and monitor proactive AI activity per guild.

#### Acceptance Criteria

1. THE Bot SHALL register a `/proactive` slash command with at least two subcommands: `status` and `configure`.
2. WHEN a user with administrator permissions runs `/proactive status`, THE Bot SHALL reply with the current enabled/disabled/suspended state of all four built-in behaviors for the guild.
3. WHEN a user with administrator permissions runs `/proactive configure`, THE Bot SHALL accept `behavior`, `enabled`, and `channelId` options and update the guild's `ProactiveBehaviorConfig` accordingly. THE Bot SHALL persist the updated config to PostgreSQL when `DATABASE_URL` is configured, and to an in-memory store otherwise; the in-memory store SHALL be re-initialized from env defaults on restart.
4. IF a non-administrator user attempts to use `/proactive configure`, THEN THE Bot SHALL reply with an in-character permission-denial message and SHALL NOT modify any configuration.
5. THE `/proactive` command SHALL be auto-loaded by the existing `commandHandler.js` without any modification to the command handler.

---

### Requirement 12: Security and Operational Constraints

**User Story:** As a system operator, I want all new AI capabilities to enforce existing security guards and operate within defined resource bounds, so that the expanded pipeline does not introduce new attack surfaces or runaway API usage.

#### Acceptance Criteria

1. THE VisionService SHALL call `isSafeUrl()` on every image URL before any network request, reusing the existing guard from `src/middleware/security.js`.
2. THE ModerationService SHALL run before any call to `openai.chat.completions.create()`, ensuring no unmoderated content reaches the OpenAI chat endpoint.
3. THE UserProfileStore SHALL store no raw message content; it SHALL store only extracted topic labels, tone labels, and notable fact strings.
4. THE SkillChainExecutor SHALL use only registered code `argsMapper` functions; it SHALL NOT evaluate any dynamic code derived from model output.
5. THE ProactiveEngine SHALL restrict posting to channels explicitly configured by an administrator; it SHALL NOT infer or auto-select channels.
6. IF any new tool's required API key environment variable is absent, THEN THE ToolRegistry executor SHALL return `{ error: "<KEY_NAME> not configured" }` without throwing.
7. THE AI_Controller SHALL clear the typing indicator in the `finally` block of `handleMessage()` regardless of whether the interaction succeeded or failed.
8. WHEN `MODERATION_ENABLED` is set to `true`, THE ModerationService SHALL call `openai.moderations.create()` for content flagging using the existing `OPENAI_API_KEY`.
