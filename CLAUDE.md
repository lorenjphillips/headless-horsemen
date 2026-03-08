# Headless Horsemen

**Prompt -> browser automation -> polished demo video**

The repo currently has two working tracks:

1. **Generated baseline pipeline**
   - Input: `{ siteUrl, demoTask }`
   - Flow: Gemini generates an `ActionStep[]` plan, Stagehand executes it, screenshots are stitched into `output/demo.webm`
   - Entry point: `scripts/test-pipeline.ts`

2. **Polished capture + voiceover pipeline**
   - Input: a curated `DemoStep[]`
   - Flow: Stagehand executes steps, a second render pass adds cursor motion / zoom / speed ramps, then Gemini can generate segmented voiceover audio and FFmpeg can mux a final narrated cut
   - Entry point: `scripts/test-stagehand.ts`

3. **Scripted showcase demos**
   - Input: a curated `DemoStep[]` plus explicit narration beats
   - Flow: Stagehand executes the demo, the polished renderer keeps narration pacing via pause/hold steps, scripted TTS is synthesized, and a final narrated MP4 is muxed
   - Entry point: `scripts/director-demo.ts`

## What Exists Today

### Baseline generated path
- `src/generator.ts`
  - Gemini 3.1 Pro generates structured `ActionStep[]`
  - Supports `goto`, `act`, `wait`, and `scroll`
- `src/executor.ts`
  - Executes the generated plan on Browserbase with Stagehand
  - Captures screenshots during execution
  - Produces `output/actions.json` and `output/demo.webm`

### Polished capture path
- `src/demo-video.ts`
  - Records raw screenshots
  - Synthesizes cursor motion with Bezier curves
  - Applies zooming / framing logic around interactions
  - Fast-forwards idle regions and supports explicit pause/hold beats for narration
  - Renders a composited `output/demo.mp4`
- `src/demo-metadata.ts`
  - Reads polished demo metadata and maps raw capture time to rendered output time
- `src/final-cut.ts`
  - Muxes scripted voiceover audio segments back onto the polished video
- `src/voiceover.ts`
  - Groups interaction events into narration segments
  - Uses Gemini to write short per-segment lines
  - Uses Gemini TTS to synthesize audio files per segment
  - Also supports fully scripted narration segments for showcase demos
- `scripts/generate-voiceover.ts`
  - Rebuilds voiceover assets from `output/interaction-events.json`
- `scripts/director-demo.ts`
  - Runs the `director.ai` showcase demo and produces a final narrated MP4

## Current Architectural Gap

The repo is **not fully unified yet**.

- The generated baseline path starts from a freeform prompt but stops at a raw video.
- The polished path produces better output but still starts from manually authored `DemoStep[]`.

## Near-Term Plan

### Step 1: Keep both paths stable
- Baseline path stays as the fastest end-to-end validation for prompt -> plan -> execution
- Polished path stays as the quality reference for rendering and voiceover

### Step 2: Unify the pipelines
- Route generated `ActionStep[]` plans into the polished renderer
- Preserve raw `actions.json` logging so debugging does not regress
- Reuse interaction-event output for voiceover and later captioning

### Step 3: Post-production polish
- Burn captions onto the polished render
- Mix voiceover and optional background music
- Export a single final demo artifact

### Step 4: API + UI
- Wrap the unified pipeline in a small API
- Add a minimal UI for URL + task input
- Deploy after the prompt-to-polished path is stable

## Stack

| Tool | Role |
|------|------|
| **Gemini 3.1 Pro** | Script generator — takes URL + task → generates full Stagehand action plan |
| **Gemini 2.5 Flash** | Stagehand's built-in model for `act()` / `observe()` — model ID: `google/gemini-2.5-flash` |
| **`@google/genai`** | Gemini SDK (**NOT** `@google/generative-ai` which is deprecated) |
| **Stagehand** (Browserbase) | Browser automation — executes actions via natural language |
| **FFmpeg** | Video post-processing — trim, captions, transitions, combine audio |
| **Lyria** (Google DeepMind) | *Stretch* — background music generation |
| **ChromaDB Cloud** | Memory layer — stores successful demo plans, retrieves similar past demos as few-shot context for Gemini |

## Pipeline Architecture

```
User Input: { siteUrl, demoTask }
  e.g. { "https://notion.so", "Create a new page and add a heading" }
    │
    ▼
┌─────────────────────────────┐
│  1. GENERATE (Gemini 3.1)   │  Takes URL + task description
│     - Generates full action │  Output: JSON action plan
│       plan for Stagehand    │  (goto, act, wait steps)
│     - One-shot, structured  │
│       JSON output           │
└─────────┬───────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  2. EXECUTE (Stagehand)     │  Runs the generated plan step-by-step
│     - Browserbase cloud     │  Stagehand act() handles each action
│     - Screenshots at ~5fps  │  via natural language
│     - Action log with       │
│       timestamps            │
│     Output: frames[] +      │
│             action_log.json │
└─────────┬───────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  3. NARRATE (Gemini)        │  Review action log + key screenshots
│     - Generate captions     │  Produce timed caption text
│     - Summarize each step   │  (e.g., "Now we click 'New Task'...")
└─────────┬───────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  4. COMPOSE (FFmpeg)        │  Post-production:
│     - Frames → video        │  - Stitched screenshots
│     - Burn captions         │  - Burned-in captions
│     - Zoom on click areas   │  - Ken Burns / zoom effects
│     - Transitions/fades     │  - Background music (stretch)
│     Output: final.mp4       │
└─────────────────────────────┘
```

