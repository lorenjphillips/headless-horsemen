import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ActionStep, ActionLogEntry } from "./types.js";

const DEFAULT_OUTPUT_DIR = path.resolve("output");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ExecutorOptions {
  outputDir?: string;
  onProgress?: (currentStep: number, totalSteps: number, label: string) => void;
}

export async function executeActionPlan(
  steps: ActionStep[],
  options?: ExecutorOptions
): Promise<{ videoPath: string; actionLog: ActionLogEntry[] }> {
  const OUTPUT_DIR = options?.outputDir ?? DEFAULT_OUTPUT_DIR;
  const FRAMES_DIR = path.join(OUTPUT_DIR, "frames");

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

  // Start background screenshot capture — JPEG for speed, no sleep bottleneck
  let frameCount = 0;
  let capturing = true;
  const captureStart = Date.now();
  const capturePromise = (async () => {
    while (capturing) {
      const t0 = Date.now();
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 75 });
        const f = path.join(
          FRAMES_DIR,
          `frame_${String(frameCount).padStart(5, "0")}.jpg`
        );
        fs.writeFileSync(f, buf);
        frameCount++;
      } catch {}
      // Run as fast as the network allows — no artificial sleep
      // Each CDP round-trip is ~80-150ms, so we get ~8-12 raw fps
      const elapsed = Date.now() - t0;
      if (elapsed < 33) await sleep(33 - elapsed); // cap at 30fps max capture
    }
  })();

  // Execute each step
  const actionLog: ActionLogEntry[] = [];
  const startTime = Date.now();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const timestamp_ms = Date.now() - startTime;

    const stepLabel =
      step.action === "goto"
        ? `goto → ${step.url}`
        : step.action === "act"
          ? `act → "${step.instruction}"`
          : step.action === "scroll"
            ? `scroll ${step.direction} ${step.pixels}px`
            : `wait ${step.seconds}s`;

    console.log(`[executor] Step ${i + 1}/${steps.length}: ${stepLabel}`);
    options?.onProgress?.(i, steps.length, stepLabel);

    try {
      switch (step.action) {
        case "goto":
          await page.goto(step.url, { waitUntil: "domcontentloaded" });
          await sleep(3000); // Let viewer see the page load
          break;
        case "act":
          await stagehand.act(step.instruction);
          await sleep(2500); // Let viewer see the action result
          break;
        case "scroll": {
          const px = step.pixels ?? 400;
          const dir = step.direction === "up" ? -px : px;
          await page.evaluate(
            (scrollY: number) =>
              window.scrollBy({ top: scrollY, behavior: "smooth" }),
            dir
          );
          await sleep(1000); // Let the smooth scroll animation finish
          break;
        }
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

  // Stitch frames into video with motion-interpolated 60fps
  const videoPath = path.join(OUTPUT_DIR, "demo.mp4");
  if (frameCount > 0) {
    const captureDuration = (Date.now() - captureStart) / 1000;
    const actualFps = Math.max(1, Math.round(frameCount / captureDuration));
    console.log(
      `[executor] Capture stats: ${frameCount} frames in ${captureDuration.toFixed(1)}s = ${actualFps} raw fps`
    );
    console.log(
      "[executor] Encoding video (interpolating to 60fps)..."
    );
    try {
      execSync(
        `ffmpeg -y -framerate ${actualFps} -i "${FRAMES_DIR}/frame_%05d.jpg" ` +
          `-vf "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" ` +
          `-c:v libx264 -pix_fmt yuv420p -b:v 6M "${videoPath}"`,
        { stdio: "pipe", timeout: 300000 }
      );
      const stats = fs.statSync(videoPath);
      console.log(
        `[executor] Video saved: ${videoPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`
      );
    } catch (err: any) {
      // Fallback: if minterpolate is too slow or fails, do simple frame dup
      console.log(
        "[executor] minterpolate failed, falling back to simple encoding..."
      );
      try {
        execSync(
          `ffmpeg -y -framerate ${actualFps} -i "${FRAMES_DIR}/frame_%05d.jpg" ` +
            `-vf "fps=60" ` +
            `-c:v libx264 -pix_fmt yuv420p -b:v 6M "${videoPath}"`,
          { stdio: "pipe", timeout: 120000 }
        );
        const stats = fs.statSync(videoPath);
        console.log(
          `[executor] Video saved (fallback): ${videoPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`
        );
      } catch (err2: any) {
        console.error(
          "[executor] ffmpeg error:",
          err2.stderr?.toString().slice(-500) || err2.message
        );
      }
    }
  }

  return { videoPath, actionLog };
}
