# FFmpeg Post-Production Research for Headless Horsemen

Research for Step 4 of the pipeline: turning raw browser recordings into polished demo videos.

**Input assumptions:**
- `output/{jobId}/demo.mp4` -- raw browser recording (1280x720, H.264, ~60fps, ~30s)
- `output/{jobId}/actions.json` -- timestamped action log (see `src/types.ts` for shape)
- FFmpeg 7.1.1 on macOS (Homebrew), compiled with libfreetype, libass, libx264, libfontconfig

---

## Table of Contents
1. [Caption Burning (MOST IMPORTANT)](#1-caption-burning)
2. [Zoom/Pan on Click Areas](#2-zoompan-on-click-areas)
3. [Transitions (Fade In/Out)](#3-transitions)
4. [Intro/Outro Title Cards](#4-introoutro-title-cards)
5. [Audio Track Mixing](#5-audio-track-mixing)
6. [Recommended Pipeline Order](#6-recommended-pipeline-order)
7. [All-in-One Command](#7-all-in-one-command)

---

## 1. Caption Burning

**Difficulty: EASY-MEDIUM**
**Recommendation: DO THIS -- it is the single biggest visual upgrade**

### Approach Comparison

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| `drawtext` filter | No external files, all in one command, easy to generate programmatically | Complex filter syntax, one `drawtext` per caption, escaping is painful | BEST for hackathon |
| ASS subtitle file + `ass` filter | Rich styling (outline, shadow, background box), standard format | Requires writing a `.ass` file first, two-step process | Best styling, slightly more work |
| SRT file + `subtitles` filter | Simplest file format | Limited styling options, no background box | Too plain |

**Winner: ASS subtitle file.** The styling is dramatically better (semi-transparent background box, outline, shadow), and generating a `.ass` file from TypeScript is straightforward string concatenation. The `drawtext` filter gets unwieldy with more than 2-3 captions and has painful escaping issues.

### Option A: ASS Subtitles (RECOMMENDED)

#### Step 1: Generate the ASS file

The ASS (Advanced SubStation Alpha) format has a header section and a dialogue section. Here is a complete example:

```
[Script Info]
Title: Headless Horsemen Captions
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,28,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,2,0,2,40,40,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:03.20,Default,,0,0,0,,Navigating to github.com/browserbase/stagehand
Dialogue: 0,0:00:03.20,0:00:05.80,Default,,0,0,0,,Clicking the 'Create' button
Dialogue: 0,0:00:05.80,0:00:08.00,Default,,0,0,0,,Waiting for the page to load...
```

**Key style settings explained:**
- `PrimaryColour: &H00FFFFFF` -- white text (AABBGGRR format, `&H00` = fully opaque)
- `OutlineColour: &H00000000` -- black outline
- `BackColour: &H80000000` -- semi-transparent black background (`&H80` = 50% alpha)
- `BorderStyle: 3` -- opaque box behind text (this is the magic setting for the background pill)
- `Outline: 2` -- 2px outline thickness
- `Shadow: 0` -- no drop shadow (the box is enough)
- `Alignment: 2` -- bottom-center (SSA alignment: 1=left, 2=center, 3=right; add 4 for middle, 8 for top)
- `MarginV: 50` -- 50px from bottom edge
- `Fontsize: 28` -- readable at 720p without dominating the frame

**Color format note:** ASS uses `&HAABBGGRR` (alpha, blue, green, red -- reversed from typical RGBA). For BackColour, `&H80000000` means 50% transparent black.

#### Step 2: Burn into video

```bash
ffmpeg -y -i demo.mp4 -vf "ass=captions.ass" -c:v libx264 -c:a copy -pix_fmt yuv420p output.mp4
```

That is the entire command. The `ass` filter reads the `.ass` file and renders styled subtitles directly onto the video frames.

**Flags explained:**
- `-y` -- overwrite output without asking
- `-vf "ass=captions.ass"` -- apply the ASS subtitle filter
- `-c:v libx264` -- re-encode video with H.264
- `-c:a copy` -- pass through audio unchanged (if any)
- `-pix_fmt yuv420p` -- ensure compatibility with all players

#### ASS Timestamp Format

ASS uses `H:MM:SS.cc` (centiseconds, not milliseconds). To convert from milliseconds:

```
timestamp_ms = 3200
→ hours = 0
→ minutes = 0
→ seconds = 3
→ centiseconds = 20
→ "0:00:03.20"
```

#### Generating the ASS file from TypeScript

The composer needs to:
1. Take the action log (with `timestamp_ms` for each step) and caption text array
2. Calculate start/end times: each caption starts at its step's `timestamp_ms` and ends at the next step's `timestamp_ms` (or video end for the last caption)
3. Write the ASS header (always the same) + dialogue lines
4. Write to `output/{jobId}/captions.ass`
5. Run the ffmpeg command

**Converting ms to ASS timestamp:**
```
function msToASS(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
```

**Example generation pseudocode:**
```
for each caption (index i):
  start = actions[i].timestamp_ms
  end = actions[i+1]?.timestamp_ms ?? videoDurationMs
  write: Dialogue: 0,{msToASS(start)},{msToASS(end)},Default,,0,0,0,,{caption.text}
```

### Option B: drawtext Filter (BACKUP)

If you want to avoid generating a file, `drawtext` works inline. But it gets messy with multiple captions:

```bash
ffmpeg -y -i demo.mp4 \
  -vf "drawtext=text='Navigating to the website':fontsize=28:fontcolor=white:borderw=2:bordercolor=black:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-60:enable='between(t,0,3.2)', \
       drawtext=text='Clicking the Create button':fontsize=28:fontcolor=white:borderw=2:bordercolor=black:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-60:enable='between(t,3.2,5.8)'" \
  -c:v libx264 -pix_fmt yuv420p output.mp4
```

**drawtext parameters:**
- `text='...'` -- the caption text (must escape `:` `'` `\` with `\`)
- `fontsize=28` -- font size in pixels
- `fontcolor=white` -- text color
- `borderw=2` -- text outline width
- `bordercolor=black` -- text outline color
- `box=1` -- enable background box
- `boxcolor=black@0.5` -- semi-transparent black background
- `boxborderw=10` -- padding around text inside the box
- `x=(w-text_w)/2` -- horizontally centered
- `y=h-60` -- 60px from bottom
- `enable='between(t,0,3.2)'` -- show only between t=0s and t=3.2s

**Why drawtext is worse for programmatic generation:**
- Each caption is a separate `drawtext` filter chained with commas
- Special characters in text require escaping (colons, quotes, backslashes)
- The filter chain string gets very long and hard to debug
- No background pill effect as clean as ASS `BorderStyle: 3`

**Escaping rules for drawtext text:**
- `:` must be escaped as `\:`
- `'` must be escaped as `'\''` (end quote, escaped quote, start quote)
- `\` must be escaped as `\\`
- Newlines: `%{n}` or literal `\n` depending on version

### Recommendation

**Use the ASS approach.** Write a `captions.ass` file from TypeScript (it is just string concatenation), then run one ffmpeg command. The visual result is significantly better, the code is cleaner, and debugging is easier because you can inspect the `.ass` file separately.

---

## 2. Zoom/Pan on Click Areas

**Difficulty: HARD**
**Recommendation: SKIP for hackathon. Use click highlight circle instead.**

### The zoompan filter

The FFmpeg `zoompan` filter creates Ken Burns-style zoom/pan effects. Basic syntax:

```bash
ffmpeg -y -i demo.mp4 \
  -vf "zoompan=z='if(between(in,60,120),1.5,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=60" \
  -c:v libx264 -pix_fmt yuv420p output.mp4
```

**Parameters:**
- `z` -- zoom factor expression (1 = no zoom, 2 = 2x zoom)
- `x`, `y` -- pan position (top-left corner of the visible area)
- `d` -- duration per input frame (for images; for video, set to 1)
- `s` -- output resolution
- `fps` -- output framerate
- `in` -- current input frame number

### Why it is hard

1. **zoompan is designed for images, not video.** It processes each frame independently. Using it on video requires setting `d=1` (one output frame per input frame), which works but the zoom is either on or off -- no smooth zoom animation without complex expressions.

2. **Zoom to a specific area requires knowing coordinates.** You need `(x, y)` of the click target in pixel coordinates. Stagehand's `act()` does not return click coordinates -- it just performs the action. You would need to add coordinate tracking to the executor.

3. **Smooth zoom in/out requires complex math.** To zoom from 1x to 1.5x over 30 frames, then hold, then zoom back:
   ```
   z='if(between(in,F1,F1+30), 1+0.5*(in-F1)/30, if(between(in,F1+30,F2), 1.5, if(between(in,F2,F2+30), 1.5-0.5*(in-F2)/30, 1)))'
   ```
   This is one zoom event. You need this for every click. The expression becomes unmanageable.

4. **Resolution loss.** Zooming in 1.5x on a 1280x720 source means you are viewing a 853x480 region scaled up. The result looks blurry.

### Better Alternative: Click Highlight Circle Overlay

Instead of zooming, draw a pulsing circle or ring at the click location. This is much simpler and still looks professional (many screen recording tools do this).

```bash
ffmpeg -y -i demo.mp4 \
  -vf "drawbox=x=620:y=340:w=40:h=40:color=red@0.6:t=3:enable='between(t,3.2,4.0)'" \
  -c:v libx264 -pix_fmt yuv420p output.mp4
```

But a circle looks better than a box. For a circle, use `drawtext` with a Unicode circle or the `overlay` filter with a pre-rendered PNG:

**Method: Overlay a click indicator PNG**

1. Generate a small semi-transparent red circle PNG (once, keep in `assets/`):
```bash
ffmpeg -y -f lavfi -i "color=c=red@0.4:s=50x50:d=1,format=rgba" \
  -vf "geq=a='if(lt(sqrt((X-25)*(X-25)+(Y-25)*(Y-25)),25),128,0)':r='255':g='80':b='80'" \
  -frames:v 1 assets/click-circle.png
```

2. Overlay it at specific coordinates and times:
```bash
ffmpeg -y -i demo.mp4 -i assets/click-circle.png \
  -filter_complex "[0][1]overlay=x=595:y=315:enable='between(t,3.2,4.0)'" \
  -c:v libx264 -pix_fmt yuv420p output.mp4
```

**Problem:** We still do not have click coordinates from Stagehand. Without them, we cannot place the overlay. This requires changes to the executor.

### Honest Assessment

| Approach | Difficulty | Looks good? | Needs click coords? |
|----------|-----------|-------------|---------------------|
| zoompan | HARD | Yes, if done well | Yes |
| Click highlight circle | MEDIUM | Yes | Yes |
| Skip entirely | EASY | N/A | No |

**Verdict: Skip for hackathon.** Both approaches require click coordinate data that we do not have. Adding coordinate tracking to Stagehand's `act()` is non-trivial and adds complexity to the executor. The captions alone will make the video look polished. If you have extra time, the click highlight circle is the easiest upgrade path, but only if you can get coordinates.

---

## 3. Transitions (Fade In/Out)

**Difficulty: EASY**
**Recommendation: DO fade in/out. SKIP cross-fades between scenes.**

### Fade In at Start + Fade Out at End

This is the simplest visual upgrade after captions. A 0.5-1 second fade from/to black.

```bash
ffmpeg -y -i demo.mp4 \
  -vf "fade=t=in:st=0:d=0.8,fade=t=out:st=29.2:d=0.8" \
  -c:v libx264 -c:a copy -pix_fmt yuv420p output.mp4
```

**Parameters:**
- `fade=t=in:st=0:d=0.8` -- fade in from black, starting at t=0, duration 0.8 seconds
- `fade=t=out:st=29.2:d=0.8` -- fade to black, starting at t=29.2s (assuming 30s video), duration 0.8s
- `st` = start time in seconds
- `d` = duration in seconds

**For the fade-out, you need to know the video duration.** Get it with:

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4
```

This outputs a number like `30.500000`. Then calculate `st = duration - fade_duration`.

**Combining with captions in one command:**

```bash
ffmpeg -y -i demo.mp4 \
  -vf "ass=captions.ass,fade=t=in:st=0:d=0.8,fade=t=out:st=29.2:d=0.8" \
  -c:v libx264 -c:a copy -pix_fmt yuv420p output.mp4
```

Filters are chained with commas. Order matters: burn captions first, then apply fades (so the captions fade with the video).

### Cross-Fade Between Scenes

The `xfade` filter can cross-fade between two video segments:

```bash
ffmpeg -y -i scene1.mp4 -i scene2.mp4 \
  -filter_complex "xfade=transition=fade:duration=0.5:offset=4.5" \
  -c:v libx264 -pix_fmt yuv420p output.mp4
```

**Why this is hard for Headless Horsemen:**
- You would need to split the video into scenes first (at each `goto` action timestamp)
- Then cross-fade between each pair of scenes
- With N scenes, you need N-1 xfade filters chained together
- Each xfade changes the timeline, so offsets need careful calculation

**Verdict: Skip.** The fade in/out gives 80% of the polish with 5% of the effort. Cross-fades add significant complexity for minimal visual improvement in a browser recording where scenes flow naturally.

---

## 4. Intro/Outro Title Cards

**Difficulty: EASY-MEDIUM**
**Recommendation: DO THIS -- high impact, straightforward**

### Approach: Generate solid-color frames with text using lavfi

FFmpeg can generate video frames from nothing using the `color` source filter and `drawtext`. No need for external images.

#### Generate a 3-second intro card

```bash
ffmpeg -y \
  -f lavfi -i "color=c=#1a1a2e:s=1280x720:d=3:r=60" \
  -vf "drawtext=text='Headless Horsemen':fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-30, \
       drawtext=text='AI-Powered Demo Videos':fontsize=24:fontcolor=#aaaaaa:x=(w-text_w)/2:y=(h-text_h)/2+40, \
       fade=t=in:st=0:d=0.5,fade=t=out:st=2.5:d=0.5" \
  -c:v libx264 -pix_fmt yuv420p -t 3 intro.mp4
```

**What this does:**
- Creates a 3-second, 1280x720, 60fps video with a dark navy background (`#1a1a2e`)
- Draws "Headless Horsemen" centered in white, 56px
- Draws "AI-Powered Demo Videos" below it in gray, 24px
- Fades in over 0.5s, fades out over 0.5s

#### Generate a 3-second outro card

```bash
ffmpeg -y \
  -f lavfi -i "color=c=#1a1a2e:s=1280x720:d=3:r=60" \
  -vf "drawtext=text='Built with Stagehand + Gemini':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-20, \
       drawtext=text='github.com/browserbase/stagehand':fontsize=22:fontcolor=#6699cc:x=(w-text_w)/2:y=(h-text_h)/2+30, \
       fade=t=in:st=0:d=0.5,fade=t=out:st=2.5:d=0.5" \
  -c:v libx264 -pix_fmt yuv420p -t 3 outro.mp4
```

#### Concatenate intro + main video + outro

First, create a concat list file (`concat.txt`):

```
file 'intro.mp4'
file 'demo_with_captions.mp4'
file 'outro.mp4'
```

Then concatenate:

```bash
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy final.mp4
```

**Important:** All three videos MUST have the same resolution (1280x720), framerate (60fps), and codec (H.264). The `color` source filter's `s=1280x720:r=60` and the `-c:v libx264` ensure this. The `-c copy` concat is instant because it does not re-encode.

#### Alternative: Use a PNG image as the title card

If you want a fancier design (logo, gradients), create a PNG in any image editor and convert it:

```bash
# Convert a static PNG to a 3-second video
ffmpeg -y -loop 1 -i intro.png -c:v libx264 -t 3 -pix_fmt yuv420p -r 60 \
  -vf "fade=t=in:st=0:d=0.5,fade=t=out:st=2.5:d=0.5" intro.mp4
```

**Recommendation for hackathon:** Use the lavfi approach (no external files needed). The drawtext title cards look clean and professional on a dark background.

### Making intro text dynamic

For Headless Horsemen, you might want to show the site URL and task in the intro. When generating programmatically, substitute the values into the drawtext text parameter:

```bash
ffmpeg -y \
  -f lavfi -i "color=c=#1a1a2e:s=1280x720:d=3:r=60" \
  -vf "drawtext=text='Demo\: github.com/browserbase/stagehand':fontsize=32:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-20, \
       drawtext=text='Star the repository':fontsize=24:fontcolor=#aaaaaa:x=(w-text_w)/2:y=(h-text_h)/2+30, \
       fade=t=in:st=0:d=0.5,fade=t=out:st=2.5:d=0.5" \
  -c:v libx264 -pix_fmt yuv420p -t 3 intro.mp4
```

**Escaping in drawtext:** Colons in URLs must be escaped with `\:` (e.g., `https\://`). When generating from TypeScript, replace `:` with `\\:` in the text string.

---

## 5. Audio Track Mixing

**Difficulty: EASY**
**Recommendation: DO THIS if you have a music file -- it is one command**

### Mix background music at low volume

```bash
ffmpeg -y -i demo.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.15,afade=t=out:st=28:d=2[music];[0:a][music]amix=inputs=2:duration=shortest[aout]" \
  -map 0:v -map "[aout]" \
  -c:v copy -c:a aac -b:a 128k -shortest output.mp4
```

Wait -- the raw video from the executor has no audio track (it is stitched from screenshots). So the simpler version is:

### Add music to a video that has no audio

```bash
ffmpeg -y -i demo.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.15,afade=t=in:st=0:d=1,afade=t=out:st=28:d=2[aout]" \
  -map 0:v -map "[aout]" \
  -c:v copy -c:a aac -b:a 128k -shortest output.mp4
```

**What this does:**
- Takes video from `demo.mp4` (no audio)
- Takes audio from `music.mp3`
- Reduces music volume to 15% (`volume=0.15`)
- Fades audio in over 1 second at the start
- Fades audio out over 2 seconds starting at t=28s (adjust to `video_duration - 2`)
- `-shortest` cuts the audio to match the video duration (so a 3-minute song gets trimmed to 30s)
- `-c:v copy` means no video re-encode (fast)
- `-c:a aac` encodes audio as AAC for MP4 compatibility

### If the video already has audio (future case)

```bash
ffmpeg -y -i demo.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.15,afade=t=out:st=28:d=2[music];[0:a]volume=1.0[orig];[orig][music]amix=inputs=2:duration=first[aout]" \
  -map 0:v -map "[aout]" \
  -c:v copy -c:a aac -b:a 128k output.mp4
```

### Auto-detect video duration for audio fade-out

Get duration first, then use it:

```bash
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4)
FADE_START=$(echo "$DURATION - 2" | bc)

ffmpeg -y -i demo.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.15,afade=t=in:st=0:d=1,afade=t=out:st=${FADE_START}:d=2[aout]" \
  -map 0:v -map "[aout]" \
  -c:v copy -c:a aac -b:a 128k -shortest output.mp4
```

In TypeScript, get the duration from ffprobe first:

```
const duration = execSync('ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4').toString().trim();
const fadeStart = parseFloat(duration) - 2;
```

### Royalty-free music sources

Since Lyria has no public API, use a royalty-free track. Options:
- Bundle a single lo-fi/chill track in `assets/background-music.mp3` (find one on Pixabay or similar)
- Keep it under 1 MB to avoid bloating the repo
- A 30-second loop is ideal since most demos are ~30s

---

## 6. Recommended Pipeline Order

The FFmpeg post-production should run as a sequence of steps. Some can be combined into a single command, others are best kept separate for clarity and debuggability.

### Minimal pipeline (hackathon MVP)

```
1. Generate captions.ass from action log + Gemini captions
2. Burn captions + fades into video (single ffmpeg command)
3. Done → output final.mp4
```

Single command for step 2:

```bash
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4)
FADE_OUT_START=$(echo "$DURATION - 0.8" | bc)

ffmpeg -y -i demo.mp4 \
  -vf "ass=captions.ass,fade=t=in:st=0:d=0.8,fade=t=out:st=${FADE_OUT_START}:d=0.8" \
  -c:v libx264 -pix_fmt yuv420p -b:v 6M output.mp4
```

### Full pipeline (with intro/outro + music)

```
1. Generate captions.ass from action log + Gemini captions
2. Burn captions + fades into main video → captioned.mp4
3. Generate intro.mp4 (lavfi title card, 3 seconds)
4. Generate outro.mp4 (lavfi title card, 3 seconds)
5. Concatenate intro + captioned + outro → combined.mp4
6. Mix background music → final.mp4
```

Commands for steps 2-6:

```bash
# Step 2: Captions + fades
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4)
FADE_OUT_START=$(echo "$DURATION - 0.8" | bc)
ffmpeg -y -i demo.mp4 \
  -vf "ass=captions.ass,fade=t=in:st=0:d=0.8,fade=t=out:st=${FADE_OUT_START}:d=0.8" \
  -c:v libx264 -pix_fmt yuv420p -b:v 6M captioned.mp4

# Step 3: Intro card
ffmpeg -y \
  -f lavfi -i "color=c=#1a1a2e:s=1280x720:d=3:r=60" \
  -vf "drawtext=text='Headless Horsemen':fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-30, \
       drawtext=text='AI-Powered Demo Videos':fontsize=24:fontcolor=#aaaaaa:x=(w-text_w)/2:y=(h-text_h)/2+40, \
       fade=t=in:st=0:d=0.5,fade=t=out:st=2.5:d=0.5" \
  -c:v libx264 -pix_fmt yuv420p -t 3 intro.mp4

# Step 4: Outro card
ffmpeg -y \
  -f lavfi -i "color=c=#1a1a2e:s=1280x720:d=3:r=60" \
  -vf "drawtext=text='Built with Stagehand + Gemini':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-20, \
       drawtext=text='github.com/browserbase/stagehand':fontsize=22:fontcolor=#6699cc:x=(w-text_w)/2:y=(h-text_h)/2+30, \
       fade=t=in:st=0:d=0.5,fade=t=out:st=2.5:d=0.5" \
  -c:v libx264 -pix_fmt yuv420p -t 3 outro.mp4

# Step 5: Concatenate
printf "file 'intro.mp4'\nfile 'captioned.mp4'\nfile 'outro.mp4'\n" > concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy combined.mp4

# Step 6: Add music
TOTAL_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 combined.mp4)
MUSIC_FADE_START=$(echo "$TOTAL_DURATION - 2" | bc)
ffmpeg -y -i combined.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.15,afade=t=in:st=0:d=1,afade=t=out:st=${MUSIC_FADE_START}:d=2[aout]" \
  -map 0:v -map "[aout]" \
  -c:v copy -c:a aac -b:a 128k -shortest final.mp4
```

---

## 7. All-in-One Command

If you want to minimize intermediate files, you can combine captions + fades into one command. But intro/outro concatenation and audio mixing are best as separate steps (concat requires separate files, and audio mixing with `-c:v copy` avoids re-encoding).

### Minimum viable single command (captions + fades, no intro/outro/music)

```bash
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4)
FADE_OUT=$(echo "$DURATION - 0.8" | bc)

ffmpeg -y -i demo.mp4 \
  -vf "ass=captions.ass,fade=t=in:st=0:d=0.8,fade=t=out:st=${FADE_OUT}:d=0.8" \
  -c:v libx264 -pix_fmt yuv420p -b:v 6M final.mp4
```

### TypeScript integration pattern

All of these commands should be called from TypeScript via `child_process.execSync` (or `execFileSync` for better argument handling). The `composer.ts` module should:

1. Accept the job's output directory path
2. Read `actions.json` to get timestamps
3. Accept caption text array (from narrator)
4. Write `captions.ass` file
5. Get video duration via `ffprobe`
6. Run the ffmpeg commands in sequence
7. Clean up intermediate files
8. Return the path to `final.mp4`

**Important note on execSync:** Set `{ timeout: 120000 }` (2 minutes) on each ffmpeg call. Video encoding can be slow, especially with re-encoding. The concat and audio-mix steps are fast (seconds) because they use `-c copy` or `-c:v copy`.

---

## Summary Table

| Technique | Difficulty | Impact | Hackathon? | Notes |
|-----------|-----------|--------|------------|-------|
| **ASS captions** | Easy-Medium | HIGH | YES | Best visual upgrade. Generate .ass file, one ffmpeg command. |
| **Fade in/out** | Easy | Medium | YES | Two filter params, combine with caption command. |
| **Intro/outro cards** | Easy-Medium | Medium-High | YES | lavfi-generated, concat with main video. |
| **Background music** | Easy | Medium | YES (if track available) | One command, no re-encode. |
| **Zoom on click** | Hard | Medium | NO | Requires click coordinates we do not have. |
| **Cross-fade scenes** | Medium-Hard | Low | NO | Splitting + chained xfades, not worth it. |
| **Click highlight** | Medium | Medium | NO (needs coords) | Simpler than zoom but still needs executor changes. |

### Priority order for implementation

1. Caption burning (ASS) -- the one feature that makes the video a "demo" instead of a "screen recording"
2. Fade in/out -- trivial to add, chain with caption filter
3. Intro/outro title cards -- makes it feel like a product
4. Background music -- if you have a track file, it is one command
5. Everything else -- skip for hackathon
