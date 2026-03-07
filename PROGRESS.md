# DemoForge — Step 1 Progress

## Goal
Navigate to a website, click a button using AI, record the session as .webm video.

## Status: COMPLETE

### What was built
- `scripts/test-stagehand.ts` — Stagehand + Browserbase script that:
  1. Connects to Browserbase cloud browser via Stagehand
  2. Navigates to github.com/browserbase/stagehand
  3. Uses `act("click the green Code button")` — AI finds and clicks the button
  4. Uses `act("click the Star button")` — AI finds and clicks Star
  5. Captures 158 frames via periodic screenshots (~5 fps)
  6. Stitches frames into `output/demo.webm` via ffmpeg (0.46 MB)

### Steps Completed
- [x] Get API keys from user
- [x] Create `.env` with keys (BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, GEMINI_API_KEY)
- [x] Add `.env` to `.gitignore`
- [x] Install dependencies (@browserbasehq/stagehand, dotenv, typescript, tsx)
- [x] Read Stagehand docs for setup patterns
- [x] Write `scripts/test-stagehand.ts`
- [x] Run script and capture video

### Key Findings
- Stagehand v3 uses its own CDP layer ("understudy"), NOT Playwright
- `recordVideo` (Playwright feature) is NOT available in Stagehand v3
- Browserbase `recordSession: true` captures rrweb data (DOM events), not actual .webm video
- CDP `Page.startScreencast` is NOT available on Browserbase remote sessions
- **Working approach**: periodic `page.screenshot()` at ~5fps → ffmpeg stitches into .webm
- Stagehand supports Gemini models natively — use `google/gemini-2.0-flash` format
- Model format `gemini-2.0-flash` is deprecated; must use `google/gemini-2.0-flash`

### Blockers Resolved
- **NotebookLM requires Google auth** — switched to GitHub repo page (no auth needed)
- **Frames saved as .jpg but were PNG** — fixed to save as .png
- **CDP screencast unavailable on Browserbase** — fell back to periodic screenshots

### Resources
- Stagehand docs: https://docs.stagehand.dev
- Open Operator (related project): https://github.com/browserbase/open-operator
- Browserbase session replay: viewable at `https://www.browserbase.com/sessions/{sessionId}`

### Decisions
- Using `google/gemini-2.0-flash` as the AI model for Stagehand act() → **UPGRADE TO `google/gemini-2.5-flash`**
- Using periodic screenshots + ffmpeg for video recording
- Switched target from NotebookLM (requires auth) to GitHub (public)
- Screenshot interval: 200ms (~5fps) — good balance of quality vs overhead

---

## NEXT STEPS (assigned by orchestrator)

### Immediate: Upgrade Gemini model
- [ ] Change `google/gemini-2.0-flash` → `google/gemini-2.5-flash` in `scripts/test-stagehand.ts`
- [ ] Test that Stagehand still works with the new model

### Step 2: Wire up Gemini planner → Stagehand executor
- [ ] Create `src/planner.ts` — takes user prompt, calls Gemini 2.5 Pro (`gemini-2.5-pro` via `@google/generative-ai`), returns JSON action plan
- [ ] Action schema should map to Stagehand: `{ action: "goto"|"act"|"wait"|"extract", url?: string, instruction?: string, seconds?: number }`
- [ ] Use Gemini's JSON mode / structured output for reliable responses
- [ ] Create `src/executor.ts` — takes action plan JSON, runs each step via Stagehand `act()` / `page.goto()` / `sleep()`
- [ ] Integrate screenshot capture from test-stagehand.ts into executor
- [ ] Create `scripts/test-pipeline.ts` — end-to-end: prompt → plan → execute → video
- [ ] Test with: "Go to https://github.com/browserbase/stagehand and star the repository"

### Step 3: Caption generation
- [ ] After execution, send screenshots + action context to Gemini 2.5 Pro
- [ ] Generate timed captions: `{ timestamp_ms: number, text: string }[]`
- [ ] Burn captions into video via FFmpeg drawtext or ASS subtitles

### Notes
- `@google/generative-ai` npm package is for direct Gemini API calls (planner, captions)
- Stagehand has its own model config (uses `google/` prefix format)
- Research agent is separately investigating Gemini structured output patterns — check RESEARCH.md when available
