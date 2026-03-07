import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const OUTPUT_DIR = path.resolve("output");
const FRAMES_DIR = path.join(OUTPUT_DIR, "frames");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  // Clean up old frames
  for (const f of fs.readdirSync(FRAMES_DIR)) {
    fs.unlinkSync(path.join(FRAMES_DIR, f));
  }

  console.log("Initializing Stagehand with Browserbase...");

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
  console.log("Session ID:", stagehand.browserbaseSessionId);

  const page = stagehand.context.pages()[0];

  // Frame capture loop
  let frameCount = 0;
  let capturing = true;
  const capturePromise = (async () => {
    while (capturing) {
      try {
        const buf = await page.screenshot();
        const f = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, "0")}.png`);
        fs.writeFileSync(f, buf);
        frameCount++;
      } catch {}
      await sleep(66); // ~15 fps
    }
  })();

  // === FLOW: Wikipedia — search, open article, scroll through content ===

  console.log("1. Navigate to Wikipedia...");
  await page.goto("https://en.wikipedia.org/wiki/Artificial_intelligence", {
    waitUntil: "domcontentloaded",
  });
  await sleep(3000);
  console.log("   Page loaded.");

  console.log("2. Scroll down through the article...");
  for (let i = 0; i < 6; i++) {
    try {
      await stagehand.act("scroll down the page");
      console.log(`   Scrolled down (${i + 1}/6)`);
    } catch {
      console.log(`   Scroll ${i + 1} failed.`);
    }
    await sleep(1500);
  }

  console.log("3. Click on 'History' link in the table of contents...");
  try {
    await stagehand.act('click the "History" link in the article contents or body');
    console.log("   Clicked History.");
  } catch (err) {
    console.log("   History click failed:", err);
  }
  await sleep(3000);

  console.log("4. Scroll down more...");
  for (let i = 0; i < 4; i++) {
    try {
      await stagehand.act("scroll down the page");
      console.log(`   Scrolled down (${i + 1}/4)`);
    } catch {
      console.log(`   Scroll ${i + 1} failed.`);
    }
    await sleep(1500);
  }

  console.log("5. Scroll back to top...");
  try {
    await stagehand.act("scroll to the top of the page");
    console.log("   Back at top.");
  } catch {
    console.log("   Scroll to top failed.");
  }
  await sleep(2000);

  // Stop capture and close
  capturing = false;
  await capturePromise;

  console.log("Closing browser...");
  await stagehand.close();
  console.log(`Captured ${frameCount} frames.`);

  // Stitch into video
  if (frameCount > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outputVideo = path.join(OUTPUT_DIR, `demo-${ts}.webm`);
    console.log("Encoding video...");
    try {
      execSync(
        `ffmpeg -y -framerate 15 -i "${FRAMES_DIR}/frame_%05d.png" -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 4M "${outputVideo}"`,
        { stdio: "pipe" }
      );
      const stats = fs.statSync(outputVideo);
      console.log(`Video saved: ${outputVideo} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    } catch (err: any) {
      console.error("ffmpeg error:", err.stderr?.toString().slice(-500) || err.message);
    }
  }

  console.log("Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
