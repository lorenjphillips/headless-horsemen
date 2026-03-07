# Headless Horsemen -- API, UI, and Deployment Design

## Table of Contents
1. [API Design](#1-api-design)
2. [Simple UI](#2-simple-ui-hackathon-level)
3. [Deployment](#3-deployment)
4. [OpenAPI Spec](#4-openapi-30-spec)
5. [Decisions Needed](#5-decisions-needed)

---

## 1. API Design

### Core Endpoints

The pipeline takes 30-60 seconds. This rules out synchronous request/response -- we need an
async job model. The client submits a request, gets back a job ID, and polls (or streams)
for status.

```
POST /demos              Submit a demo request, returns job ID
GET  /demos/:id          Poll job status + get result
GET  /demos/:id/plan     View the generated action plan (available before execution finishes)
GET  /demos/:id/events   SSE stream of real-time progress (optional, stretch)
```

### Request / Response Shapes

These are based on the existing types in `src/types.ts`.

#### POST /demos

```json
// Request
{
  "siteUrl": "https://github.com/browserbase/stagehand",
  "demoTask": "Star the repository and view the README"
}

// Response (201 Created)
{
  "id": "demo_abc123",
  "status": "planning",
  "createdAt": "2026-03-07T12:00:00Z"
}
```

#### GET /demos/:id

```json
// Response -- while running
{
  "id": "demo_abc123",
  "status": "executing",          // planning | executing | composing | done | failed
  "siteUrl": "https://github.com/browserbase/stagehand",
  "demoTask": "Star the repository and view the README",
  "plan": [ ... ],                // ActionStep[] -- available once planning finishes
  "progress": {
    "currentStep": 3,
    "totalSteps": 6,
    "currentAction": "click the 'Star' button"
  },
  "createdAt": "2026-03-07T12:00:00Z",
  "updatedAt": "2026-03-07T12:00:15Z"
}

// Response -- when done
{
  "id": "demo_abc123",
  "status": "done",
  "siteUrl": "https://github.com/browserbase/stagehand",
  "demoTask": "Star the repository and view the README",
  "plan": [ ... ],
  "actionLog": [ ... ],           // ActionLogEntry[] -- full execution log
  "videoUrl": "/demos/demo_abc123/video",
  "durationMs": 42000,
  "createdAt": "2026-03-07T12:00:00Z",
  "completedAt": "2026-03-07T12:00:42Z"
}
```

#### GET /demos/:id/plan

Returns just the action plan, available as soon as Gemini finishes generating it (before
execution starts). Useful for the UI to show a step-by-step preview.

```json
{
  "id": "demo_abc123",
  "status": "executing",
  "plan": [
    { "action": "goto", "url": "https://github.com/browserbase/stagehand" },
    { "action": "wait", "seconds": 2 },
    { "action": "act", "instruction": "click the 'Star' button" },
    { "action": "wait", "seconds": 1 },
    { "action": "act", "instruction": "scroll down to the README section" },
    { "action": "wait", "seconds": 2 }
  ]
}
```

#### GET /demos/:id/video

Returns the raw video file (`Content-Type: video/webm`).

### Async Pattern: Polling vs SSE

**Recommendation: Polling first, SSE as stretch.**

| Approach | Pros | Cons |
|----------|------|------|
| **Polling** (GET every 2s) | Dead simple, works everywhere, stateless | Slightly delayed updates, extra requests |
| **SSE** (EventSource) | Real-time step updates, feels polished | Requires keeping connection open, more server complexity |
| **WebSocket** | Bi-directional (not needed) | Overkill, hardest to deploy |

For the hackathon, polling every 2 seconds is perfectly fine. The job takes 30-60s, so the
client makes 15-30 GET requests total -- negligible. If we want the fancy step-by-step
progress feel, SSE is the upgrade path but not needed for the demo.

### Job Storage

For the hackathon, an in-memory `Map<string, DemoJob>` is sufficient. No database needed.
Jobs and videos are lost on server restart, which is fine for a demo.

For a real product, you would use Redis or Postgres for job state and S3 for video storage.

---

## 2. Simple UI (Hackathon-Level)

### Framework Choice

**Recommendation: Single static HTML file. No build step. No framework.**

| Option | Verdict |
|--------|---------|
| **Single HTML file** (vanilla JS + fetch) | BEST for hackathon. Zero setup, serve from Express static. |
| Next.js | Way too much for a hackathon demo. Pages, routing, build step, RSC. |
| Vite + React | Still needs `npm create`, build pipeline, etc. |
| htmx | Interesting but team might not know it. |

A single `public/index.html` with inline CSS and vanilla JS is the fastest path. The
Express server serves it as a static file. The entire UI is one file, under 200 lines.

### Competitive Reference

- **Arcade.software**: Full-featured editor with voiceovers, branching, pan/zoom. Way
  beyond hackathon scope. But the core insight is: simple input -> show progress -> deliver
  video.
- **Browserbase Open Operator**: Next.js app with a chat-style input. User types a task,
  watches the agent browse. Clean, minimal UI -- good inspiration for the "watch it work"
  feel.
- **Loom**: Record -> process -> share link. The output-as-URL pattern is relevant.

### UI Layout (ASCII Mockup)

```
+------------------------------------------------------------------+
|                                                                  |
|   Headless Horsemen                                        [hackathon]   |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|   +----------------------------------------------------------+  |
|   |  Website URL                                              |  |
|   |  [ https://github.com/browserbase/stagehand           ]  |  |
|   +----------------------------------------------------------+  |
|                                                                  |
|   +----------------------------------------------------------+  |
|   |  What should the demo show?                               |  |
|   |  [ Star the repository and view the README            ]  |  |
|   +----------------------------------------------------------+  |
|                                                                  |
|   [ Generate Demo ]                                              |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|   Status: Executing step 3 of 6...                               |
|   [=============>                        ] 50%                   |
|                                                                  |
|   Action Plan:                                                   |
|   +----------------------------------------------------------+  |
|   |  [x] 1. Navigate to URL                                  |  |
|   |  [x] 2. Wait 2 seconds                                   |  |
|   |  [>] 3. Click the 'Star' button          <-- current     |  |
|   |  [ ] 4. Wait 1 second                                    |  |
|   |  [ ] 5. Scroll down to the README                        |  |
|   |  [ ] 6. Wait 2 seconds                                   |  |
|   +----------------------------------------------------------+  |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|   +----------------------------------------------------------+  |
|   |                                                          |  |
|   |              [  VIDEO PLAYER  ]                          |  |
|   |                                                          |  |
|   |              demo.webm - 0.10 MB                         |  |
|   |                                                          |  |
|   +----------------------------------------------------------+  |
|                                                                  |
|   [ Download Video ]                                             |
|                                                                  |
+------------------------------------------------------------------+
```

### UI States

The page has three visual states, all in the same single page:

1. **Input** (initial): Show the form. "Generate Demo" button is enabled.
2. **Processing**: Form is disabled. Progress bar animates. Action plan appears with
   checkmarks as steps complete. Status text updates on each poll.
3. **Done**: Video player appears with the result. Download button. "Generate Another"
   resets the form.
4. **Error**: Red banner with error message. "Try Again" button.

### User Flow

```
1. User fills in URL + task
2. Click "Generate Demo"
3. POST /demos -> get job ID
4. Poll GET /demos/:id every 2 seconds
5. As soon as plan is available, render the step list
6. Update progress bar + checkmarks as steps complete
7. When status === "done", show video player with videoUrl as src
8. User watches / downloads
```

### Key UI Details

- The action plan step list is the killer feature of the UI. Showing the AI-generated plan
  with live progress makes the 30-60s wait feel interactive and transparent. Without it, the
  user just stares at a spinner.
- Video player: use a plain `<video>` element with `controls`. WebM plays natively in
  Chrome/Firefox. For Safari compatibility, the composer step should output MP4 (future).
- No auth needed for hackathon. Anyone can submit demos.
- Mobile-responsive: use `max-width: 600px; margin: 0 auto` on the container. Enough.

---

## 3. Deployment

### Option Comparison

| Option | Setup Time | Cost | Long Jobs (60s) | Cold Start | Verdict |
|--------|-----------|------|-----------------|------------|---------|
| **Railway** | 5 min | Free tier, then $5/mo | No timeout issues | Warm always | BEST |
| Fly.io | 10-15 min | Free tier | No timeout issues | Warm always | Good, more config |
| Render | 5 min | Free tier (spins down) | No timeout issues | 30-50s cold start on free | OK |
| AWS Lambda + API GW | 30-60 min | Pay per invoke | 15min timeout (fine) | Cold starts, needs layers | OVERKILL |
| Vercel | 5 min | Serverless (10s timeout!) | DOES NOT WORK | N/A | NO |

### Recommendation: Railway

**Why Railway wins for this hackathon:**

1. **Zero config**: `railway up` from the repo root. It detects Node.js, runs `npm start`.
   Done in under 5 minutes.
2. **Always warm**: Unlike Render's free tier (which sleeps after 15 min of inactivity),
   Railway keeps your service running. No cold start when a judge hits the demo.
3. **No timeout**: It is a regular server process. Your 30-60s pipeline runs without any
   timeout concerns. Lambda would work (15min timeout) but adds needless complexity.
4. **Free tier**: $5/month credit, more than enough for a hackathon.
5. **Environment variables**: Set `GEMINI_API_KEY`, `BROWSERBASE_API_KEY`,
   `BROWSERBASE_PROJECT_ID` in the Railway dashboard. Done.
6. **Custom domain**: Railway gives you a `*.up.railway.app` URL automatically.

**Why NOT Lambda/API Gateway:**
- You need to set up IAM roles, API Gateway, Lambda layers for ffmpeg, S3 for videos,
  SQS if you want async. That is 2-4 hours of infra work for the same result.
- Lambda cold starts with ffmpeg bundled would be rough.
- The async pattern requires either Step Functions or SQS + another Lambda -- way too much
  plumbing for a hackathon.

**Why NOT Vercel:**
- Serverless functions have a 10-second timeout on the free tier, 60s on Pro. The pipeline
  takes 30-60s. This will not work reliably.

### Deployment Architecture

```
Railway (single Express server)
  |
  +-- POST /demos        -> spawns pipeline in background
  +-- GET /demos/:id     -> returns job status from in-memory Map
  +-- GET /demos/:id/video -> streams video file from disk
  +-- GET /               -> serves public/index.html
  |
  +-- /output/            -> temporary video files on disk
```

### Video Storage

For the hackathon, store videos on disk in the server's `/output` directory and serve them
directly. Railway gives you ephemeral disk (lost on redeploy), which is fine.

For production, you would upload to S3/R2 and return a signed URL. But for the hackathon,
direct file serving is simpler and eliminates an entire AWS integration.

### Server Setup

The Express server needs:
- `express.static("public")` to serve the HTML UI
- `express.json()` for POST body parsing
- A `Map<string, DemoJob>` for job state
- CORS headers if the UI is served from a different origin (probably not needed if same server)

Estimated lines of code for the server: ~100-150 in a single `src/server.ts` file.

### What You Need to Install

```bash
npm install express
npm install -D @types/express
```

That is it. No Redis, no SQS, no S3, no database.

---

## 4. OpenAPI 3.0 Spec

```yaml
openapi: 3.0.3
info:
  title: Headless Horsemen API
  description: >
    Generate polished demo videos from a website URL and task description.
    An AI agent navigates the site, records browser actions, and outputs video.
  version: 0.1.0

servers:
  - url: http://localhost:3000
    description: Local development
  - url: https://headlesshorsemen.lol
    description: Railway deployment

paths:
  /demos:
    post:
      summary: Submit a demo generation request
      description: >
        Accepts a website URL and task description. Returns a job ID immediately.
        The demo is generated asynchronously -- poll GET /demos/:id for status.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/DemoRequest"
            example:
              siteUrl: "https://github.com/browserbase/stagehand"
              demoTask: "Star the repository and view the README"
      responses:
        "201":
          description: Demo job created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DemoJobCreated"
        "400":
          description: Invalid request (missing siteUrl or demoTask)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"

  /demos/{id}:
    get:
      summary: Get demo job status and result
      description: >
        Poll this endpoint to check the status of a demo generation job.
        When status is "done", the response includes a videoUrl.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
          example: demo_abc123
      responses:
        "200":
          description: Demo job status
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DemoJob"
        "404":
          description: Demo job not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"

  /demos/{id}/plan:
    get:
      summary: Get the generated action plan
      description: >
        Returns the AI-generated action plan for this demo. Available as soon
        as the planning phase completes (before execution finishes).
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Action plan
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DemoPlan"
        "404":
          description: Demo job not found
        "409":
          description: Plan not yet available (still in planning phase)

  /demos/{id}/video:
    get:
      summary: Download the demo video
      description: Returns the generated video file. Only available when status is "done".
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Video file
          content:
            video/webm:
              schema:
                type: string
                format: binary
        "404":
          description: Demo job not found or video not yet ready

components:
  schemas:
    DemoRequest:
      type: object
      required:
        - siteUrl
        - demoTask
      properties:
        siteUrl:
          type: string
          format: uri
          description: The website URL to demo
          example: "https://github.com/browserbase/stagehand"
        demoTask:
          type: string
          description: What the demo should show (natural language)
          example: "Star the repository and view the README"

    DemoJobCreated:
      type: object
      properties:
        id:
          type: string
          description: Unique job identifier
          example: demo_abc123
        status:
          type: string
          enum: [planning]
          example: planning
        createdAt:
          type: string
          format: date-time

    DemoJob:
      type: object
      properties:
        id:
          type: string
          example: demo_abc123
        status:
          type: string
          enum: [planning, executing, composing, done, failed]
          description: >
            planning = Gemini is generating the action plan.
            executing = Stagehand is running the actions in the browser.
            composing = FFmpeg is stitching the video.
            done = Video is ready.
            failed = Something went wrong.
        siteUrl:
          type: string
          format: uri
        demoTask:
          type: string
        plan:
          type: array
          nullable: true
          description: Available once planning is complete
          items:
            $ref: "#/components/schemas/ActionStep"
        actionLog:
          type: array
          nullable: true
          description: Available once execution is complete
          items:
            $ref: "#/components/schemas/ActionLogEntry"
        progress:
          $ref: "#/components/schemas/Progress"
        videoUrl:
          type: string
          nullable: true
          description: URL to download the video (available when status is done)
          example: /demos/demo_abc123/video
        error:
          type: string
          nullable: true
          description: Error message if status is failed
        durationMs:
          type: integer
          nullable: true
          description: Total pipeline duration in milliseconds
        createdAt:
          type: string
          format: date-time
        completedAt:
          type: string
          format: date-time
          nullable: true

    ActionStep:
      type: object
      required:
        - action
      properties:
        action:
          type: string
          enum: [goto, act, wait, scroll]
        url:
          type: string
          nullable: true
          description: Required when action is "goto"
        instruction:
          type: string
          nullable: true
          description: Required when action is "act"
        seconds:
          type: number
          nullable: true
          description: Required when action is "wait"
        direction:
          type: string
          enum: [up, down]
          nullable: true
          description: Required when action is "scroll"
        pixels:
          type: integer
          nullable: true

    ActionLogEntry:
      type: object
      properties:
        step:
          type: integer
          description: 0-indexed step number
        action:
          $ref: "#/components/schemas/ActionStep"
        timestamp_ms:
          type: integer
          description: Milliseconds since execution started
        success:
          type: boolean
        error:
          type: string
          nullable: true

    Progress:
      type: object
      nullable: true
      description: Available during execution phase
      properties:
        currentStep:
          type: integer
        totalSteps:
          type: integer
        currentAction:
          type: string
          description: Human-readable description of the current action

    DemoPlan:
      type: object
      properties:
        id:
          type: string
        status:
          type: string
        plan:
          type: array
          items:
            $ref: "#/components/schemas/ActionStep"

    Error:
      type: object
      properties:
        error:
          type: string
          example: "siteUrl is required"
```

---

## 5. Decisions Needed

These are trade-offs where you should make a call before implementation.

### Decision 1: Polling interval

2 seconds is the sweet spot. 1 second feels aggressive but gives smoother progress. 3
seconds feels laggy. Recommendation: **2 seconds**, with a note that SSE can be added later.

### Decision 2: Video format

The executor currently outputs `.webm` (VP9). This plays in Chrome and Firefox but NOT
Safari. Options:
- **Keep .webm**: Fastest, no changes needed. Safari users are out of luck.
- **Switch to .mp4 (H.264)**: Universal playback. Requires changing the ffmpeg command.
  One-line change: swap `-c:v libvpx-vp9` to `-c:v libx264` and `.webm` to `.mp4`.

Recommendation: **Switch to MP4** before the demo. It is a one-line ffmpeg flag change and
guarantees playback on any browser/device. Judges might use Safari.

### Decision 3: Concurrent jobs

With in-memory state and Browserbase cloud browsers, you could run multiple demos at once.
But each job uses a Browserbase session (and likely has API rate limits). Options:
- **One at a time**: Simple queue. Reject or queue new requests while one is running.
- **Up to N concurrent**: More complex, but better demo if multiple people try it.

Recommendation: **One at a time** for the hackathon. Add a "busy" response if a job is
already running. Keeps things simple.

### Decision 4: Video file cleanup

Videos stored on disk will accumulate. Options:
- **Do nothing**: For a hackathon, disk will not fill up.
- **Delete after 1 hour**: Simple setTimeout cleanup.

Recommendation: **Do nothing.** Railway ephemeral disk handles this -- files are lost on
redeploy anyway.

### Decision 5: Show live browser view?

Browserbase sessions have a live view URL. You could embed it in the UI so users watch the
browser in real-time. This is flashy but adds complexity (iframe embedding, Browserbase
session URL API). Worth investigating as a stretch goal after the core flow works.

---

## Summary: What to Build (in order)

1. **`src/server.ts`** (~100-150 lines)
   - Express server with POST /demos, GET /demos/:id, GET /demos/:id/plan,
     GET /demos/:id/video
   - In-memory job Map
   - Calls existing `generateActionPlan()` and `executeActionPlan()` in background
   - Serves static files from `public/`

2. **`public/index.html`** (~150-200 lines)
   - Single file: HTML + inline CSS + inline JS
   - Form, progress section, video player
   - Polls GET /demos/:id every 2 seconds
   - Renders action plan with step-by-step checkmarks

3. **Deploy to Railway**
   - `railway up`
   - Set env vars in dashboard
   - Share the URL

Estimated total implementation time: **2-3 hours.**
