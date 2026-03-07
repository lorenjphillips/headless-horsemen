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

## Step 3: Gemini 3.1 script generation + execution ← NEXT

**The core product flow:**
1. User provides: `{ siteUrl: "https://notion.so", demoTask: "Create a page and add a heading" }`
2. Gemini 3.1 Pro generates a full Stagehand action plan (JSON)
3. Stagehand executes the plan step-by-step while recording

### TODO
- [ ] Install `@google/genai` package
- [ ] Upgrade Stagehand model: `google/gemini-2.0-flash` → `google/gemini-2.5-flash`
- [ ] Build `src/types.ts` — ActionStep, ActionLog types
- [ ] Build `src/generator.ts`:
  - Takes `{ siteUrl, demoTask }`
  - Calls Gemini 3.1 Pro (`gemini-3.1-pro-preview`) with structured JSON output
  - System prompt explains Stagehand capabilities (act, goto, wait)
  - Returns: `ActionStep[]` — the full plan
- [ ] Build `src/executor.ts`:
  - Takes `ActionStep[]`
  - Opens Browserbase browser via Stagehand
  - Starts background screenshot capture (~5fps)
  - Executes each step: `page.goto()` / `stagehand.act()` / `sleep()`
  - Logs each action with timestamp
  - Saves: frames + `output/actions.json`
  - Stitches frames → `output/demo.webm` via ffmpeg
- [ ] Build `scripts/test-pipeline.ts` — end-to-end test
- [ ] Test with: `{ siteUrl: "https://github.com/browserbase/stagehand", demoTask: "Star the repository" }`

### Action plan schema (Gemini output)
```json
[
  { "action": "goto", "url": "https://github.com/browserbase/stagehand" },
  { "action": "act", "instruction": "click the Star button" },
  { "action": "wait", "seconds": 2 },
  { "action": "act", "instruction": "click the Unstar button to confirm" }
]
```

---

## Step 4: Captions + FFmpeg post-production — QUEUED

- Gemini generates timed captions from action log + key screenshots
- FFmpeg: burn captions, zoom on click targets, transitions, fade in/out
- Output: polished `.mp4`

---

## Step 5 (Stretch): ChromaDB — QUEUED
## Step 6 (Stretch): Lyria music — QUEUED
