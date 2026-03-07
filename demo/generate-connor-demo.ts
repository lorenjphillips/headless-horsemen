import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { GoogleGenAI } from "@google/genai";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OUTPUT_DIR = path.resolve("output/connor-demo");
const FRAMES_DIR = path.join(OUTPUT_DIR, "frames");
const RENDERED_DIR = path.join(OUTPUT_DIR, "rendered");
const FINAL_PATH = path.resolve("output/connor-director.mp4");

// --------------- Cursor event tracking ---------------

interface CursorEvent {
  kind: "move" | "click";
  x: number;
  y: number;
  timestampMs: number;
}

const cursorEvents: CursorEvent[] = [];
const frameTimestamps: number[] = []; // ms timestamp for each frame
let recordingStartMs = 0;

// --------------- TTS ---------------

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
  console.log(`[tts] "${text.slice(0, 50)}..."`);
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
      },
    });
    const audioData = (response as any).candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) { console.warn("[tts] No audio data"); return false; }
    const pcm = Buffer.from(audioData, "base64");
    fs.writeFileSync(outputPath, writeWavHeader(pcm, 24000, 1, 16));
    console.log(`[tts] ✓ ${path.basename(outputPath)}`);
    return true;
  } catch (err: any) {
    console.warn(`[tts] ✗ ${err.message}`);
    return false;
  }
}

// --------------- Compositor (Yonge's approach) ---------------
// Post-production: a LOCAL Playwright browser composites cursor SVG onto raw frames.

