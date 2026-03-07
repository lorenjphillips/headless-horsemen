import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ActionStep, ActionLogEntry, DemoOptions } from "./types.js";
import { createBrowserbaseStagehand } from "./stagehand.js";

const DEFAULT_OUTPUT_DIR = path.resolve("output");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ExecutorOptions {
  outputDir?: string;
  demoOptions?: DemoOptions;
  onProgress?: (currentStep: number, totalSteps: number, label: string, done?: boolean) => void;
}

export async function executeActionPlan(
  steps: ActionStep[],
  options?: ExecutorOptions
): Promise<{ videoPath: string; actionLog: ActionLogEntry[] }> {
  const OUTPUT_DIR = options?.outputDir ?? DEFAULT_OUTPUT_DIR;
  const FRAMES_DIR = path.join(OUTPUT_DIR, "frames");
  const demoOpts = options?.demoOptions ?? {};

  // Video quality settings
  const qualityMap = {
    low:    { bitrate: "2M", targetFpsOverride: 30 },
    medium: { bitrate: "4M", targetFpsOverride: 30 },
    high:   { bitrate: "6M", targetFpsOverride: 60 },
  };
  const quality = qualityMap[demoOpts.videoQuality ?? "medium"];

  // Speed multiplier for sleep durations
  const speedMultiplier = demoOpts.speed === "fast" ? 0.5 : demoOpts.speed === "slow" ? 1.5 : 1;

  // Viewport
  const viewport = demoOpts.viewport ?? { width: 1280, height: 720 };

  // Log future features
  if (demoOpts.subtitles) console.log("[executor] TODO: subtitles enabled (not yet implemented)");

  // Resolve music track path
  const musicTrack = demoOpts.backgroundMusic
    ? path.resolve("public", "music", `${demoOpts.backgroundMusic}.mp3`)
    : null;
  if (musicTrack) {
    if (fs.existsSync(musicTrack)) {
      console.log(`[executor] Background music: ${demoOpts.backgroundMusic}`);
    } else {
      console.log(`[executor] Warning: music file not found: ${musicTrack}`);
    }
  }

  // Prepare output directories
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  for (const f of fs.readdirSync(FRAMES_DIR)) {
    fs.unlinkSync(path.join(FRAMES_DIR, f));
  }

  console.log("[executor] Initializing Stagehand with Browserbase...");

  const stagehand = createBrowserbaseStagehand({
    width: viewport.width,
    height: viewport.height,
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
        const buf = await page.screenshot({ type: "jpeg", quality: 50 });
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
          await sleep(3000 * speedMultiplier);
          break;
        case "act":
          await stagehand.act(step.instruction);
          await sleep(2500 * speedMultiplier);
          break;
        case "scroll": {
          const px = step.pixels ?? 400;
          const dir = step.direction === "up" ? -px : px;
          await page.evaluate(
            (scrollY: number) =>
              window.scrollBy({ top: scrollY, behavior: "smooth" }),
            dir
          );
          await sleep(1000 * speedMultiplier);
          break;
        }
        case "wait":
          await sleep(step.seconds * 1000 * speedMultiplier);
          break;
      }

      actionLog.push({ step: i, action: step, timestamp_ms, success: true });
      options?.onProgress?.(i, steps.length, stepLabel, true);
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
      options?.onProgress?.(i, steps.length, stepLabel, true);
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
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const videoPath = path.join(OUTPUT_DIR, `demo-${timestamp}.mp4`);
  if (frameCount > 0) {
    const captureDuration = (Date.now() - captureStart) / 1000;
    const actualFps = Math.max(1, Math.round(frameCount / captureDuration));
    console.log(
      `[executor] Capture stats: ${frameCount} frames in ${captureDuration.toFixed(1)}s = ${actualFps} raw fps`
    );
    const targetFps = actualFps < 5 ? 30 : quality.targetFpsOverride;
    console.log(
      `[executor] Encoding video (interpolating to ${targetFps}fps)...`
    );
    try {
      execSync(
        `ffmpeg -y -framerate ${actualFps} -i "${FRAMES_DIR}/frame_%05d.jpg" ` +
          `-vf "minterpolate=fps=${targetFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" ` +
          `-c:v libx264 -pix_fmt yuv420p -b:v ${quality.bitrate} "${videoPath}"`,
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
            `-vf "fps=${targetFps}" ` +
            `-c:v libx264 -pix_fmt yuv420p -b:v ${quality.bitrate} "${videoPath}"`,
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

  // Mix in background music (looped, faded) if requested
  if (musicTrack && fs.existsSync(musicTrack) && fs.existsSync(videoPath)) {
    const withMusicPath = path.join(OUTPUT_DIR, "demo_music.mp4");
    console.log("[executor] Mixing background music (looped)...");
    try {
      execSync(
        `ffmpeg -y -i "${videoPath}" -stream_loop -1 -i "${musicTrack}" ` +
          `-filter_complex "[1:a]volume=0.3,afade=t=out:st=0:d=3[music];[music]apad[m];[m]atrim=0:duration=999[trimmed]" ` +
          `-map 0:v -map "[trimmed]" -c:v copy -c:a aac -b:a 128k -shortest "${withMusicPath}"`,
        { stdio: "pipe", timeout: 120000 }
      );
      // Replace original with music version
      fs.renameSync(withMusicPath, videoPath);
      console.log("[executor] Background music mixed successfully.");
    } catch (err: any) {
      console.error("[executor] Music mixing failed:", err.stderr?.toString().slice(-300) || err.message);
      // Keep the video without music
    }
  }

  return { videoPath, actionLog };
}
