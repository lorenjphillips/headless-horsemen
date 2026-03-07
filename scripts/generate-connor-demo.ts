import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OUTPUT_DIR = path.resolve("output/connor-demo");
const FRAMES_DIR = path.join(OUTPUT_DIR, "frames");
const FINAL_PATH = path.resolve("output/connor-director.mp4");

// --------------- Cursor SVGs (from teammate's editing branch) ---------------

const CURSOR_SVGS = {
  default: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30" fill="none"><path d="M2.2 1.5L2.18 27.2L8.44 18.58L14.02 28.08L18.02 26.08L12.44 16.56H20.5L2.2 1.5Z" fill="black"/><path d="M2.2 1.5L2.18 27.2L8.44 18.58L14.02 28.08L18.02 26.08L12.44 16.56H20.5L2.2 1.5Z" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  pointer: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 24 30" fill="none"><path d="M8.2 2C6.98 2 6 2.98 6 4.2V13H4.4C2.8 13 1.5 14.3 1.5 15.9C1.5 16.28 1.58 16.66 1.76 17L6.56 26.4C7.04 27.34 8 27.94 9.06 27.94H17.02C18.4 27.94 19.56 26.96 19.8 25.6L20.46 21.72L22.1 22.32C23.36 22.78 24.76 22.14 25.22 20.9C25.68 19.64 25.04 18.24 23.8 17.78L18.92 15.96L17.62 8.38C17.36 6.88 16.08 5.8 14.56 5.8C13.72 5.8 12.96 6.16 12.4 6.76V4.68C12.4 3.18 11.18 1.96 9.68 1.96C9.14 1.96 8.64 2.12 8.2 2Z" fill="black"/><path d="M8.2 2C6.98 2 6 2.98 6 4.2V13H4.4C2.8 13 1.5 14.3 1.5 15.9C1.5 16.28 1.58 16.66 1.76 17L6.56 26.4C7.04 27.34 8 27.94 9.06 27.94H17.02C18.4 27.94 19.56 26.96 19.8 25.6L20.46 21.72L22.1 22.32C23.36 22.78 24.76 22.14 25.22 20.9C25.68 19.64 25.04 18.24 23.8 17.78L18.92 15.96L17.62 8.38C17.36 6.88 16.08 5.8 14.56 5.8C13.72 5.8 12.96 6.16 12.4 6.76V4.68C12.4 3.18 11.18 1.96 9.68 1.96C9.14 1.96 8.64 2.12 8.2 2Z" stroke="white" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
};

// --------------- Demo step types ---------------

type DemoStep =
  | { type: "goto"; url: string; waitAfter: number }
  | { type: "act"; instruction: string; waitAfter: number }
  | { type: "scroll"; direction: "down" | "up"; pixels?: number; waitAfter: number }
  | { type: "wait"; seconds: number }
  | { type: "narrate"; text: string; waitAfter: number };

// --------------- The demo sequence ---------------
// After clicking gas price suggestion, Director streams ~15s of content generation.
// We wait 15s to capture that flow.

const DEMO_STEPS: DemoStep[] = [
  { type: "goto", url: "https://www.director.ai/", waitAfter: 4000 },
  {
    type: "narrate",
    text: "Hey everyone, I'm Connor from Browserbase, and today I'm introducing Director. Director lets you control an AI browser agent, just by telling it what to do.",
    waitAfter: 0,
  },
  { type: "act", instruction: "click on the text input bar", waitAfter: 2000 },
  {
    type: "narrate",
    text: "You can explain your browser automation in natural language.",
    waitAfter: 2000,
  },
  {
    type: "narrate",
    text: "Today let's use one of the suggestions to get the average gas prices along a truck route.",
    waitAfter: 0,
  },
  {
    type: "act",
    instruction: "click the 'Average gas price along my truck route' suggestion",
    waitAfter: 15000, // Director streams content for ~15s
  },
  { type: "scroll", direction: "down", pixels: 600, waitAfter: 2000 },
  {
    type: "narrate",
    text: "We have a customer who runs a dairy company, and they use Director to automate checking gas prices along their delivery routes every single day.",
    waitAfter: 0,
  },
  { type: "act", instruction: "click the 'Code and Files' button", waitAfter: 2000 },
  {
    type: "narrate",
    text: "We can view all the generated Stagehand code that Director created to automate this task.",
    waitAfter: 0,
  },
  { type: "act", instruction: "click the copy button", waitAfter: 1000 },
  { type: "act", instruction: "click the 'Run on Browserbase' button", waitAfter: 2000 },
  {
    type: "narrate",
    text: "I can't wait to see what you guys build with Director.",
    waitAfter: 2000,
  },
];

