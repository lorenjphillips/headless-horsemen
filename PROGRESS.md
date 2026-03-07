# DemoForge — Progress Tracker

## Step 1: Stagehand + screen recording ✅ COMPLETE

**What was built:** `scripts/test-stagehand.ts`
- Connects to Browserbase cloud browser via Stagehand
- Navigates site, clicks elements via `act()` with natural language
- Captures ~5fps screenshots → ffmpeg stitches into `output/demo.webm`

**Key findings:**
- Stagehand v3 uses CDP, NOT Playwright — `recordVideo` unavailable
- Working approach: periodic `page.screenshot()` + ffmpeg
- Stagehand model format: `google/gemini-X` prefix required

---

## Step 2: Gemini API research ✅ COMPLETE

**See RESEARCH.md for full details.**

Key takeaways:
- SDK: `@google/genai` (NOT `@google/generative-ai` — deprecated Nov 2025)
- JSON schema-constrained output via `responseMimeType` + `responseSchema`
- `act()` = ONE action per call, describe by element type/label
- Structured output NOT compatible with thinking mode

---

## Step 3: Gemini 3.1 script generation + execution ✅ COMPLETE

**What was built:**
- `src/types.ts` — ActionStep (goto|act|wait|scroll), ActionLogEntry, DemoRequest types
- `src/generator.ts` — Gemini 3.1 Pro generates ActionStep[] from DemoRequest
  - Uses `@google/genai` SDK with structured JSON output (`responseMimeType` + `responseSchema`)
  - System prompt explains Stagehand capabilities and prompting best practices
  - Validates and converts raw Gemini output to typed ActionStep[]
- `src/executor.ts` — Runs action plan via Stagehand + captures video
  - Opens Browserbase browser with `google/gemini-2.5-flash`
  - Background screenshot capture at ~15fps
  - Executes goto/act/wait steps with error handling
  - Saves `output/actions.json` (timestamped action log) + `output/demo.webm` (video)
- `scripts/test-pipeline.ts` — End-to-end test

**E2E test result:**
- Input: `{ siteUrl: "https://github.com/browserbase/stagehand", demoTask: "Star the repository and then view the README file" }`
- Gemini 3.1 Pro generated 6-step plan in ~2s
- 5/6 steps succeeded (scroll failed because Star → GitHub login redirect, auth wall)
- Output: `demo.webm` (0.10 MB, 30 frames) + `actions.json`

**Key findings:**
- `gemini-3.1-pro-preview` works well for plan generation with structured output
- Stagehand `scrollTo` with `google/gemini-2.5-flash` has an internal bug: returns empty `elementId` on some pages
- Auth walls (GitHub star requires login) cause downstream action failures — need public targets or cookie injection

---

## Voiceover Pass: event-driven Gemini TTS ✅ COMPLETE

**What was built:**
- `src/stagehand.ts` — shared Browserbase Stagehand setup used by both execution paths
- `src/interaction-events.ts` — shared interaction-event normalization and metadata-to-event conversion using rendered output timing
- `src/demo-metadata.ts` — polished demo metadata reader and raw-to-output timeline mapping
- `src/voiceover.ts` — groups normalized interaction events into narration segments, asks Gemini for one short script line per segment, and renders one audio file per segment
- `src/final-cut.ts` — muxes synthesized voiceover segments back into a final narrated MP4
- `scripts/generate-voiceover.ts` — standalone CLI to regenerate voiceover assets from `output/interaction-events.json`
- `scripts/test-stagehand.ts` — now saves `output/interaction-events.json` and automatically generates `output/voiceover/manifest.json`, `output/voiceover/transcript.txt`, and per-segment audio files after the video is encoded
- `scripts/director-demo.ts` — scripted showcase demo for `director.ai` with explicit narration beats, pause-controlled pacing, and a final narrated cut

**Key decisions:**
- Only mouse/keyboard activity creates narration segments; idle windows stay silent
- Voiceover is emitted as multiple segment files instead of one continuous track so the composer can interleave or fast-forward around them later
- Script generation and TTS are separate Gemini calls: one to write concise narration, one to synthesize audio with a chosen voice

---

## Step 4: Captions + FFmpeg post-production — QUEUED

- Gemini generates timed captions from action log + key screenshots
- FFmpeg: burn captions, zoom on click targets, transitions, fade in/out
- Output: polished `.mp4`

---

## Step 5 (Stretch): ChromaDB — QUEUED
## Step 6 (Stretch): Lyria music — QUEUED
