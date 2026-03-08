<p align="center">
  <img src="public/logo.png" alt="Headless Horsemen" width="120" />
</p>

<h1 align="center">Headless Horsemen &nbsp;|&nbsp; <a href="https://headlesshorsemen.lol">Try it live →</a></h1>

<p align="center">
  <strong>Give it a URL and a task. Get back a polished demo video.</strong>
  <br />
  <em>Prompt → AI navigates website → records everything → outputs a production-ready video with narration and music</em>
</p>

<p align="center">
  <a href="https://headlesshorsemen.lol">Live Demo</a> &nbsp;·&nbsp;
  <a href="#how-it-works">How It Works</a> &nbsp;·&nbsp;
  <a href="#tech-stack">Tech Stack</a> &nbsp;·&nbsp;
  <a href="#issues-we-solved">Issues We Solved</a>
</p>

<table align="center"><tr>
<td align="center"><a href="https://ai.google.dev/"><img src="public/sponsors/gemini.png" alt="Google Gemini" height="30" /></a></td>
<td align="center"><a href="https://www.browserbase.com/"><img src="public/sponsors/browserbase.png" alt="Browserbase" height="30" /></a></td>
<td align="center"><a href="https://www.trychroma.com/"><img src="public/sponsors/chroma.svg" alt="Chroma" height="30" /></a></td>
</tr></table>

---

<h3 align="center">Director Demo</h3>
<p align="center"><em>Impersonating Connor's Browserbase Director launch demo — fully AI-generated</em></p>



https://github.com/user-attachments/assets/ab40607b-0705-43ae-9370-106c5047287c



> Headless Horsemen autonomously recreates a Browserbase Director product demo — navigating the site, walking through features, and generating deployable Stagehand code. Narrated end-to-end by Gemini TTS.

---

## What is this?

A tool that turns a single sentence into a full product demo video. Type *"Go to Notion and create a new page with a heading"* — out comes a polished MP4 with browser automation, AI narration, and background music. No screen recording. No editing. No human touching a browser.

## How It Works

```
 { url: "https://notion.so", task: "Create a page and add a heading" }
                          │
               ┌──────────▼──────────┐
               │  1. GENERATE        │  Gemini 3.1 Pro → JSON action plan
               └──────────┬──────────┘
               ┌──────────▼──────────┐
               │  2. EXECUTE         │  Stagehand + Browserbase → screenshots
               └──────────┬──────────┘
               ┌──────────▼──────────┐
               │  3. NARRATE         │  Gemini 2.5 Flash TTS → voiceover
               └──────────┬──────────┘
               ┌──────────▼──────────┐
               │  4. COMPOSE         │  FFmpeg → 60fps video + captions + music
               └──────────┬──────────┘
                          ▼
                     final.mp4
```

1. **Generate** — Gemini 3.1 Pro produces a structured JSON action plan from your URL + task. One-shot, schema-constrained output.
2. **Execute** — Stagehand runs each step in a Browserbase cloud browser while capturing screenshots at ~15fps.
3. **Narrate** — Gemini 2.5 Flash TTS generates spoken narration for each step.
4. **Compose** — FFmpeg interpolates to 60fps, burns ASS captions, mixes narration + background music, outputs H.264 MP4.

## Tech Stack

Built on sponsor technology from the [Google Gemini API Developer Competition](https://ai.google.dev/competition).

### Gemini

Three Gemini models working together — planning, acting, and speaking.

| Model | Role |
|-------|------|
| **Gemini 3.1 Pro** | Script generation — URL + task → structured action plan |
| **Gemini 2.5 Flash** | Powers Stagehand `act()` / `observe()` for real-time browser control |
| **Gemini 2.5 Flash TTS** | Voice narration for each demo step |
| **`@google/genai` SDK** | Official Gemini TypeScript SDK |

### Stagehand + Browserbase

[**Stagehand**](https://github.com/browserbase/stagehand) — natural language browser automation. `"click the Create button"` → finds the element, clicks it. No selectors, no XPaths.

[**Browserbase**](https://www.browserbase.com/) — cloud Chromium instances. No local Chrome, works anywhere.

### ChromaDB

[**ChromaDB Cloud**](https://www.trychroma.com/) — vector memory for the pipeline. Successful demos get stored as embeddings. New requests query for similar past demos and inject them as few-shot examples into Gemini's prompt. The pipeline gets better with use.

### FFmpeg

All post-production — `minterpolate` for 60fps, ASS subtitle burning, audio mixing, fade transitions. Shell commands from TypeScript, no native bindings.

## Issues We Solved

### Stagehand v3 killed video recording

Stagehand v3 uses CDP directly instead of Playwright — `recordVideo` doesn't work. CDP's `Page.startScreencast` also fails on Browserbase.

**Fix:** Custom recording loop — `page.screenshot()` at ~15fps → FFmpeg stitches into video. Turned out better — full control over frame timing and post-production.

### Stagehand scroll broken with Gemini 2.5 Flash

`scrollTo` returns empty `elementId` with `google/gemini-2.5-flash`, causing silent failures.

**Fix:** Custom `scroll` action type using `window.scrollBy()` via CDP directly.

### Screenshot → video looks choppy

Raw 15fps screenshots look like a slideshow.

**Fix:** FFmpeg `minterpolate` — analyzes motion between frames, generates intermediates to hit 60fps. Looks like a real screen recording.

## Project Structure

```
src/
  generator.ts      Gemini 3.1 → action plan JSON
  executor.ts       Stagehand + screenshots + ffmpeg
  memory.ts         ChromaDB — store & recall demo plans
  server.ts         Express API + UI
  types.ts          Shared types

public/
  index.html        Single-page UI (inline CSS)

demo/
  generate-connor-demo.ts   Director demo with TTS

design/
  api-design.md       API spec + UI mockup
  ffmpeg-research.md  Post-production research
  openapi.yaml        OpenAPI 3.0 spec
```

## Run Locally

```bash
git clone https://github.com/lorenjphillips/headless-horsemen.git
cd headless-horsemen
npm install

# .env — add your keys:
#   GEMINI_API_KEY=
#   BROWSERBASE_API_KEY=
#   BROWSERBASE_PROJECT_ID=
#   CHROMA_API_KEY=

npm start
# → http://localhost:3000
```

Requires FFmpeg (`brew install ffmpeg` on macOS).

## Built By

<table>
  <tr>
    <td align="center">
      <a href="https://www.linkedin.com/in/lorenjphillips/">
        <strong>Loren Phillips</strong>
      </a>
    </td>
    <td align="center">
      <a href="https://www.linkedin.com/in/yonge-bai/">
        <strong>Yonge Bai</strong>
      </a>
    </td>
    <td align="center">
      <strong>Tokens</strong>
      <br />
      <em>(our AI co-founder)</em>
    </td>
  </tr>
</table>

---

<p align="center">
  Built for the <a href="https://ai.google.dev/competition">Google Gemini API Developer Competition 2026</a>
</p>
