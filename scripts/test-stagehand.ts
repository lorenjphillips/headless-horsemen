import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { GoogleGenAI } from "@google/genai";
import { runStagehandDemo, type DemoStep } from "../src/demo-video";
import { buildInteractionEventsFromMetadataFile } from "../src/interaction-events.js";
import {
  browserbaseSessionReplayUrl,
  createBrowserbaseStagehand,
} from "../src/stagehand.js";
import {
  generateVoiceoverPackage,
} from "../src/voiceover";

const OUTPUT_DIR = path.resolve("output");
const EVENTS_FILE = path.join(OUTPUT_DIR, "interaction-events.json");
const VOICEOVER_DIR = path.join(OUTPUT_DIR, "voiceover");
const DEMO_CONTEXT =
  "A short product demo showing NotebookLM creating a notebook, searching for a source, importing it, and asking a question. Keep the narration concrete, warm, and concise.";
const NOTEBOOKLM_SOURCE_QUERY = "Stagehand browser automation";
const NOTEBOOKLM_CHAT_QUERY =
  "What is Stagehand and how could it help automate browser workflows?";

async function main() {
  console.log("Initializing Stagehand with Browserbase...");

  const stagehand = createBrowserbaseStagehand();
  await stagehand.init();
  console.log("Session ID:", stagehand.browserbaseSessionId);
  const replayUrl = browserbaseSessionReplayUrl(stagehand.browserbaseSessionId);
  if (replayUrl) {
    console.log("Session replay:", replayUrl);
  }
  console.log(
    "NotebookLM flow assumes this Browserbase session already has access to a signed-in Google account.",
  );

  const steps: DemoStep[] = [
    {
      kind: "goto",
      url: "https://notebooklm.google.com/",
      waitUntil: "domcontentloaded",
      settleMs: 5000,
    },
    {
      kind: "act",
      instruction:
        'click the "Create new notebook" or "Make Notebook" button on the NotebookLM home page',
      fallbackTexts: [
        "Create new notebook",
        "Make Notebook",
        "New notebook",
        "Create notebook",
        "Create",
      ],
      fallbackTargetKind: "clickable",
      observeAttempts: 4,
      settleMs: 1200,
    },
    {
      kind: "act",
      instruction:
        'click the "Web", "Website", or similar option for source search',
      fallbackTexts: ["Web", "Website", "Websites", "Website URL"],
      fallbackTargetKind: "clickable",
      observeAttempts: 3,
      settleMs: 700,
    },
    {
      kind: "act",
      instruction:
        "focus the search box for finding sources for this notebook",
      text: NOTEBOOKLM_SOURCE_QUERY,
      fallbackTexts: [
        "Search",
        "Search sources",
        "Search for sources",
        "Find sources",
        "Website",
        "Paste link",
      ],
      fallbackTargetKind: "input",
      observeAttempts: 4,
      settleMs: 900,
    },
    {
      kind: "act",
      instruction: 'click the "Search" button to search for sources',
      fallbackTexts: ["Search", "Find", "Search sources"],
      fallbackTargetKind: "clickable",
      observeAttempts: 3,
      settleMs: 2600,
    },
    {
      kind: "act",
      instruction:
        "select the first relevant web source result from the search results",
      fallbackTexts: ["Stagehand", "browser automation", "Browserbase"],
      fallbackTargetKind: "clickable",
      observeAttempts: 3,
      settleMs: 900,
    },
    {
      kind: "act",
      instruction: 'click the "Import" button to import the selected source',
      fallbackTexts: ["Import", "Add source", "Insert", "Done"],
      fallbackTargetKind: "clickable",
      observeAttempts: 3,
      settleMs: 6000,
    },
    {
      kind: "act",
      instruction:
        "focus the main chat input in the notebook so a question can be typed",
      text: NOTEBOOKLM_CHAT_QUERY,
      fallbackTexts: [
        "Ask a question",
        "Ask this notebook",
        "Ask NotebookLM",
        "Type your question",
        "Chat",
      ],
      fallbackTargetKind: "input",
      observeAttempts: 4,
      settleMs: 900,
    },
    {
      kind: "press",
      key: "Enter",
      description: "Press Enter to submit the current NotebookLM question",
      settleMs: 3500,
    },
  ];

  try {
    const artifacts = await runStagehandDemo(stagehand, steps, {
      outputDir: OUTPUT_DIR,
      rawCaptureFps: 30,
      outputFps: 30,
      fastForwardMultiplier: 6,
    });

    console.log(`Raw frames: ${artifacts.rawFrameCount}`);
    console.log(`Rendered frames: ${artifacts.renderedFrameCount}`);
    console.log(`Video saved to ${artifacts.outputVideoPath}`);
    console.log(`Metadata saved to ${artifacts.metadataPath}`);

    const interactionEvents = buildInteractionEventsFromMetadataFile(
      artifacts.metadataPath,
    );
    fs.writeFileSync(EVENTS_FILE, JSON.stringify(interactionEvents, null, 2));
    console.log(
      `Saved ${interactionEvents.length} interaction event(s) to ${EVENTS_FILE}`,
    );

    if (interactionEvents.length > 0) {
      console.log("Generating event-driven voiceover segments with Gemini...");
      try {
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
        });
        const { manifest } = await generateVoiceoverPackage({
          ai,
          context: DEMO_CONTEXT,
          events: interactionEvents,
          outputDir: VOICEOVER_DIR,
          scriptModel: process.env.GEMINI_SCRIPT_MODEL,
          sourceVideo: artifacts.outputVideoPath,
          ttsModel: process.env.GEMINI_TTS_MODEL,
          voiceName: process.env.GEMINI_TTS_VOICE,
        });
        console.log(
          `Saved ${manifest.segmentCount} voiceover segment(s) to ${VOICEOVER_DIR}`,
        );
      } catch (err) {
        console.error("Voiceover generation failed:", err);
      }
    } else {
      console.log(
        "No mouse/keyboard events were recorded. Skipping voiceover generation.",
      );
    }
  } finally {
    console.log("Closing browser...");
    await stagehand.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
