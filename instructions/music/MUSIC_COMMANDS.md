# Music Commands Reference

## Quick Command List

| Command | Description | Usage |
|---------|-------------|-------|
| `/play` | Search and play a song | `/play query: Song Title` |
| `/skip` | Skip to next song | `/skip` |
| `/pause` | Pause current playback | `/pause` |
| `/resume` | Resume paused playback | `/resume` |
| `/stop` | Stop and clear queue | `/stop` |
| `/queue` | Display current queue | `/queue` |
| `/nowplaying` | Show current track | `/nowplaying` |
| `/loop` | Set loop mode | `/loop mode: one` |
| `/volume` | Adjust volume | `/volume level: 50` |
| `/leave` | Disconnect bot | `/leave` |

---

## Detailed Command Reference

### `/play <query>`

**Description**: Search for a song and play it, or add it to the queue.

**Parameters**:
- `query` (required): Song title, artist name, lyrics, or YouTube URL

**Examples**:
```
/play query: Bohemian Rhapsody
/play query: The Weeknd Blinding Lights
/play query: https://www.youtube.com/watch?v=dQw4w9WgXcQ
/play query: lofi hip hop beats
```

**Response**:
- If nothing is playing: Shows "Now Playing" embed
- If something is playing: Shows "Added to Queue" embed with position

**Errors**:
- "You must be in a voice channel" — Join a voice channel first
- "No results found" — Try a different search query
- "Failed to join your voice channel" — Check bot permissions

---

### `/skip`

**Description**: Skip the current song and play the next one in the queue.

**Parameters**: None

**Examples**:
```
/skip
```

**Response**:
- Shows "Now Playing" embed for the next song
- Shows "No more songs in the queue" if queue is empty

**Errors**:
- "No song is currently playing" — Start playing a song first

---

### `/pause`

**Description**: Pause the current song playback.

**Parameters**: None

**Examples**:
```
/pause
```

**Response**:
- Shows "⏸️ Paused" message with song title

**Errors**:
- "No song is currently playing" — Start playing a song first
- "The song is already paused" — Song is already paused

---

### `/resume`

**Description**: Resume paused song playback.

**Parameters**: None

**Examples**:
```
/resume
```

**Response**:
- Shows "▶️ Resumed" message with song title

**Errors**:
- "No song is currently playing" — Start playing a song first
- "The song is already playing" — Song is already playing

---

### `/stop`

**Description**: Stop playback and clear the entire queue. Bot disconnects from voice channel.

**Parameters**: None

**Examples**:
```
/stop
```

**Response**:
- Shows "⏹️ Stopped" message
- Bot disconnects from voice channel

**Notes**:
- Clears all queued songs
- Cannot be undone — queue is lost

---

### `/queue`

**Description**: Display the current music queue.

**Parameters**: None

**Examples**:
```
/queue
```

**Response**:
- Shows currently playing song
- Shows up to 10 queued songs with duration
- Shows total queue count

**Display Format**:
```
🎵 Music Queue

Currently Playing
**Song Title** (3:45)

Queue (5 songs)
1. **Song 1** (4:20)
2. **Song 2** (3:15)
3. **Song 3** (5:00)
...
```

---

### `/nowplaying`

**Description**: Display the currently playing song with details.

**Parameters**: None

**Examples**:
```
/nowplaying
```

**Response**:
- Shows song title
- Shows artist/channel name
- Shows duration
- Shows who requested it
- Shows thumbnail

**Errors**:
- "No song is currently playing" — Start playing a song first

---

### `/loop <mode>`

**Description**: Set the loop/repeat mode for playback.

**Parameters**:
- `mode` (required): Loop mode
  - `off` — No looping (default)
  - `one` — Repeat current song
  - `all` — Repeat entire queue

**Examples**:
```
/loop mode: off
/loop mode: one
/loop mode: all
```

**Response**:
- Shows current loop mode
- Updates playback behavior

**Loop Modes Explained**:
- **Off**: Play queue once, then stop
- **One**: Repeat the same song indefinitely
- **All**: When queue ends, restart from beginning

---

