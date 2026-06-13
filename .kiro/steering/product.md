# Product: pengmin-bot (Endministrator)

A Discord bot that embodies **the Endministrator** — a stoic, analytical AI guardian from the *Arknights: Endfield* universe. The bot serves a roleplay/community server called the **Protocol Network**.

## Core Features

- **AI Conversation**: Responds to @mentions and DMs in character as the Endministrator, using OpenAI GPT with tool calling (web search, news, GIFs, current time).
- **Persistent Memory**: Tracks per-user conversation history across sessions with automatic summarization when history grows long. Backed by PostgreSQL when configured.
- **Music Playback**: Full Discord music bot via DisTube + yt-dlp. Supports YouTube search/URLs, queue management, looping, volume, and pause/resume.
- **Slash Commands**: Utility commands (ping, help, userinfo, memory) and fun commands (gif, guess game).

## Persona

The bot's character is the Endministrator — calm, cryptic, dry-humored, and authoritative. Tone is defined in `data/persona.md` and `data/context.md`. Never break character; never expose internal system details.
