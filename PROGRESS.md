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
- `src/types.ts` — ActionStep (goto|act|wait), ActionLogEntry, DemoRequest types
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

## Step 4: Captions + FFmpeg post-production — QUEUED

- Gemini generates timed captions from action log + key screenshots
- FFmpeg: burn captions, zoom on click targets, transitions, fade in/out
- Output: polished `.mp4`

---

## Step 5 (Stretch): ChromaDB — QUEUED
## Step 6 (Stretch): Lyria music — QUEUED
