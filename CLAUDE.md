# DemoForge

**Prompt → AI agent navigates website → records browser actions → outputs polished demo video with music**

## Stack

| Tool | Role |
|------|------|
| **Gemini** | LLM — breaks prompt into browser action steps, generates captions |
| **Stagehand** (Browserbase) | Browser automation — AI-native web agent that executes actions |
| **Playwright** | Records the browser session as video |
| **FFmpeg** | Video post-processing — trim, captions, transitions, combine audio |
| **Lyria** (Google DeepMind) | Generates background music/beat for the demo |
| **ChromaDB** | *Stretch goal* — vector store for reusable demo step templates |

## Pipeline Architecture

```
User Prompt
    │
    ▼
┌─────────────────────────┐
│  1. PLAN (Gemini)       │  Prompt → structured action steps
│     - Parse user intent │  Output: JSON array of browser actions
│     - Identify target   │  (go to URL, click X, type Y, wait, etc.)
│     - Generate steps    │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  2. EXECUTE (Stagehand) │  Run actions in cloud browser via Browserbase
│     - Playwright record │  Playwright captures video of the session
│     - Screenshot key    │  Screenshots at key moments for captions
│       moments           │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  3. NARRATE (Gemini)    │  Gemini reviews screenshots + actions
│     - Generate captions │  Produces timed caption text
│     - Summarize steps   │  (e.g., "Now we click 'New Task'...")
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  4. MUSIC (Lyria)       │  Generate a short background beat
│     - Match duration    │  Matching the video duration
│     - Lo-fi/upbeat vibe │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  5. COMPOSE (FFmpeg)    │  Combine everything:
│     - Video + captions  │  - Browser recording
│     - Video + music     │  - Burned-in captions
│     - Trim/transitions  │  - Background music
│     - Final render      │  Output: MP4 file
└─────────────────────────┘
```

## Implementation Steps

### Step 1: Stagehand + Playwright recording
- Set up Stagehand with Browserbase cloud browser
- Configure Playwright to record video of the browser session
- Test: hardcoded script navigates a site and produces a raw `.webm`

### Step 2: Gemini prompt → action plan
- Send user prompt to Gemini, get back structured action steps (JSON)
- Define action schema: `{ action: "goto"|"click"|"type"|"wait"|"scroll", selector?: string, text?: string, url?: string }`
- Feed action plan into Stagehand for execution

### Step 3: Screenshot capture + caption generation
- Capture screenshots at each action step during execution
- Send screenshots + action context to Gemini for caption generation
- Output: array of `{ timestamp, caption_text }`

### Step 4: Lyria music generation
- Call Lyria API to generate a short background track
- Match duration to the recorded video length
- Output: audio file (`.mp3` or `.wav`)

### Step 5: FFmpeg composition
- Burn captions into video (ASS/SRT subtitles or drawtext filter)
- Mix in background music at low volume
- Trim dead time, add fade in/out
- Output: final `.mp4`

### Step 6 (Stretch): ChromaDB for template reuse
- Embed successful demo step sequences into ChromaDB
- On new prompt, semantic search for similar past demos
- Use retrieved steps as few-shot examples for Gemini planning

## Project Structure

```
src/
  pipeline.ts          # Main orchestrator — runs steps 1-5
  planner.ts           # Gemini prompt → action steps
  executor.ts          # Stagehand browser execution + Playwright recording
  narrator.ts          # Gemini caption generation from screenshots
  music.ts             # Lyria music generation
  composer.ts          # FFmpeg video + audio + captions composition
  types.ts             # Shared types (ActionStep, Caption, etc.)
scripts/
  test-stagehand.ts    # Quick test: run hardcoded actions, get video
  test-gemini.ts       # Quick test: prompt → action plan
  test-ffmpeg.ts       # Quick test: combine video + audio + captions
```

## Dev Setup

```bash
npm init -y
npm install @anthropic-ai/sdk @google/generative-ai @browserbasehq/stagehand playwright chromadb
npm install -D typescript tsx @types/node
npx tsc --init
```

Env vars needed:
```
GEMINI_API_KEY=
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
```

## Key Decisions
- **TypeScript** — Stagehand is TS-native, keeps everything in one runtime
- **No frontend** — pipeline-first, CLI or API wrapper comes later
- **Browserbase cloud browsers** — no local Chrome needed, works anywhere
- **FFmpeg via shell** — call `ffmpeg` from Node, no native bindings needed