function buildCompositorHtml(width: number, height: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
*{margin:0;padding:0}
body{width:${width}px;height:${height}px;overflow:hidden;background:#000}
#shot{display:block;width:${width}px;height:${height}px}
#cursor{position:absolute;top:0;left:0;pointer-events:none;z-index:20;will-change:transform}
#cursor svg{display:block;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.4))}
#pulse{position:absolute;top:0;left:0;width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,0.85);pointer-events:none;opacity:0;z-index:10}
</style></head><body>
<img id="shot" alt=""/>
<div id="cursor"></div>
<div id="pulse"></div>
<script>
const cursorSvgs={
  default:'<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 22 30" fill="none"><path d="M2.2 1.5L2.18 27.2L8.44 18.58L14.02 28.08L18.02 26.08L12.44 16.56H20.5L2.2 1.5Z" fill="black"/><path d="M2.2 1.5L2.18 27.2L8.44 18.58L14.02 28.08L18.02 26.08L12.44 16.56H20.5L2.2 1.5Z" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  pointer:'<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 22 30" fill="none"><path d="M2.2 1.5L2.18 27.2L8.44 18.58L14.02 28.08L18.02 26.08L12.44 16.56H20.5L2.2 1.5Z" fill="black"/><path d="M2.2 1.5L2.18 27.2L8.44 18.58L14.02 28.08L18.02 26.08L12.44 16.56H20.5L2.2 1.5Z" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg>'
};
const hotspot={x:2,y:1};
const shot=document.getElementById("shot");
const cursor=document.getElementById("cursor");
const pulse=document.getElementById("pulse");

window.__renderFrame=async function(state){
  if(state.imageDataUrl){
    await new Promise(r=>{
      const done=()=>{shot.removeEventListener("load",done);r()};
      shot.addEventListener("load",done,{once:true});
      shot.src=state.imageDataUrl;
      if(shot.complete){shot.removeEventListener("load",done);r()}
    });
  }
  if(state.cursor.visible){
    cursor.style.display="block";
    cursor.style.transform="translate("+(state.cursor.x-hotspot.x)+"px,"+(state.cursor.y-hotspot.y)+"px)";
    cursor.innerHTML=cursorSvgs[state.cursor.kind]||cursorSvgs.default;
  }else{
    cursor.style.display="none";
  }
  if(state.clickPulse){
    const a=1-state.clickPulse.progress;
    const s=0.55+state.clickPulse.progress*1.6;
    pulse.style.opacity=String(a);
    pulse.style.transform="translate("+(state.clickPulse.x-15)+"px,"+(state.clickPulse.y-15)+"px) scale("+s+")";
  }else{
    pulse.style.opacity="0";
  }
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
};
</script></body></html>`;
}

// Interpolate cursor position at a given timestamp
function getCursorAt(timestampMs: number): { x: number; y: number; visible: boolean; clicking: boolean } {
  if (cursorEvents.length === 0) return { x: -50, y: -50, visible: false, clicking: false };

  // Find the most recent event at or before this timestamp
  let lastEvent: CursorEvent | null = null;
  let nextEvent: CursorEvent | null = null;

  for (let i = 0; i < cursorEvents.length; i++) {
    if (cursorEvents[i].timestampMs <= timestampMs) {
      lastEvent = cursorEvents[i];
    } else {
      nextEvent = cursorEvents[i];
      break;
    }
  }

  if (!lastEvent) return { x: -50, y: -50, visible: false, clicking: false };

  // Check if there's a click event near this timestamp (within 500ms)
  const clicking = cursorEvents.some(
    (e) => e.kind === "click" && Math.abs(e.timestampMs - timestampMs) < 500
  );

  // If we have a next event, interpolate between them
  if (nextEvent && nextEvent.timestampMs - lastEvent.timestampMs < 2000) {
    const progress = (timestampMs - lastEvent.timestampMs) / (nextEvent.timestampMs - lastEvent.timestampMs);
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    return {
      x: lastEvent.x + (nextEvent.x - lastEvent.x) * eased,
      y: lastEvent.y + (nextEvent.y - lastEvent.y) * eased,
      visible: true,
      clicking,
    };
  }

  return { x: lastEvent.x, y: lastEvent.y, visible: true, clicking };
}

async function renderFramesWithCursor(width: number, height: number) {
  console.log("[compositor] Launching local Chrome for cursor overlay...");
  fs.mkdirSync(RENDERED_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height } });

  const html = buildCompositorHtml(width, height);
  const dataUrl = `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
  await page.goto(dataUrl);
  await page.waitForTimeout(200);

  const frameFiles = fs.readdirSync(FRAMES_DIR).filter((f) => f.endsWith(".jpg")).sort();
  console.log(`[compositor] Rendering ${frameFiles.length} frames with cursor overlay...`);

  let lastImageDataUrl = "";

  for (let i = 0; i < frameFiles.length; i++) {
    const framePath = path.join(FRAMES_DIR, frameFiles[i]);
    const frameTs = frameTimestamps[i] ?? 0;

    // Read frame as data URL
    const imgBuf = fs.readFileSync(framePath);
    const imageDataUrl = `data:image/jpeg;base64,${imgBuf.toString("base64")}`;

    const cursor = getCursorAt(frameTs);

    // Only send image if it changed (optimization)
    const sendImage = imageDataUrl !== lastImageDataUrl;
    lastImageDataUrl = imageDataUrl;

    const clickPulse = cursor.clicking
      ? { x: cursor.x, y: cursor.y, progress: 0.3 }
      : null;

    await page.evaluate(
      (state: any) => (window as any).__renderFrame(state),
      {
        imageDataUrl: sendImage ? imageDataUrl : undefined,
        cursor: {
          visible: cursor.visible,
          kind: cursor.clicking ? "pointer" : "default",
          x: cursor.x,
          y: cursor.y,
        },
        clickPulse,
      }
    );

    // Screenshot compositor page = frame with cursor
    const outPath = path.join(RENDERED_DIR, frameFiles[i]);
    await page.screenshot({ path: outPath, type: "jpeg", quality: 80 });

    if ((i + 1) % 50 === 0 || i === frameFiles.length - 1) {
      console.log(`[compositor] ${i + 1}/${frameFiles.length}`);
    }
  }

  await browser.close();
  console.log("[compositor] Done!");
}

// --------------- Main ---------------

async function main() {
  console.log("=============================================");
  console.log("  Connor's Director Demo — Video Generator");
  console.log("=============================================\n");

  // Prepare dirs
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(RENDERED_DIR, { recursive: true });
  for (const f of fs.readdirSync(FRAMES_DIR)) fs.unlinkSync(path.join(FRAMES_DIR, f));
  for (const f of fs.readdirSync(RENDERED_DIR)) fs.unlinkSync(path.join(RENDERED_DIR, f));

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Init Stagehand
  console.log("[demo] Initializing Stagehand...");
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    model: { modelName: "google/gemini-2.5-flash", apiKey: process.env.GEMINI_API_KEY },
    browserbaseSessionCreateParams: {
      browserSettings: { recordSession: true, viewport: { width: 1920, height: 1080 } },
    },
  });

  await stagehand.init();
  console.log("[demo] Session:", stagehand.browserbaseSessionId);
  const page = stagehand.context.pages()[0];

  // Clear cache so Director loads fresh
  await page.sendCDP("Network.enable");
  await page.sendCDP("Network.clearBrowserCache");
  await page.sendCDP("Network.clearBrowserCookies");
  console.log("[demo] Cache cleared\n");

  // Start screenshot capture (~5fps)
  let frameCount = 0;
  let capturing = true;
  recordingStartMs = Date.now();

  const captureLoop = (async () => {
    while (capturing) {
      const t0 = Date.now();
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 50 });
        const fPath = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, "0")}.jpg`);
        fs.writeFileSync(fPath, buf);
        frameTimestamps.push(Date.now() - recordingStartMs);
        frameCount++;
      } catch {}
      const elapsed = Date.now() - t0;
      if (elapsed < 33) await sleep(33 - elapsed); // ~30fps capture
    }
  })();

  // Narration clips
  const clips: { timestamp_ms: number; path: string }[] = [];
  let clipIdx = 0;

  async function narrate(text: string) {
    const ts = Date.now() - recordingStartMs;
    const p = path.join(OUTPUT_DIR, `narration_${clipIdx}.wav`);
    const ok = await generateTTS(ai, text, p);
    if (ok) clips.push({ timestamp_ms: ts, path: p });
    clipIdx++;
  }

  // Get element center for cursor tracking
  async function getElementCenter(searchText: string): Promise<{ x: number; y: number } | null> {
    try {
      return await page.evaluate((text: string) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          if (node.textContent && node.textContent.includes(text)) {
            const el = node.parentElement;
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
          }
        }
        return null;
      }, searchText);
    } catch {
      return null;
    }
  }

  // Act with cursor tracking
  async function actAndTrack(instruction: string, cursorHint?: string) {
    const ts = Date.now() - recordingStartMs;
    // Track cursor position before acting
    if (cursorHint) {
      const pos = await getElementCenter(cursorHint);
      if (pos) {
        cursorEvents.push({ kind: "move", x: pos.x, y: pos.y, timestampMs: ts - 500 });
        cursorEvents.push({ kind: "click", x: pos.x, y: pos.y, timestampMs: ts });
      }
    }
    try {
      await stagehand.act(instruction);
      console.log(`[demo]   ✓ ${instruction}`);
    } catch (err: any) {
      console.warn(`[demo]   ✗ ${instruction}: ${err.message.slice(0, 80)}`);
    }
  }

  // =====================================================================
  //  RECORDING: THE DEMO SEQUENCE
  // =====================================================================

  // 1. Navigate to Director
  console.log("[demo] → Navigate to director.ai");
  await page.goto("https://www.director.ai/", { waitUntil: "domcontentloaded" });
  await sleep(3000);

  // 2. Opening narration
  await narrate("Hey everyone, I'm Connor, an Account Executive at Browserbase. Today we're introducing Director, which lets anyone automate the web using a natural language prompt. You can now generate repeatable web automation code in one single step.");

  // 3. Click text input
  console.log("[demo] → Click text input");
  await actAndTrack("click on the text input bar", "automate");
  await sleep(1500);

  // 4. Narration
  await narrate("With Director you can explain your browser automation in natural language.");
  await narrate("Today let's get the average gas prices along a truck route.");

  // 5. Click the suggestion — triggers LLM generation
  console.log("[demo] → Click gas price suggestion");
  await actAndTrack(
    "click the 'Average gas price along my truck route' suggestion",
    "Average gas price"
  );

  // 6. Watch the generative flow stream for ~15s
  console.log("[demo]   Watching generative flow (15s)...");
  await sleep(15000);

  // 7. Scroll down to see results
  console.log("[demo] → Scroll down");
  await page.evaluate(() => window.scrollBy({ top: 600, behavior: "smooth" }));
  await sleep(2000);

  // 8. Dairy company narration
  await narrate("We have a customer who runs a dairy company who had to manually look through gas prices for all their dairy truck routes. With Director they can use Google Maps to look up the gas stations on their route and the gas prices, saving them hours.");

  // 9. Click "View Replay" to see the replay
  console.log("[demo] → View Replay");
  await actAndTrack("click the 'View Replay' button", "View Replay");
  await sleep(3000);

  // 10. Code narration
  await narrate("This entire automation is captured in repeatable Stagehand code.");

  // 11. Click Code and Files
  console.log("[demo] → Code and Files");
  await actAndTrack("click the 'Code and Files' button", "Code");
  await sleep(2000);

  // 12. Deploy narration
  await narrate("Which can be deployed to Browserbase in one click.");

  // 13. Run on Browserbase
  console.log("[demo] → Run on Browserbase");
  await actAndTrack("click the 'Run on Browserbase' button", "Run on Browserbase");
  await sleep(2000);

  // 14. Closing
  await narrate("I can't wait to see what you guys build with Director. Back to you Loren and Young.");
  await sleep(2000);

  // =====================================================================
  //  STOP CAPTURE
  // =====================================================================

  capturing = false;
  await captureLoop;
  console.log("\n[demo] Closing Browserbase session...");
  await stagehand.close();

  const duration = (Date.now() - recordingStartMs) / 1000;
  const fps = Math.max(1, Math.round(frameCount / duration));
  console.log(`[demo] ${frameCount} frames in ${duration.toFixed(1)}s (${fps} fps)\n`);
  if (frameCount === 0) { console.error("No frames!"); process.exit(1); }

  // Save cursor events for debugging
  fs.writeFileSync(path.join(OUTPUT_DIR, "cursor-events.json"), JSON.stringify(cursorEvents, null, 2));
  console.log(`[demo] ${cursorEvents.length} cursor events recorded\n`);

  // =====================================================================
  //  POST-PRODUCTION: Render cursor overlay (Yonge's compositor approach)
  // =====================================================================

  await renderFramesWithCursor(1920, 1080);

  // =====================================================================
  //  ENCODE VIDEO
  // =====================================================================

  const rawVideo = path.join(OUTPUT_DIR, "raw.mp4");
  console.log("\n[demo] Encoding video (30fps, high quality)...");
  try {
    execSync(
      `ffmpeg -y -framerate ${fps} -i "${RENDERED_DIR}/frame_%05d.jpg" ` +
      `-vf "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" ` +
      `-c:v libx264 -pix_fmt yuv420p -b:v 4M "${rawVideo}"`,
      { stdio: "inherit", timeout: 1200000 }
    );
  } catch {
    console.log("[demo] minterpolate failed, falling back to simple encode...");
    execSync(
      `ffmpeg -y -framerate ${fps} -i "${RENDERED_DIR}/frame_%05d.jpg" ` +
      `-vf "fps=30" -c:v libx264 -pix_fmt yuv420p -b:v 4M "${rawVideo}"`,
      { stdio: "inherit", timeout: 600000 }
    );
  }
  console.log(`[demo] Raw video: ${(fs.statSync(rawVideo).size / 1024 / 1024).toFixed(1)} MB`);

  // Mix narration
  if (clips.length > 0) {
    console.log(`[demo] Mixing ${clips.length} narration clips...`);
    const inputs = clips.map((c) => `-i "${c.path}"`).join(" ");
    const filters = clips.map((c, i) =>
      `[${i + 1}]atempo=1.15,adelay=${c.timestamp_ms}|${c.timestamp_ms}[n${i}]`
    );
    const mix = clips.map((_, i) => `[n${i}]`).join("");
    filters.push(`${mix}amix=inputs=${clips.length}:normalize=0[audio]`);

    try {
      execSync(
        `ffmpeg -y -i "${rawVideo}" ${inputs} ` +
        `-filter_complex "${filters.join(";")}" ` +
        `-map 0:v -map "[audio]" -c:v copy -c:a aac -b:a 128k -shortest "${FINAL_PATH}"`,
        { stdio: "pipe", timeout: 600000 }
      );
      console.log("[demo] ✓ Video + narration mixed");
    } catch {
      console.warn("[demo] Audio mix failed, using video only");
      fs.copyFileSync(rawVideo, FINAL_PATH);
    }
  } else {
    fs.copyFileSync(rawVideo, FINAL_PATH);
  }

  console.log(`\n==========================================`);
  console.log(`  Done! ${FINAL_PATH}`);
  console.log(`  ${(fs.statSync(FINAL_PATH).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`==========================================`);
}

main().catch((err) => {
  console.error("[demo] Fatal:", err);
  process.exit(1);
});
