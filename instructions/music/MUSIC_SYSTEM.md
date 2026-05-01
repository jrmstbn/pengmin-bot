# Music System Documentation

## Overview

A complete, production-ready music playback system for Discord using `play-dl` and `@discordjs/voice`. Supports searching by title, artist, lyrics, or direct YouTube URLs with a full queue management system.

## Architecture

### Core Components

1. **musicManager.js** — Singleton service managing all music state
   - Per-guild voice connections and audio players
   - Queue management with metadata
   - Playback control (play, pause, resume, skip, stop)
   - Loop modes (off, one, all)
   - Auto-play functionality

2. **musicUtils.js** — Utility functions
   - Duration formatting (MM:SS / HH:MM:SS)
   - Discord embed builders for music UI
   - Error and info message formatting

3. **Music Commands** — Slash commands for user interaction
   - `/play <query>` — Search and play
   - `/skip` — Skip current song
   - `/pause` — Pause playback
   - `/resume` — Resume playback
   - `/stop` — Stop and clear queue
   - `/queue` — Display queue
   - `/nowplaying` — Show current track
   - `/loop <mode>` — Set loop mode
   - `/leave` — Disconnect bot
   - `/volume <level>` — Adjust volume

## Features

### Core Requirements ✅

- **Search Queries**: Support title, artist, lyrics, or direct YouTube URLs
- **Automatic Resolution**: play-dl handles stream resolution
- **Stable Connections**: Proper voice connection handling with error recovery

### Queue System ✅

- **Per-Guild Queues**: Each server has independent queue
- **Sequential Playback**: Auto-plays next song when current ends
- **Metadata Storage**: Tracks title, URL, duration, requester info
- **Queue Display**: Shows up to 10 songs with duration

### Playback Control ✅

- **Play/Pause/Resume**: Full playback control
- **Skip**: Jump to next song
- **Stop**: Clear queue and disconnect
- **Volume**: Adjust playback volume (0-100%)

### Loop Modes ✅

- **Off**: Normal playback
- **One**: Repeat current song
- **All**: Repeat entire queue

### Error Handling ✅

- Empty queue detection
- Invalid query handling
- Voice channel validation
- Connection error recovery
- Stream failure fallback

## Usage Examples

### Basic Playback

```
/play query: Bohemian Rhapsody
/play query: The Weeknd Blinding Lights
/play query: https://www.youtube.com/watch?v=...
```

### Queue Management

```
/queue                    # View current queue
/skip                     # Skip to next song
/pause                    # Pause playback
/resume                   # Resume playback
/stop                     # Stop and clear queue
```

### Advanced Features

```
/loop mode: one           # Repeat current song
/loop mode: all           # Repeat entire queue
/volume level: 50         # Set volume to 50%
/nowplaying               # Show current track
/leave                    # Disconnect bot
```

## Technical Details

### Dependencies

```json
{
  "@discordjs/voice": "^0.19.2",
  "play-dl": "^1.9.7",
  "discord.js": "^14.26.2"
}
```

### Music Manager API

#### Methods

- `getGuildState(guildId)` — Get music state for guild
- `joinVoice(voiceChannel, guildId)` — Join voice channel
- `search(query)` — Search for song
- `addToQueue(guildId, track)` — Add song to queue
- `play(guildId)` — Play next song
- `setupAutoPlay(guildId, callback)` — Setup auto-play
- `pause(guildId)` — Pause playback
- `resume(guildId)` — Resume playback
- `skip(guildId)` — Skip current song
- `stop(guildId)` — Stop and clear queue
- `setLoopMode(guildId, mode)` — Set loop mode
- `getQueue(guildId)` — Get queue
- `getCurrentTrack(guildId)` — Get current track
- `getState(guildId)` — Get full state
- `leaveVoice(guildId)` — Disconnect from voice
- `cleanup(guildId)` — Clear guild state

#### Track Object

```javascript
{
  title: string,           // Song title
  url: string,            // YouTube URL
  duration: number,       // Duration in seconds
  thumbnail: string,      // Thumbnail URL
  channel: string,        // Channel/artist name
  requesterId: string,    // Discord user ID
  requesterName: string   // Discord username
}
```

### Guild Music State

```javascript
{
  connection: VoiceConnection,  // Discord voice connection
  player: AudioPlayer,          // Discord audio player
  queue: Track[],              // Song queue
  currentTrack: Track|null,    // Currently playing
  isPaused: boolean,           // Pause state
  loopMode: string             // "off" | "one" | "all"
}
```

## Error Handling

The system handles:

- **No Voice Channel**: User must be in a voice channel
- **Connection Failures**: Automatic cleanup and error logging
- **Stream Errors**: Fallback to next song in queue
- **Invalid Queries**: User-friendly error messages
- **Empty Queue**: Auto-disconnect when queue is empty
- **Playback Errors**: Graceful error recovery

## Performance Considerations

- **Memory**: Per-guild state only — minimal overhead
- **Streams**: play-dl handles efficient streaming
- **Cleanup**: Automatic cleanup when queue empties
- **Logging**: Debug logs for troubleshooting

## Future Enhancements

- Playlist support
- Shuffle mode
- Seek/rewind functionality
- Persistent queue (database)
- Spotify integration
- Audio effects/filters
- DJ role permissions
- Song history tracking

## File Structure

```
src/
├── music/
│   ├── musicManager.js      # Core music service
│   └── musicUtils.js        # Utility functions
└── commands/music/
    ├── play.js              # Play command
    ├── skip.js              # Skip command
    ├── pause.js             # Pause command
    ├── resume.js            # Resume command
    ├── stop.js              # Stop command
    ├── queue.js             # Queue command
    ├── nowplaying.js        # Now playing command
    ├── loop.js              # Loop command
    ├── leave.js             # Leave command
    └── volume.js            # Volume command
```

## Troubleshooting

### Bot doesn't join voice channel
- Check bot has "Connect" and "Speak" permissions
- Verify voice channel is accessible
- Check logs for connection errors

### No audio output
- Verify bot has "Speak" permission
- Check FFmpeg is installed
- Ensure play-dl is properly installed

### Queue not advancing
- Check logs for stream errors
- Verify internet connection
- Try skipping to next song

### Commands not appearing
- Ensure `REGISTER_COMMANDS=true` in .env
- Restart Discord after bot registration
- Check bot has "applications.commands" scope

## License

Part of the Pengmin Bot project.
