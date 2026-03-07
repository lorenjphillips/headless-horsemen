# DemoForge

**Prompt → AI agent navigates website → records browser actions → outputs polished demo video with music**

## Stack

| Tool | Role |
|------|------|
| **Gemini 3.1 Pro** | Agentic brain — observes page, decides actions, iterates in a loop |
| **Gemini 2.5 Flash** | Stagehand's built-in model for `act()` / `observe()` — model ID: `google/gemini-2.5-flash` |
| **`@google/genai`** | Gemini SDK (**NOT** `@google/generative-ai` which is deprecated) |
| **Stagehand** (Browserbase) | Browser automation — executes actions via natural language |
| **FFmpeg** | Video post-processing — trim, captions, transitions, combine audio |
| **Lyria** (Google DeepMind) | *Stretch* — background music generation |
| **ChromaDB** | *Stretch* — vector store for reusable demo step templates |

## Pipeline Architecture

```
User Prompt
    │
    ▼
┌──────────────────────────────────────────────────┐
│  1. AGENT LOOP (Gemini 3.1 Pro + Stagehand)      │
│                                                    │
│     Gemini 3.1 is the BRAIN. Each iteration:       │
│     ┌──────────────────────────────────┐           │
│     │ a. Observe page (screenshot +    │           │
│     │    stagehand.observe())          │           │
│     │ b. Gemini decides next action    │           │
│     │ c. Stagehand executes action     │           │
│     │ d. Screenshot captured (frame)   │           │
│     │ e. Gemini checks: done or next?  │           │
│     └──────────┬───────────────────────┘           │
│                │ loop until task complete           │
│     Output: frames[] + action log                  │
└─────────┬────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────┐
│  2. NARRATE (Gemini)    │  Review action log + key screenshots
│     - Generate captions │  Produce timed caption text
│     - Summarize steps   │  (e.g., "Now we click 'New Task'...")
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  3. COMPOSE (FFmpeg)    │  Combine everything:
│     - Frames → video    │  - Stitched screenshots
│     - Burn captions     │  - Burned-in captions
│     - Trim/transitions  │  Output: MP4 file
└─────────────────────────┘
```

**Key difference from v1 plan:** Gemini 3.1 is NOT just a one-shot planner. It's an **agentic loop** — it observes the page, decides what to do, executes, checks the result, and keeps going until the task is done. No pre-planned JSON array. The model reacts to what it actually sees.

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

### Step 3: Gemini 3.1 agentic loop ← CURRENT
Build `src/agent.ts` — the core agentic loop:
1. Take user prompt + target URL
2. Open Browserbase browser via Stagehand
3. Start screenshot capture loop (background, ~5fps)
4. **Loop:**
   a. Take screenshot of current page state
   b. Send screenshot + prompt + action history to Gemini 3.1 Pro
   c. Gemini responds with next action (JSON): `{ action, instruction?, url?, done? }`
   d. Execute action via Stagehand `act()` / `page.goto()` / wait
   e. Log the action to action history
   f. If `done: true` → break
5. Stop screenshot capture, stitch frames → video via ffmpeg
6. Output: `output/demo.webm` + `output/actions.json` (action log)

**Test**: "Go to github.com/browserbase/stagehand and star the repository"

### Step 4: Caption generation + FFmpeg composition
- Send action log + key screenshots to Gemini → timed captions
- FFmpeg burns captions into video, trims dead time, adds fade
- Output: final `.mp4`

### Step 5 (Stretch): ChromaDB for template reuse
- Embed successful action logs into ChromaDB
- On new prompt, semantic search for similar past demos
- Use retrieved logs as few-shot context for the agent

### Step 6 (Stretch): Lyria music generation
- No public API currently available — investigate access during hackathon
- Fallback: royalty-free lo-fi track mixed via FFmpeg

## Project Structure

```
src/
  agent.ts             # Core agentic loop — Gemini 3.1 observes + decides + acts
  narrator.ts          # Gemini caption generation from action log + screenshots
  composer.ts          # FFmpeg video + captions composition
  types.ts             # Shared types (AgentAction, Caption, etc.)
  pipeline.ts          # Main orchestrator — agent → narrate → compose
scripts/
  test-stagehand.ts    # ✅ Quick test: hardcoded actions, get video
  test-gemini.ts       # Quick test: prompt → single action response
  test-agent.ts        # End-to-end: prompt → agentic loop → video
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
| **Agent brain** (agentic loop) | `gemini-3.1-pro-preview` | Smartest reasoning, agentic workflows |
| Stagehand `act()` / `observe()` | `google/gemini-2.5-flash` | Fast + cheap for browser action execution |
| Caption generation | `gemini-2.5-flash` | Multimodal, fast enough for post-processing |
| Fallback if 3.1 is slow | `gemini-2.5-pro` | Stable, strong reasoning |

Available Gemini 3 models (all preview):
- `gemini-3.1-pro-preview` — **USE THIS for agent brain**
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