// --------------- Cursor injection ---------------

async function injectCursor(page: any) {
  await page.evaluate((svgs: Record<string, string>) => {
    // Create cursor overlay element
    const cursor = document.createElement("div");
    cursor.id = "__demo_cursor";
    cursor.innerHTML = svgs.default;
    Object.assign(cursor.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      pointerEvents: "none",
      zIndex: "999999",
      transform: "translate(-100px, -100px)", // start offscreen
      transition: "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
      filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.38))",
    });
    document.body.appendChild(cursor);

    // Create click pulse element
    const pulse = document.createElement("div");
    pulse.id = "__demo_pulse";
    Object.assign(pulse.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "34px",
      height: "34px",
      borderRadius: "999px",
      border: "2px solid rgba(255,255,255,0.92)",
      pointerEvents: "none",
      opacity: "0",
      zIndex: "999998",
      transform: "translate(-100px, -100px)",
    });
    document.body.appendChild(pulse);

    // Store SVGs for switching
    (window as any).__cursorSvgs = svgs;
  }, CURSOR_SVGS);
}

async function moveCursorTo(page: any, x: number, y: number, click: boolean = false) {
  await page.evaluate(({ x, y, click, pointerSvg }: { x: number; y: number; click: boolean; pointerSvg: string }) => {
    const cursor = document.getElementById("__demo_cursor");
    const pulse = document.getElementById("__demo_pulse");
    if (!cursor) return;

    // Switch to pointer cursor when about to click
    if (click) {
      cursor.innerHTML = pointerSvg;
    }

    cursor.style.transform = `translate(${x}px, ${y}px)`;

    if (click && pulse) {
      // Trigger click pulse animation
      setTimeout(() => {
        pulse.style.transition = "none";
        pulse.style.opacity = "0.9";
        pulse.style.transform = `translate(${x - 17}px, ${y - 17}px) scale(0.5)`;

        requestAnimationFrame(() => {
          pulse.style.transition = "all 0.4s ease-out";
          pulse.style.opacity = "0";
          pulse.style.transform = `translate(${x - 17}px, ${y - 17}px) scale(1.8)`;
        });
      }, 350); // pulse appears after cursor arrives
    }
  }, { x, y, click, pointerSvg: CURSOR_SVGS.pointer });
}

async function moveCursorToElement(page: any, stagehand: any, instruction: string) {
  // Use observe() to find the element location before acting
  try {
    const observations = await stagehand.observe(instruction);
    if (observations && observations.length > 0) {
      const obs = observations[0];
      // Try to get bounding box from the selector
      if (obs.selector) {
        const box = await page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }, obs.selector);

        if (box) {
          await moveCursorTo(page, box.x, box.y, true);
          await sleep(500); // let cursor animate to target
          return;
        }
      }
    }
  } catch (err: any) {
    console.log(`[cursor] observe() failed, proceeding without cursor animation: ${err.message}`);
  }
}

async function resetCursorToDefault(page: any) {
  await page.evaluate((defaultSvg: string) => {
    const cursor = document.getElementById("__demo_cursor");
    if (cursor) cursor.innerHTML = defaultSvg;
  }, CURSOR_SVGS.default);
}

// --------------- TTS helpers ---------------

