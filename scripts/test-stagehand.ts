import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const OUTPUT_DIR = path.resolve("output");
const FRAMES_DIR = path.join(OUTPUT_DIR, "frames");

async function main() {
  // Ensure output directories exist
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
      modelName: "google/gemini-2.0-flash",
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
  console.log(
    "Stagehand initialized. Session ID:",
    stagehand.browserbaseSessionId
  );
  console.log(
    "Session replay:",
    `https://www.browserbase.com/sessions/${stagehand.browserbaseSessionId}`
  );

  const page = stagehand.context.pages()[0];

  // Start periodic screenshot capture (PNG format, ~5 fps)
  let frameCount = 0;
  const screenshotInterval = setInterval(async () => {
    try {
      const buf = await page.screenshot();
      const frameFile = path.join(
        FRAMES_DIR,
        `frame_${String(frameCount).padStart(5, "0")}.png`
      );
      fs.writeFileSync(frameFile, buf);
      frameCount++;
    } catch {
      // Page might not be ready or transitioning
    }
  }, 200); // 5 fps

  // Navigate to GitHub (no auth required, has clear buttons to click)
  console.log("Navigating to github.com/browserbase/stagehand...");
  await page.goto("https://github.com/browserbase/stagehand", {
    waitUntil: "domcontentloaded",
  });
  console.log("Page loaded.");

  // Wait for the page to settle
  await new Promise((r) => setTimeout(r, 3000));

  // Take a screenshot to see what we're working with
  const beforeScreenshot = await page.screenshot();
  fs.writeFileSync(path.join(OUTPUT_DIR, "before-click.png"), beforeScreenshot);
  console.log("Saved before-click screenshot.");

  // Use Stagehand's act() to interact with the page
  console.log('Using act() to click the "Code" button...');
  try {
    await stagehand.act('click the green "Code" button');
    console.log("act() completed successfully.");
  } catch (err) {
    console.log("act() failed:", err);
  }

  // Wait for the UI to respond
  await new Promise((r) => setTimeout(r, 2000));

  // Take an after screenshot
  const afterScreenshot = await page.screenshot();
  fs.writeFileSync(path.join(OUTPUT_DIR, "after-click.png"), afterScreenshot);
  console.log("Saved after-click screenshot.");

  // Try another act() - star the repo
  console.log('Using act() to click "Star" button...');
  try {
    await stagehand.act("click the Star button to star the repository");
    console.log("Second act() completed.");
  } catch (err) {
    console.log("Second act() failed:", err);
  }

  await new Promise((r) => setTimeout(r, 2000));

  // Stop screenshot capture
  clearInterval(screenshotInterval);

  // Final screenshot
  const finalScreenshot = await page.screenshot();
  fs.writeFileSync(path.join(OUTPUT_DIR, "final.png"), finalScreenshot);

  // Close the browser
  console.log("Closing browser...");
  await stagehand.close();

  console.log(`Captured ${frameCount} frames.`);

  // Stitch frames into video using ffmpeg
  if (frameCount > 0) {
    console.log("Stitching frames into video with ffmpeg...");
    const outputVideo = path.join(OUTPUT_DIR, "demo.webm");
    try {
      execSync(
        `ffmpeg -y -framerate 5 -i "${FRAMES_DIR}/frame_%05d.png" -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 1M "${outputVideo}"`,
        { stdio: "pipe" }
      );
      console.log(`Video saved to ${outputVideo}`);

      // Clean up frames
      const stats = fs.statSync(outputVideo);
      console.log(
        `Video size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
      );
    } catch (err: any) {
      console.error("ffmpeg failed:", err.stderr?.toString() || err.message);
      console.log("Frames are saved in", FRAMES_DIR);
    }
  } else {
    console.log("No frames captured. Check the screenshots in output/.");
  }

  console.log("Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
