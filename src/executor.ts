import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ActionStep, ActionLogEntry } from "./types.js";

const OUTPUT_DIR = path.resolve("output");
const FRAMES_DIR = path.join(OUTPUT_DIR, "frames");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function executeActionPlan(
  steps: ActionStep[]
): Promise<{ videoPath: string; actionLog: ActionLogEntry[] }> {
  // Prepare output directories
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  for (const f of fs.readdirSync(FRAMES_DIR)) {
    fs.unlinkSync(path.join(FRAMES_DIR, f));
  }

  console.log("[executor] Initializing Stagehand with Browserbase...");

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    model: {
      modelName: "google/gemini-2.5-flash",
      apiKey: process.env.GEMINI_API_KEY,
    },
    browserbaseSessionCreateParams: {
      browserSettings: {
        recordSession: true,
        viewport: { width: 1280, height: 720 },
      },
    },
  });

  await stagehand.init();
  console.log("[executor] Session ID:", stagehand.browserbaseSessionId);

  const page = stagehand.context.pages()[0];

  // Start background screenshot capture (~15fps)
  let frameCount = 0;
  let capturing = true;
  const capturePromise = (async () => {
    while (capturing) {
      try {
        const buf = await page.screenshot();
        const f = path.join(
          FRAMES_DIR,
          `frame_${String(frameCount).padStart(5, "0")}.png`
        );
        fs.writeFileSync(f, buf);
        frameCount++;
      } catch {}
      await sleep(66); // ~15fps
    }
  })();

  // Execute each step
  const actionLog: ActionLogEntry[] = [];
  const startTime = Date.now();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const timestamp_ms = Date.now() - startTime;

    console.log(
      `[executor] Step ${i + 1}/${steps.length}: ${step.action}${
        step.action === "goto"
          ? ` → ${step.url}`
          : step.action === "act"
            ? ` → "${step.instruction}"`
            : ` → ${step.seconds}s`
      }`
    );

    try {
      switch (step.action) {
        case "goto":
          await page.goto(step.url, { waitUntil: "domcontentloaded" });
          await sleep(2000); // Wait for page to settle
          break;
        case "act":
          await stagehand.act(step.instruction);
          await sleep(1500); // Wait for action to complete visually
          break;
        case "wait":
          await sleep(step.seconds * 1000);
          break;
      }

      actionLog.push({ step: i, action: step, timestamp_ms, success: true });
      console.log(`[executor]   ✓ Success`);
    } catch (err: any) {
      const errorMsg = err.message || String(err);
      actionLog.push({
        step: i,
        action: step,
        timestamp_ms,
        success: false,
        error: errorMsg,
      });
      console.log(`[executor]   ✗ Failed: ${errorMsg}`);
    }
  }

  // Stop capture and close browser
  capturing = false;
  await capturePromise;

  console.log("[executor] Closing browser...");
  await stagehand.close();
  console.log(`[executor] Captured ${frameCount} frames.`);

  // Save action log
  const actionLogPath = path.join(OUTPUT_DIR, "actions.json");
  fs.writeFileSync(actionLogPath, JSON.stringify(actionLog, null, 2));
  console.log(`[executor] Action log saved: ${actionLogPath}`);

  // Stitch frames into video
  const videoPath = path.join(OUTPUT_DIR, "demo.webm");
  if (frameCount > 0) {
    console.log("[executor] Encoding video...");
    try {
      execSync(
        `ffmpeg -y -framerate 15 -i "${FRAMES_DIR}/frame_%05d.png" -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 4M "${videoPath}"`,
        { stdio: "pipe" }
      );
      const stats = fs.statSync(videoPath);
      console.log(
        `[executor] Video saved: ${videoPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`
      );
    } catch (err: any) {
      console.error(
        "[executor] ffmpeg error:",
        err.stderr?.toString().slice(-500) || err.message
      );
    }
  }

  return { videoPath, actionLog };
}
