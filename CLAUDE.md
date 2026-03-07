# DemoForge

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
| **Gemini 3.1 Pro** | Structured action-plan generation |
| **Gemini 2.5 Flash** | Stagehand execution model |
| **Gemini TTS models** | Voiceover synthesis |
| **`@google/genai`** | Gemini SDK |
| **Stagehand** | Browser automation |
| **Browserbase** | Hosted browser sessions |
| **FFmpeg** | Encoding and audio conversion |

## Project Structure

```text
src/
  demo-video.ts         # polished renderer: cursor, zoom, speed ramps, mp4
  demo-metadata.ts      # metadata reader + source/output timeline mapping
  executor.ts           # generated-plan executor -> raw webm + action log
  final-cut.ts          # mux polished video + scripted voiceover
  generator.ts          # Gemini 3.1 plan generation
  interaction-events.ts # shared interaction-event parsing/normalization
  stagehand.ts          # shared Browserbase Stagehand configuration
  types.ts              # shared request / plan / action-log types
  voiceover.ts          # segment building + Gemini narration + TTS

scripts/
  director-demo.ts      # narrated director.ai showcase
  generate-voiceover.ts # rebuild voiceover assets from interaction-events.json
  test-pipeline.ts      # generated baseline pipeline
  test-stagehand.ts     # polished capture + voiceover demo
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