function writeWavHeader(pcmData: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

async function generateTTS(ai: GoogleGenAI, text: string, outputPath: string): Promise<boolean> {
  console.log(`[tts] Generating: "${text.slice(0, 60)}..."`);
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Puck" },
          },
        },
      },
    });

    const audioData = (response as any).candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      console.warn("[tts] No audio data returned, skipping clip");
      return false;
    }

    const pcmBuffer = Buffer.from(audioData, "base64");
    const wavBuffer = writeWavHeader(pcmBuffer, 24000, 1, 16);
    fs.writeFileSync(outputPath, wavBuffer);
    console.log(`[tts] Saved: ${path.basename(outputPath)} (${(wavBuffer.length / 1024).toFixed(1)} KB)`);
    return true;
  } catch (err: any) {
    console.warn(`[tts] Failed: ${err.message}`);
    return false;
  }
}

// --------------- Main ---------------

async function main() {
  console.log("===========================================");
  console.log("  Connor's Director Demo — Video Generator");
  console.log("===========================================\n");

  // Prepare directories
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  for (const f of fs.readdirSync(FRAMES_DIR)) {
    fs.unlinkSync(path.join(FRAMES_DIR, f));
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Init Stagehand — 1920x1080 viewport for full page visibility
  console.log("[demo] Initializing Stagehand with Browserbase (1920x1080)...");
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
        viewport: { width: 1920, height: 1080 },
      },
    },
  });

  await stagehand.init();
  console.log("[demo] Browserbase session:", stagehand.browserbaseSessionId);
  const page = stagehand.context.pages()[0];

  // Inject cursor overlay into the page
  await injectCursor(page);
  console.log("[demo] Cursor overlay injected");

  // Start background screenshot capture
  let frameCount = 0;
  let capturing = true;
  const captureStart = Date.now();

  const capturePromise = (async () => {
    while (capturing) {
      const t0 = Date.now();
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 50 });
        const f = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, "0")}.jpg`);
        fs.writeFileSync(f, buf);
        frameCount++;
      } catch {}
      const elapsed = Date.now() - t0;
      if (elapsed < 33) await sleep(33 - elapsed); // cap ~30fps
    }
  })();

  // Execute demo steps
  const narrationClips: { index: number; timestamp_ms: number; path: string }[] = [];
  let narrationIndex = 0;
  const startTime = Date.now();

  for (let i = 0; i < DEMO_STEPS.length; i++) {
    const step = DEMO_STEPS[i];
    const timestamp_ms = Date.now() - startTime;

    switch (step.type) {
      case "goto":
        console.log(`\n[demo] Step ${i + 1}/${DEMO_STEPS.length}: goto ${step.url}`);
        await page.goto(step.url, { waitUntil: "domcontentloaded" });
        // Re-inject cursor after navigation
        await sleep(1000);
        await injectCursor(page);
        if (step.waitAfter > 0) await sleep(step.waitAfter - 1000);
        break;

      case "act":
        console.log(`\n[demo] Step ${i + 1}/${DEMO_STEPS.length}: act → "${step.instruction}"`);
        // Move cursor to target before clicking
        await moveCursorToElement(page, stagehand, step.instruction);
        try {
          await stagehand.act(step.instruction);
          console.log("[demo]   ✓ Success");
        } catch (err: any) {
          console.warn(`[demo]   ✗ act() failed: ${err.message}`);
        }
        // Reset cursor to default arrow after click
        await resetCursorToDefault(page);
        if (step.waitAfter > 0) await sleep(step.waitAfter);
        break;

      case "scroll": {
        const px = step.pixels ?? 400;
        console.log(`\n[demo] Step ${i + 1}/${DEMO_STEPS.length}: scroll ${step.direction} ${px}px`);
        const dir = step.direction === "up" ? -px : px;
        await page.evaluate(
          (scrollY: number) => window.scrollBy({ top: scrollY, behavior: "smooth" }),
          dir
        );
        if (step.waitAfter > 0) await sleep(step.waitAfter);
        break;
      }

      case "wait":
        console.log(`\n[demo] Step ${i + 1}/${DEMO_STEPS.length}: wait ${step.seconds}s`);
        await sleep(step.seconds * 1000);
        break;

      case "narrate": {
        console.log(`\n[demo] Step ${i + 1}/${DEMO_STEPS.length}: narrate`);
        const clipPath = path.join(OUTPUT_DIR, `narration_${narrationIndex}.wav`);
        const ok = await generateTTS(ai, step.text, clipPath);
        if (ok) {
          narrationClips.push({ index: narrationIndex, timestamp_ms, path: clipPath });
        }
        narrationIndex++;
        if (step.waitAfter > 0) await sleep(step.waitAfter);
        break;
      }
    }
  }

  // Stop capture
  capturing = false;
  await capturePromise;

  console.log("\n[demo] Closing browser...");
  await stagehand.close();

  const captureDuration = (Date.now() - captureStart) / 1000;
  const actualFps = Math.max(1, Math.round(frameCount / captureDuration));
  console.log(`[demo] Captured ${frameCount} frames in ${captureDuration.toFixed(1)}s (${actualFps} raw fps)`);

  if (frameCount === 0) {
    console.error("[demo] No frames captured — exiting.");
    process.exit(1);
  }

  // --------------- FFmpeg: stitch frames → video ---------------

  const rawVideoPath = path.join(OUTPUT_DIR, "raw.mp4");
  console.log("\n[demo] Encoding video (interpolating to 30fps)...");

  try {
    execSync(
      `ffmpeg -y -framerate ${actualFps} -i "${FRAMES_DIR}/frame_%05d.jpg" ` +
        `-vf "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" ` +
        `-c:v libx264 -pix_fmt yuv420p -b:v 4M "${rawVideoPath}"`,
      { stdio: "pipe", timeout: 300000 }
    );
  } catch {
    console.log("[demo] minterpolate failed, falling back to simple encoding...");
    execSync(
      `ffmpeg -y -framerate ${actualFps} -i "${FRAMES_DIR}/frame_%05d.jpg" ` +
        `-vf "fps=30" -c:v libx264 -pix_fmt yuv420p -b:v 4M "${rawVideoPath}"`,
      { stdio: "pipe", timeout: 120000 }
    );
  }

  const rawStats = fs.statSync(rawVideoPath);
  console.log(`[demo] Raw video: ${(rawStats.size / 1024 / 1024).toFixed(2)} MB`);

  // --------------- FFmpeg: mix in narration audio ---------------

  if (narrationClips.length > 0) {
    console.log(`\n[demo] Mixing ${narrationClips.length} narration clips into video...`);

    const inputArgs = narrationClips.map((c) => `-i "${c.path}"`).join(" ");

    // Build adelay filter to position each clip at its timestamp
    const filterParts = narrationClips.map((c, idx) => {
      const inputIdx = idx + 1; // input 0 is the video
      const delayMs = c.timestamp_ms;
      return `[${inputIdx}]adelay=${delayMs}|${delayMs}[n${idx}]`;
    });

    const mixInputs = narrationClips.map((_, idx) => `[n${idx}]`).join("");
    filterParts.push(`${mixInputs}amix=inputs=${narrationClips.length}:normalize=0[audio]`);

    const filterComplex = filterParts.join(";");

    try {
      execSync(
        `ffmpeg -y -i "${rawVideoPath}" ${inputArgs} ` +
          `-filter_complex "${filterComplex}" ` +
          `-map 0:v -map "[audio]" -c:v copy -c:a aac -b:a 128k -shortest "${FINAL_PATH}"`,
        { stdio: "pipe", timeout: 120000 }
      );
      console.log("[demo] Video + narration mixed successfully!");
    } catch (err: any) {
      console.warn("[demo] Audio mixing failed — using video without narration.");
      console.warn(err.stderr?.toString().slice(-300) || err.message);
      fs.copyFileSync(rawVideoPath, FINAL_PATH);
    }
  } else {
    console.log("\n[demo] No narration clips generated — using video only.");
    fs.copyFileSync(rawVideoPath, FINAL_PATH);
  }

  const finalStats = fs.statSync(FINAL_PATH);
  console.log(`\n==========================================`);
  console.log(`  Done! ${FINAL_PATH}`);
  console.log(`  Size: ${(finalStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`==========================================`);
}

main().catch((err) => {
  console.error("[demo] Fatal error:", err);
  process.exit(1);
});
