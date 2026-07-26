# Implementation Plan: Phase 1 Games

## Overview

Implements four ephemeral mini-games (/trivia, /rps, /wordscramble, /coinflip) with PvAI, PvP, and AI-as-overwatcher modes. All state lives in closures — no DB writes. A shared gameUtils.js provides session locking, AI commentary, PvP invitation flow, and embed/button builders used by all four commands.

## Tasks

- [x] 1. Create `src/commands/fun/gameUtils.js` — shared game infrastructure
  - Export `checkAndLock(channelId)` and `unlock(channelId)` using a module-level `activeGames` Set
  - Export `async generateCommentary(persona, prompt)` — calls `aiService.chat()` with persona system prompt, 200-char prompt cap, static fallback on error
  - Export `async awaitOpponentAccept(interaction, challengerId, opponentId)` — sends invite embed with Accept/Decline buttons, 60s timeout, returns `'accepted'|'declined'|'timeout'`
  - Export `buildGameEmbed(opts)`, `buildResultEmbed(opts)`, `buildInviteEmbed(challenger, opponent, gameName)` embed builders
  - Export `buildChoiceRow(choices)` and `buildDisabledRow(row)` button builders
  - Export `makeButtonId(gameTag, sessionId, action)` — returns `game:sessionId:action` string
  - **Requirement**: 1.1–1.8, 2.1–2.7, 7.1–7.6

- [ ] 2. Create `src/commands/fun/trivia.js`
  - SlashCommandBuilder: `trivia`, options: `topic` (string, required), `mode` (string, choices pvai/pvp, default pvai), `opponent` (user, optional)
  - AI generates question + 4 options + correct answer as JSON via `aiService.chat()`; validate parse; ephemeral error + return on failure
  - PvAI: single collector (30s), reveal result embed + AI commentary on pick or timeout
  - PvP: two independent collectors (30s), reveal both answers simultaneously, declare winner/draw + AI commentary
  - Self-invite guard; channel lock via `checkAndLock`; `unlock` in finally
  - **Requirement**: 3.1–3.10

- [x] 3. Create `src/commands/fun/rps.js`
  - SlashCommandBuilder: `rps`, options: `mode` (string, choices pvai/pvp, default pvai), `opponent` (user, optional)
  - PvAI: 3-button embed (🪨📄✂️), collect one press (30s), bot picks randomly, resolve outcome, result embed + AI commentary
  - PvP: two separate collectors (30s), waiting embed hides picks until both submit, then resolve + AI commentary; forfeit on timeout
  - `resolveRps(p1, p2)` pure function returns `'win'|'loss'|'draw'`; `pickBotMove()` uses `Math.random()`
  - **Requirement**: 4.1–4.9

- [x] 4. Create `src/commands/fun/wordscramble.js`
  - SlashCommandBuilder: `wordscramble`, options: `mode` (string, choices pvai/pvp, default pvai), `opponent` (user, optional)
  - AI generates `{ word, scrambled, hint }` as JSON; validate parse; ephemeral error + return on failure
  - Embed shows scrambled word + **Get Hint** button; hint button disabled after use
  - PvAI: message collector (60s), case-insensitive match, win/loss result embed + AI commentary
  - PvP: two independent message collectors (60s), first correct answer wins, stop both collectors + AI commentary
  - **Requirement**: 5.1–5.10

- [x] 5. Create `src/commands/fun/coinflip.js`
  - SlashCommandBuilder: `coinflip`, options: `mode` (string, choices pvai/pvp, default pvai), `opponent` (user, optional)
  - Embed with Heads/Tails buttons; `Math.random()` 50/50 flip
  - PvAI: collect one press (30s), flip, result embed + one-line AI commentary; flip anyway on timeout
  - PvP: two independent collectors (30s), flip after both pick (or timeout), `resolveCoinflip(p1pick, p2pick, flipResult)` pure function, result embed + AI commentary
  - **Requirement**: 6.1–6.8

- [x] 6. Verify all four commands load and register correctly
  - Confirm commandHandler.js auto-loads all four new files (no changes needed to handler)
  - Run `node -e "require('./src/commands/fun/gameUtils.js'); console.log('ok')"` and equivalent for each game file
  - Confirm no diagnostic errors across all five new files
  - **Requirement**: 1.1–1.8

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3", "4", "5"] },
    { "wave": 3, "tasks": ["6"] }
  ]
}
```

## Notes

- Button customId format: `<game>:<sessionId>:<action>` — use `crypto.randomUUID().slice(0,8)` for sessionId
- AI commentary prompt must be ≤ 200 chars — enforced inside `generateCommentary`
- `getActivePersona(guildId)` + `buildSystemPrompt()` used for all commentary, making every game persona-aware
- Existing `/guess` command is untouched — it's already done
- All commands go in `src/commands/fun/` — auto-loaded, no other files need changing
