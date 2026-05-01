# Music System Setup Guide

## Prerequisites

Ensure you have the following installed:

1. **Node.js** (v16+)
2. **FFmpeg** — Required for audio streaming
   - Windows: `choco install ffmpeg` or download from https://ffmpeg.org/download.html
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt-get install ffmpeg`

## Installation

### 1. Install Dependencies

All required packages are already in `package.json`:

```bash
npm install
```

If you need to install manually:

```bash
npm install @discordjs/voice play-dl discord.js
```

### 2. Verify Installation

Check that packages are installed:

```bash
npm list @discordjs/voice play-dl
```

### 3. Environment Setup

Ensure your `.env` file has:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_client_id
OPENAI_API_KEY=your_openai_key
REGISTER_COMMANDS=true
LOG_LEVEL=info
```

### 4. Bot Permissions

Your bot needs these permissions in Discord:

- **Voice Permissions**:
  - Connect
  - Speak
  - Use Voice Activity

- **Text Permissions**:
  - Send Messages
  - Embed Links
  - Read Message History

### 5. Start the Bot

```bash
node index.js
```

You should see:

```
[INFO] Loaded 10 slash command(s).
[INFO] Slash commands registered successfully.
[INFO] [Protocol Network] YourBot#0000 is online.
```

## First Use

### 1. Join a Voice Channel

Go to any voice channel in your Discord server.

### 2. Search and Play

Type `/play` and search for a song:

```
/play query: Bohemian Rhapsody
```

The bot will:
- Search YouTube
- Join your voice channel
- Start playing the song

### 3. Control Playback

Use the other commands:

```
/queue              # See what's queued
/skip               # Skip to next song
/pause              # Pause playback
/resume             # Resume playback
/stop               # Stop and disconnect
```

## Troubleshooting

### "Bot doesn't join voice channel"

**Solution:**
1. Check bot has "Connect" permission in the channel
2. Verify the voice channel isn't full
3. Check logs for specific error

### "No audio output"

**Solution:**
1. Verify FFmpeg is installed: `ffmpeg -version`
2. Check bot has "Speak" permission
3. Try restarting the bot
4. Check internet connection

### "Commands don't appear"

**Solution:**
1. Set `REGISTER_COMMANDS=true` in `.env`
2. Restart the bot
3. Close and reopen Discord
4. Check bot has "applications.commands" scope

### "Search returns no results"

**Solution:**
1. Try a more specific query
2. Use a direct YouTube URL instead
3. Check internet connection

## Common Issues

### FFmpeg Not Found

**Error**: `Error: spawn ffmpeg ENOENT`

**Fix**:
- Windows: Install FFmpeg from https://ffmpeg.org/download.html
- Add FFmpeg to PATH
- Restart bot

### Voice Connection Timeout

**Error**: `Failed to join voice channel`

**Fix**:
- Check bot permissions
- Try a different voice channel
- Restart Discord
- Check server connection

### Stream Error

**Error**: `Failed to play track`

**Fix**:
- Video may be unavailable
- Try a different song
- Check internet connection
- Restart bot

## Performance Tips

1. **Limit Queue Size**: Consider adding a max queue limit
2. **Cleanup**: Bot auto-disconnects when queue is empty
3. **Memory**: Per-guild state is minimal
4. **Logging**: Set `LOG_LEVEL=warn` in production

## Advanced Configuration

### Adjust Search Limit

In `musicManager.js`, change search limit:

```javascript
const results = await play.search(query, { limit: 1 });
```

Change `limit: 1` to get more results.

### Custom Volume Range

In `volume.js`, modify the range:

```javascript
.setMinValue(0)
.setMaxValue(200)  // Allow up to 200%
```

### Auto-Disconnect Delay

Add a delay before disconnecting in `musicManager.js`:

```javascript
setTimeout(() => this.leaveVoice(guildId), 5000); // 5 second delay
```

## Support

For issues or questions:

1. Check the logs: `LOG_LEVEL=debug`
2. Review `MUSIC_SYSTEM.md` for detailed documentation
3. Check Discord.js documentation: https://discord.js.org/
4. Check play-dl documentation: https://github.com/play-dl/play-dl

## Next Steps

1. Test all commands in a test server
2. Set up proper permissions
3. Configure logging level
4. Monitor bot performance
5. Add additional features as needed

Enjoy your music bot! 🎵