**How it works:** User gives a site + what to demo. Gemini 3.1 generates the entire Stagehand script upfront as a JSON action plan. Stagehand executes it while recording. Then post-production adds captions, zooms, and polish.

## Implementation Steps

### Step 1: Stagehand + screen recording ✅ DONE
- Set up Stagehand with Browserbase cloud browser
- Stagehand v3 uses its own CDP layer, NOT Playwright — `recordVideo` is unavailable
- **Working approach**: periodic `page.screenshot()` at ~5fps → ffmpeg stitches into `.webm`
- Tested: navigates GitHub repo, clicks elements via `act()`, outputs `output/demo.webm`

### Step 2: Gemini research ✅ DONE
- `@google/genai` is the correct SDK (NOT `@google/generative-ai` — deprecated)
- JSON schema-constrained output works via `responseMimeType` + `responseSchema`
- System prompts via `config.systemInstruction`
- Structured output NOT compatible with thinking mode
- Stagehand `act()` = one action per call, describe by element type/label not visuals
- See RESEARCH.md for full findings and code patterns

### Step 3: Gemini 3.1 script generation + execution ← CURRENT
Build `src/generator.ts` — Gemini 3.1 generates the action plan:
1. User provides `{ siteUrl, demoTask }`
2. Call Gemini 3.1 Pro with structured JSON output
3. Returns action plan: `[ { action: "goto"|"act"|"wait", ... } ]`

Build `src/executor.ts` — runs the plan via Stagehand:
1. Takes action plan JSON
2. Opens Browserbase browser, starts screenshot capture
3. Executes each step: `page.goto()` / `stagehand.act()` / `sleep()`
4. Saves frames + `output/actions.json` (timestamped action log)
5. Stitches frames → video via ffmpeg

Build `scripts/test-pipeline.ts` — end-to-end test:
- Input: `{ siteUrl: "https://github.com/browserbase/stagehand", demoTask: "Star the repository" }`
- Output: `output/demo.webm` + `output/actions.json`

### Step 4: Caption generation + FFmpeg composition
- Send action log + key screenshots to Gemini → timed captions
- FFmpeg burns captions, adds zoom on click areas, transitions, fade in/out
- Output: final `.mp4`

### Step 5: ChromaDB memory layer ✅ DONE
- ChromaDB Cloud stores successful demo plans (task + URL + action plan)
- On new demo request, queries for semantically similar past demos
- Injects top results as few-shot examples into Gemini's system prompt
- UI shows "Memory: X similar demos used as context" badge
- Pre-seed script: `npx tsx scripts/seed-memory.ts`

### Step 6 (Stretch): Lyria music generation
- No public API currently available — investigate access during hackathon
- Fallback: royalty-free lo-fi track mixed via FFmpeg

### Step 7: API + UI + Deploy
- Express server, single-page vanilla HTML UI, deploy to Railway
- See [`design/api-design.md`](design/api-design.md) for full spec (endpoints, OpenAPI, ASCII mockup, deployment plan)

## Project Structure

```text
src/
  generator.ts         # Gemini 3.1 → generates action plan JSON from URL + task
  executor.ts          # Stagehand runs action plan, captures screenshots
  memory.ts            # ChromaDB Cloud — store & recall demo plans for few-shot context
  narrator.ts          # Gemini generates timed captions from action log
  composer.ts          # FFmpeg: frames + captions + zoom + music → final.mp4
  types.ts             # Shared types (ActionStep, Caption, etc.)
  pipeline.ts          # Main orchestrator — generate → execute → narrate → compose
scripts/
  test-stagehand.ts    # ✅ Quick test: hardcoded actions, get video
  test-gemini.ts       # Quick test: prompt → action plan JSON
  test-pipeline.ts     # End-to-end: URL + task → polished video
  seed-memory.ts       # Pre-seed ChromaDB with example demo plans
```

## NPM Scripts

```bash
npm run demo            # polished capture demo
npm run demo:director   # narrated director.ai showcase
npm run demo:generated  # Gemini-generated baseline demo
npm run voiceover       # rebuild voiceover assets
npm run typecheck
```

## Environment

Required:

```bash
GEMINI_API_KEY=
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
CHROMA_API_KEY=
CHROMA_TENANT=
CHROMA_DATABASE=
```

Optional voiceover overrides:

```bash
GEMINI_SCRIPT_MODEL=
GEMINI_TTS_MODEL=
GEMINI_TTS_VOICE=
VOICEOVER_CONTEXT=
```

## Gemini Models

| Use Case | Model ID | Notes |
|----------|----------|-------|
| Plan generation | `gemini-3.1-pro-preview` | Best reasoning for full action plans |
| Stagehand execution | `google/gemini-2.5-flash` | Fast browser interaction model |
| Voiceover script generation | `gemini-2.5-flash` | Short structured narration |
| Voiceover synthesis | `gemini-2.5-pro-preview-tts` | Higher quality TTS |

## Key Decisions

- Screenshot capture remains the reliable primitive; native browser video capture is not the path here.
- The polished renderer is a second pass, not a direct browser recording.
- Voiceover is segmented by interaction window so the composer can later cut, stretch, or skip idle time cleanly.
- Shared Browserbase / Stagehand setup lives in one place so execution paths stay aligned.

## Workflow Rules

- Do **not** run the Browserbase-backed demo scripts unless the user explicitly asks.
- Safe local validation is `npm run typecheck`.
- Prefer keeping both execution tracks working until the generated path is successfully wired into the polished renderer.
