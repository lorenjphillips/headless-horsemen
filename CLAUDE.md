# DemoForge

**Prompt → AI agent navigates website → records browser actions → outputs polished demo video with music**

## Stack

| Tool | Role |
|------|------|
| **Gemini 2.5 Flash** | Stagehand browser actions (fast, cheap) — model ID: `google/gemini-2.5-flash` |
| **Gemini 2.5 Pro** | Planner + caption generation (smart reasoning) — model ID: `gemini-2.5-pro` |
| **Stagehand** (Browserbase) | Browser automation — AI-native web agent that executes actions |
| **Playwright** | NOT used for video — Stagehand v3 uses CDP, not Playwright |
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
│  4. COMPOSE (FFmpeg)    │  Combine everything:
│     - Video + captions  │  - Browser recording
│     - Trim/transitions  │  - Burned-in captions
│     - Final render      │  Output: MP4 file
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  5. MUSIC (Lyria)       │  Stretch: generate background beat
│     - No public API yet │  May need alternative approach
│     - Lo-fi/upbeat vibe │  (or use a royalty-free track)
└─────────────────────────┘
```

## Implementation Steps

### Step 1: Stagehand + screen recording ✅ DONE
- Set up Stagehand with Browserbase cloud browser
- Stagehand v3 uses its own CDP layer, NOT Playwright — `recordVideo` is unavailable
- Browserbase `recordSession: true` captures rrweb data (DOM), not video
- **Working approach**: periodic `page.screenshot()` at ~5fps → ffmpeg stitches into `.webm`
- NotebookLM requires Google auth — switched to GitHub (public) for initial test
- Tested: navigates GitHub repo, clicks elements via `act()`, outputs `output/demo.webm`

### Step 2: Gemini prompt → action plan
- Send user prompt to Gemini, get back structured action steps (JSON)
- Define action schema: `{ action: "goto"|"click"|"type"|"wait"|"scroll", selector?: string, text?: string, url?: string }`
- Feed action plan into Stagehand for execution

### Step 3: Screenshot capture + caption generation
- Capture screenshots at each action step during execution
- Send screenshots + action context to Gemini for caption generation
- Output: array of `{ timestamp, caption_text }`

### Step 4: FFmpeg composition
- Burn captions into video (ASS/SRT subtitles or drawtext filter)
- Trim dead time, add fade in/out
- Output: final `.mp4`

### Step 5 (Stretch): ChromaDB for template reuse
- Embed successful demo step sequences into ChromaDB
- On new prompt, semantic search for similar past demos
- Use retrieved steps as few-shot examples for Gemini planning

### Step 6 (Stretch): Lyria music generation
- No public API currently available — investigate access during hackathon
- If available: generate a short background track matching video duration
- Fallback: use a royalty-free lo-fi track and mix via FFmpeg
- Output: audio file (`.mp3` or `.wav`), mixed into final video

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

## Gemini Models (as of March 2026)

Use the **latest stable** models. Stagehand model names use `google/` prefix.

| Use Case | Model ID | Notes |
|----------|----------|-------|
| Stagehand `act()` / `observe()` | `google/gemini-2.5-flash` | Fast, cheap, good for browser actions |
| Planner (prompt → action steps) | `gemini-2.5-pro` | Smart reasoning for complex plans |
| Caption generation | `gemini-2.5-pro` | Multimodal — can analyze screenshots |
| Bleeding edge (if needed) | `gemini-3.1-pro-preview` | Preview only, deprecating March 9 2026 |

Available Gemini 3 models (all preview):
- `gemini-3.1-pro-preview`
- `gemini-3.1-flash-lite-preview`
- `gemini-3-flash-preview`

## Key Learnings
- **Stagehand v3** uses its own CDP layer ("understudy"), NOT Playwright
- **Video recording**: `recordVideo` and CDP `Page.startScreencast` don't work on Browserbase — use periodic screenshots + ffmpeg
- **Stagehand model format**: must use `google/gemini-X` prefix, not bare `gemini-X`
- **Auth walls**: sites requiring login (NotebookLM, etc.) need cookie injection or a public target

## Key Decisions
- **TypeScript** — Stagehand is TS-native, keeps everything in one runtime
- **No frontend** — pipeline-first, CLI or API wrapper comes later
- **Browserbase cloud browsers** — no local Chrome needed, works anywhere
- **FFmpeg via shell** — call `ffmpeg` from Node, no native bindings needed
