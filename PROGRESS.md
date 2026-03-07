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
- Using `google/gemini-2.0-flash` as the AI model for Stagehand act()
- Using periodic screenshots + ffmpeg for video recording
- Switched target from NotebookLM (requires auth) to GitHub (public)
- Screenshot interval: 200ms (~5fps) — good balance of quality vs overhead