### `/volume <level>`

**Description**: Adjust the playback volume.

**Parameters**:
- `level` (required): Volume level from 0 to 100
  - 0 = Muted
  - 50 = Normal
  - 100 = Maximum

**Examples**:
```
/volume level: 0
/volume level: 50
/volume level: 100
```

**Response**:
- Shows "🔊 Volume" message with new level

**Errors**:
- "No song is currently playing" — Start playing a song first
- "Cannot adjust volume at this time" — Try again later

**Notes**:
- Volume is per-guild (affects all listeners)
- Default is 100%

---

### `/leave`

**Description**: Disconnect the bot from the voice channel.

**Parameters**: None

**Examples**:
```
/leave
```

**Response**:
- Shows "👋 Left" message
- Bot disconnects from voice channel

**Notes**:
- Does not clear the queue
- Bot can rejoin if you use `/play` again

---

## Usage Scenarios

### Scenario 1: Play a Single Song

```
1. /play query: Imagine John Lennon
   → Bot joins voice channel and plays the song
```

### Scenario 2: Create a Queue

```
1. /play query: Song 1
   → Now playing Song 1
2. /play query: Song 2
   → Added to queue at position 1
3. /play query: Song 3
   → Added to queue at position 2
4. /queue
   → Shows all 3 songs
5. /skip
   → Plays Song 2
```

### Scenario 3: Pause and Resume

```
1. /pause
   → Song pauses
2. /resume
   → Song resumes from where it paused
```

### Scenario 4: Loop a Song

```
1. /loop mode: one
   → Current song repeats indefinitely
2. /loop mode: off
   → Back to normal playback
```

### Scenario 5: Adjust Volume

```
1. /volume level: 30
   → Quiet playback
2. /volume level: 100
   → Maximum volume
```

---

## Tips & Tricks

### Search Tips

- **Be specific**: "Bohemian Rhapsody Queen" works better than "Bohemian"
- **Use artist name**: "The Weeknd Blinding Lights" finds the right version
- **Direct URLs**: Paste YouTube links for guaranteed results
- **Lyrics**: Can search by lyrics: "I'm just a poor boy though my story's seldom told"

### Queue Management

- Use `/queue` frequently to see what's coming
- Use `/skip` to jump songs you don't want
- Use `/stop` to clear everything and start fresh

### Playback Control

- `/pause` and `/resume` preserve your position
- `/loop one` is great for practicing or studying
- `/loop all` creates a continuous playlist

### Volume Control

- Start at 50% and adjust from there
- Lower volume (20-30%) for background music
- Higher volume (80-100%) for parties

---

## Keyboard Shortcuts

While using Discord:
- Press `/` to open command palette
- Type command name to search
- Press Tab to autocomplete
- Press Enter to execute

---

## Permissions Required

For the bot to work properly, it needs:

**Voice Channel Permissions**:
- ✅ Connect
- ✅ Speak
- ✅ Use Voice Activity

**Text Channel Permissions**:
- ✅ Send Messages
- ✅ Embed Links
- ✅ Read Message History

---

## Common Questions

**Q: Can I search by lyrics?**
A: Yes! Try `/play query: [lyrics snippet]`

**Q: What if a song isn't found?**
A: Try a different search term or use a direct YouTube URL

**Q: Can I queue multiple songs at once?**
A: Not directly, but you can add them one by one quickly

**Q: Does the bot remember the queue if it disconnects?**
A: No, the queue is cleared when the bot leaves

**Q: Can I adjust volume for individual users?**
A: No, volume is global for all listeners

**Q: What happens when the queue ends?**
A: Bot disconnects automatically (unless loop is on)

---

## Troubleshooting Commands

If something goes wrong:

1. **Check current state**: `/queue` and `/nowplaying`
2. **Try pausing**: `/pause` then `/resume`
3. **Skip the song**: `/skip` to try next song
4. **Disconnect**: `/leave` then `/play` to rejoin
5. **Clear everything**: `/stop` to reset

---

For more detailed information, see `MUSIC_SYSTEM.md` and `MUSIC_SETUP.md`.
