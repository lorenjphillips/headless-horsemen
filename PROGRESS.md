# DemoForge — Progress Tracker

## Step 1: Stagehand + screen recording ✅ COMPLETE

**What was built:** `scripts/test-stagehand.ts`
- Connects to Browserbase cloud browser via Stagehand
- Navigates site, clicks elements via `act()` with natural language
- Captures ~5fps screenshots → ffmpeg stitches into `output/demo.webm`

**Key findings:**
- Stagehand v3 uses CDP, NOT Playwright — `recordVideo` unavailable
- Browserbase `recordSession: true` = rrweb DOM data, not video
- Working approach: periodic `page.screenshot()` + ffmpeg
- NotebookLM requires Google auth — used GitHub as public target
- Stagehand model format: `google/gemini-X` prefix required

---

## Step 2: Gemini API research ✅ COMPLETE

**See RESEARCH.md for full details.**

Key takeaways:
- SDK: `@google/genai` (NOT `@google/generative-ai` — deprecated Nov 2025)
- JSON schema-constrained output via `responseMimeType` + `responseSchema`
- `act()` = ONE action per call, describe by element type/label
- Structured output NOT compatible with thinking mode
- `observe()` → `act(action)` pattern = 2-3x faster (no LLM on replay)

---

## Step 3: Gemini 3.1 agentic loop ← NEXT

**Goal:** Gemini 3.1 Pro acts as the brain in a loop — observes page, decides next action, executes via Stagehand, checks result, repeats until done.

### TODO
- [ ] Install `@google/genai` package
- [ ] Upgrade Stagehand model from `google/gemini-2.0-flash` → `google/gemini-2.5-flash`
- [ ] Build `src/agent.ts`:
  - Initialize Stagehand + Browserbase
  - Start background screenshot capture
  - Agent loop:
    1. Screenshot current page
    2. Send to Gemini 3.1 Pro with prompt + action history
    3. Gemini returns `{ action, instruction?, url?, done? }`
    4. Execute via Stagehand `act()` / `page.goto()` / wait
    5. Append to action history
    6. If `done: true` → break
  - Stop capture, ffmpeg stitch → video
  - Save `output/actions.json` (action log for captions later)
- [ ] Build `scripts/test-agent.ts` — end-to-end test
- [ ] Test: "Go to github.com/browserbase/stagehand and star the repository"

### Gemini 3.1 agent response schema
```json
{
  "action": "goto" | "act" | "wait" | "done",
  "url": "string (if goto)",
  "instruction": "string (if act — natural language for Stagehand)",
  "seconds": "number (if wait)",
  "reasoning": "string (why this action)"
}
```

---

## Step 4: Captions + FFmpeg composition — QUEUED

- Send action log + key screenshots to Gemini → timed captions
- FFmpeg burns captions, trims dead time, adds fade in/out
- Output: polished `.mp4`

---

## Step 5 (Stretch): ChromaDB — QUEUED
## Step 6 (Stretch): Lyria music — QUEUED
