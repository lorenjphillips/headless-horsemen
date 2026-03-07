# Headless Horsemen

**Prompt → AI agent navigates website → records browser actions → outputs polished demo video with music**

## Stack

| Tool | Role |
|------|------|
| **Gemini 3.1 Pro** | Script generator — takes URL + task → generates full Stagehand action plan |
| **Gemini 2.5 Flash** | Stagehand's built-in model for `act()` / `observe()` — model ID: `google/gemini-2.5-flash` |
| **`@google/genai`** | Gemini SDK (**NOT** `@google/generative-ai` which is deprecated) |
| **Stagehand** (Browserbase) | Browser automation — executes actions via natural language |
| **FFmpeg** | Video post-processing — trim, captions, transitions, combine audio |
| **Lyria** (Google DeepMind) | *Stretch* — background music generation |
| **ChromaDB** | *Stretch* — vector store for reusable demo step templates |

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

### Step 5 (Stretch): ChromaDB for template reuse
- Embed successful action logs into ChromaDB
- On new prompt, semantic search for similar past demos
- Use retrieved logs as few-shot context for the agent

### Step 6 (Stretch): Lyria music generation
- No public API currently available — investigate access during hackathon
- Fallback: royalty-free lo-fi track mixed via FFmpeg

### Step 7: API + UI + Deploy
- Express server, single-page vanilla HTML UI, deploy to Railway
- See [`design/api-design.md`](design/api-design.md) for full spec (endpoints, OpenAPI, ASCII mockup, deployment plan)

## Project Structure

```
src/
  generator.ts         # Gemini 3.1 → generates action plan JSON from URL + task
  executor.ts          # Stagehand runs action plan, captures screenshots
  narrator.ts          # Gemini generates timed captions from action log
  composer.ts          # FFmpeg: frames + captions + zoom + music → final.mp4
  types.ts             # Shared types (ActionStep, Caption, etc.)
  pipeline.ts          # Main orchestrator — generate → execute → narrate → compose
scripts/
  test-stagehand.ts    # ✅ Quick test: hardcoded actions, get video
  test-gemini.ts       # Quick test: prompt → action plan JSON
  test-pipeline.ts     # End-to-end: URL + task → polished video
```

## Dev Setup

```bash
npm install @google/genai @browserbasehq/stagehand dotenv
npm install -D typescript tsx @types/node
```

**NOTE:** `@google/generative-ai` is DEPRECATED. Use `@google/genai` — different API shape. See RESEARCH.md.

Env vars needed:
```
GEMINI_API_KEY=
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
```

## Gemini Models (as of March 2026)

Stagehand model names use `google/` prefix. Direct API calls use bare model IDs.

| Use Case | Model ID | Notes |
|----------|----------|-------|
| **Script generator** (URL + task → plan) | `gemini-3.1-pro-preview` | Smartest reasoning, generates full action plans |
| Stagehand `act()` / `observe()` | `google/gemini-2.5-flash` | Fast + cheap for browser action execution |
| Caption generation | `gemini-2.5-flash` | Multimodal, fast enough for post-processing |
| Fallback if 3.1 is slow | `gemini-2.5-pro` | Stable, strong reasoning |

Available Gemini 3 models (all preview):
- `gemini-3.1-pro-preview` — **USE THIS for script generation**
- `gemini-3.1-flash-lite-preview` — fast + cheap
- `gemini-3-flash-preview`

**NOTE:** `gemini-3-pro-preview` is deprecated March 9 2026. Use `gemini-3.1-pro-preview`.

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

## Workflow Rules
- **Do NOT run the pipeline** (`npx tsx scripts/test-pipeline.ts`) — it takes 30-60+ seconds with Browserbase + ffmpeg encoding. The user will run it themselves and report results.
- You may generate/edit pipeline code freely, just don't execute it.
