import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ActionStep, ActionLogEntry, DemoOptions } from "./types.js";

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

  const subtitlesEnabled = demoOpts.subtitles ?? false;

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
        viewport: { width: viewport.width, height: viewport.height },
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
        throw new Error("Video encoding failed: ffmpeg not available");
      }
    }
  }

  // Burn subtitles if enabled
  if (subtitlesEnabled && actionLog.length > 0 && fs.existsSync(videoPath)) {
    console.log("[executor] Generating subtitles...");
    try {
      // Get video duration
      const durationStr = execSync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
        { encoding: "utf8", timeout: 10000 }
      ).trim();
      const videoDurationMs = parseFloat(durationStr) * 1000;

      // Build ASS file from action log
      const assPath = path.join(OUTPUT_DIR, "captions.ass");
      const assHeader = `[Script Info]
Title: Headless Horsemen Captions
ScriptType: v4.00+
WrapStyle: 0
PlayResX: ${viewport.width}
PlayResY: ${viewport.height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,26,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,2,0,2,40,40,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

      const msToASS = (ms: number): string => {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const cs = Math.floor((ms % 1000) / 10);
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
      };

      let dialogues = "";
      for (let i = 0; i < actionLog.length; i++) {
        const entry = actionLog[i];
        const startMs = entry.timestamp_ms;
        const endMs = actionLog[i + 1]?.timestamp_ms ?? videoDurationMs;
        if (endMs <= startMs) continue;

        let text = "";
        const a = entry.action;
        if (a.action === "goto") text = `Navigating to ${a.url}`;
        else if (a.action === "act") text = a.instruction;
        else if (a.action === "scroll") text = `Scrolling ${a.direction}`;
        else if (a.action === "wait") text = `Waiting ${a.seconds}s...`;
        if (!text) continue;

        dialogues += `Dialogue: 0,${msToASS(startMs)},${msToASS(endMs)},Default,,0,0,0,,${text}\n`;
      }

      fs.writeFileSync(assPath, assHeader + dialogues);
      console.log(`[executor] ASS file written: ${assPath}`);

      // Burn captions + fade in/out
      const fadeDuration = 0.8;
      const fadeOutStart = Math.max(0, parseFloat(durationStr) - fadeDuration);
      const captionedPath = path.join(OUTPUT_DIR, "demo_captioned.mp4");

      execSync(
        `ffmpeg -y -i "${videoPath}" ` +
          `-vf "ass=${assPath},fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration}" ` +
          `-c:v libx264 -pix_fmt yuv420p -b:v ${quality.bitrate} "${captionedPath}"`,
        { stdio: "pipe", timeout: 300000 }
      );

      // Replace original with captioned version
      fs.renameSync(captionedPath, videoPath);
      console.log("[executor] Subtitles burned successfully.");
    } catch (err: any) {
      console.error("[executor] Subtitle burning failed:", err.stderr?.toString().slice(-300) || err.message);
      // Keep the video without subtitles
    }
  }

  // Mix in background music (crossfade-looped, low volume, faded out) if requested
  if (musicTrack && fs.existsSync(musicTrack) && fs.existsSync(videoPath)) {
    const withMusicPath = path.join(OUTPUT_DIR, "demo_music.mp4");
    console.log("[executor] Mixing background music (crossfade-looped)...");
    try {
      // Get video duration for proper fade-out timing
      const durationStr = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      ).trim();
      const videoDurationSec = Math.floor(parseFloat(durationStr) || 90);
      const fadeOutStart = Math.max(0, videoDurationSec - 4);

      // Get music clip duration for crossfade math
      const clipDurStr = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${musicTrack}"`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      ).trim();
      const clipDur = Math.floor(parseFloat(clipDurStr) || 30);
      const xfade = 3; // crossfade duration in seconds
      const loopOffset = clipDur - xfade;

      // Build crossfade-looped background track: 3 copies blended at seams
      const loopFilterParts = [
        `[0:a]afade=t=out:st=${loopOffset}:d=${xfade}[a0]`,
        `[1:a]afade=t=in:st=0:d=${xfade},afade=t=out:st=${loopOffset}:d=${xfade},adelay=${loopOffset * 1000}|${loopOffset * 1000}[a1]`,
        `[2:a]afade=t=in:st=0:d=${xfade},adelay=${loopOffset * 2 * 1000}|${loopOffset * 2 * 1000}[a2]`,
        `[a0][a1][a2]amix=inputs=3:duration=longest:normalize=0,` +
          `atrim=0:${videoDurationSec + 1},` +
          `afade=t=in:st=0:d=2,afade=t=out:st=${fadeOutStart}:d=3.5,` +
          `volume=0.12[bgloop]`,
      ].join(";");

      // First pass: create the looped background track
      const bgTrackPath = path.join(OUTPUT_DIR, "bg_loop.wav");
      execSync(
        `ffmpeg -y -i "${musicTrack}" -i "${musicTrack}" -i "${musicTrack}" ` +
          `-filter_complex "${loopFilterParts}" -map "[bgloop]" "${bgTrackPath}"`,
        { stdio: "pipe", timeout: 120000 }
      );

      // Second pass: mix background track under the video
      execSync(
        `ffmpeg -y -i "${videoPath}" -i "${bgTrackPath}" ` +
          `-filter_complex "[0:a][1:a]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=${fadeOutStart}:d=3.5[aout]" ` +
          `-map 0:v:0 -map "[aout]" -c:v copy -c:a aac -b:a 192k -movflags +faststart "${withMusicPath}"`,
        { stdio: "pipe", timeout: 120000 }
      );

      fs.unlinkSync(bgTrackPath);
      fs.renameSync(withMusicPath, videoPath);
      console.log("[executor] Background music mixed successfully.");
    } catch (err: any) {
      console.error("[executor] Music mixing failed:", err.stderr?.toString().slice(-300) || err.message);
      // Keep the video without music
    }
  }

  return { videoPath, actionLog };
}
