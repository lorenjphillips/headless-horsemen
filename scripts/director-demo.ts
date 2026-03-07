import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { GoogleGenAI } from "@google/genai";
import { runStagehandDemo, type DemoStep } from "../src/demo-video.js";
import {
  findFirstEventByStepId,
  mapSourceToOutputTime,
  readDemoMetadata,
} from "../src/demo-metadata.js";
import { composeVideoWithVoiceover } from "../src/final-cut.js";
import { buildInteractionEventsFromMetadataFile } from "../src/interaction-events.js";
import {
  browserbaseSessionReplayUrl,
  createBrowserbaseStagehand,
} from "../src/stagehand.js";
import { generateScriptedVoiceoverPackage } from "../src/voiceover.js";

const OUTPUT_DIR = path.resolve("output/director-demo");
const VOICEOVER_DIR = path.join(OUTPUT_DIR, "voiceover");
const INTERACTIONS_FILE = path.join(OUTPUT_DIR, "interaction-events.json");
const FINAL_VIDEO_PATH = path.join(OUTPUT_DIR, "director-demo-final.mp4");
const DEMO_CONTEXT =
  "A Browserbase product demo introducing Director on director.ai.";

const steps: DemoStep[] = [
  {
    kind: "goto",
    stepId: "landing",
    url: "https://www.director.ai/",
    waitUntil: "domcontentloaded",
    settleMs: 5000,
  },
  {
    kind: "pause",
    stepId: "intro-hold",
    seconds: 8,
    focus: "center",
    scale: 1,
    description: "Hold on the Director landing page for the opening narration.",
  },
  {
    kind: "act",
    stepId: "prompt-focus",
    instruction:
      "click the main text box where a user can describe a web automation in natural language",
    fallbackTexts: [
      "What can I help you automate",
      "Describe what you want to automate",
      "What do you want to automate",
      "Try Director",
      "Prompt",
    ],
    fallbackTargetKind: "input",
    observeAttempts: 4,
    settleMs: 900,
  },
  {
    kind: "pause",
    stepId: "prompt-hold",
    seconds: 3.5,
    focus: "cursor",
    scale: 1.16,
    description: "Hold on the Director prompt input.",
  },
  {
    kind: "pause",
    stepId: "prompt-zoom-out",
    seconds: 1.2,
    focus: "center",
    scale: 1,
    description: "Zoom back out from the prompt input.",
  },
  {
    kind: "pause",
    stepId: "suggestion-setup",
    seconds: 4.5,
    focus: "center",
    scale: 1,
    description: "Set up the truck route gas price example.",
  },
  {
    kind: "act",
    stepId: "truck-route-suggestion",
    instruction:
      'click the suggestion button labeled "Average gas price along my truck route"',
    fallbackTexts: ["Average gas price along my truck route"],
    fallbackTargetKind: "clickable",
    observeAttempts: 4,
    settleMs: 6500,
  },
  {
    kind: "act",
    stepId: "scroll-bottom",
    instruction:
      "scroll to the bottom of the generated workflow result so the lower actions are visible",
    settleMs: 1400,
  },
  {
    kind: "pause",
    stepId: "dairy-explain",
    seconds: 11,
    focus: "center",
    scale: 1,
    description: "Hold on the generated workflow for the customer story.",
  },
  {
    kind: "act",
    stepId: "view-code",
    instruction: 'click the "Code and Files" button in the top right',
    fallbackTexts: ["Code and Files", "Code", "Files"],
    fallbackTargetKind: "clickable",
    observeAttempts: 4,
    settleMs: 1500,
  },
  {
    kind: "pause",
    stepId: "view-code-hold",
    seconds: 1.1,
    focus: "cursor",
    scale: 1.16,
    description: "Hold on the Code and Files affordance.",
  },
  {
    kind: "pause",
    stepId: "view-code-zoom-out",
    seconds: 1,
    focus: "center",
    scale: 1,
    description: "Zoom back out after opening the code view.",
  },
  {
    kind: "pause",
    stepId: "code-explain",
    seconds: 3.4,
    focus: "center",
    scale: 1,
    description: "Explain the generated Stagehand code sheet.",
  },
  {
    kind: "act",
    stepId: "copy-code",
    instruction: 'click the "Copy" button in the code side sheet',
    fallbackTexts: ["Copy", "Copy code"],
    fallbackTargetKind: "clickable",
    observeAttempts: 4,
    settleMs: 1200,
  },
  {
    kind: "pause",
    stepId: "copy-explain",
    seconds: 2.8,
    focus: "center",
    scale: 1,
    description: "Explain that the code can be copied and run locally.",
  },
  {
    kind: "act",
    stepId: "run-browserbase",
    instruction: 'click the "Run on Browserbase" button',
    fallbackTexts: ["Run on Browserbase"],
    fallbackTargetKind: "clickable",
    observeAttempts: 4,
    settleMs: 2200,
  },
  {
    kind: "pause",
    stepId: "run-explain",
    seconds: 3,
    focus: "cursor",
    scale: 1.14,
    description: "Hold on the Run on Browserbase button.",
  },
  {
    kind: "pause",
    stepId: "closing-hold",
    seconds: 5,
    focus: "center",
    scale: 1,
    description: "Hold for the closing narration.",
  },
];

const scriptedNarration = [
  {
    stepId: "intro-hold",
    script:
      "Today at Browserbase, we're introducing Director, which lets anyone automate the web using a natural language prompt. You can now generate repeatable web automation code in one single step.",
  },
  {
    stepId: "prompt-hold",
    script:
      "You can explain your browser automation in natural language.",
  },
  {
    stepId: "suggestion-setup",
    script:
      "Today let's use one of our suggestions to get the average gas prices along a truck route.",
  },
  {
    stepId: "dairy-explain",
    script:
      "We have a customer who runs a dairy company who had to manually look through gas prices for all their dairy truck routes. With Director they can use Google Maps to look up the gas stations on their route and the gas prices, saving them hours.",
  },
  {
    stepId: "code-explain",
    script: "We can view all the generated Stagehand code.",
  },
  {
    stepId: "copy-explain",
    script: "It can be copied and run locally.",
  },
  {
    stepId: "run-explain",
    script: "Or deployed to Browserbase in one click.",
  },
  {
    stepId: "closing-hold",
    script: "I can't wait to see what you guys build with Director.",
  },
] as const;

function cueStartMs(metadataPath: string, stepId: string) {
  const metadata = readDemoMetadata(metadataPath);
  const event = findFirstEventByStepId(metadata, stepId);
  if (!event) {
    throw new Error(`Could not find demo event for stepId "${stepId}".`);
  }

  return mapSourceToOutputTime(metadata.speedSegments, event.startMs);
}

async function main() {
  console.log("Initializing Stagehand with Browserbase...");

  const stagehand = createBrowserbaseStagehand();
  let stagehandClosed = false;
  await stagehand.init();
  console.log("Session ID:", stagehand.browserbaseSessionId);

  const replayUrl = browserbaseSessionReplayUrl(stagehand.browserbaseSessionId);
  if (replayUrl) {
    console.log("Session replay:", replayUrl);
  }

  try {
    console.log("Running Director demo steps and rendering the polished video...");
    const artifacts = await runStagehandDemo(stagehand, steps, {
      outputDir: OUTPUT_DIR,
      rawCaptureFps: 18,
      outputFps: 18,
      fastForwardMultiplier: 4,
    });

    console.log(`Video saved to ${artifacts.outputVideoPath}`);
    console.log(`Metadata saved to ${artifacts.metadataPath}`);
    console.log("Closing the Browserbase session before local TTS and ffmpeg work...");
    await stagehand.close().catch(() => undefined);
    stagehandClosed = true;

    const interactionEvents = buildInteractionEventsFromMetadataFile(
      artifacts.metadataPath,
    );
    fs.writeFileSync(
      INTERACTIONS_FILE,
      JSON.stringify(interactionEvents, null, 2),
    );
    console.log(
      `Saved ${interactionEvents.length} interaction event(s) to ${INTERACTIONS_FILE}`,
    );

    console.log("Generating scripted voiceover audio...");
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const { manifest } = await generateScriptedVoiceoverPackage({
      ai,
      context: DEMO_CONTEXT,
      outputDir: VOICEOVER_DIR,
      scriptModel: "manual-script",
      segments: scriptedNarration.map((cue, index) => ({
        id: `segment-${String(index + 1).padStart(3, "0")}`,
        startMs: cueStartMs(artifacts.metadataPath, cue.stepId),
        script: cue.script,
        summary: cue.stepId,
      })),
      sourceVideo: artifacts.outputVideoPath,
      ttsModel: process.env.GEMINI_TTS_MODEL,
      voiceName: process.env.GEMINI_TTS_VOICE,
    });
    console.log(
      `Saved ${manifest.segmentCount} scripted voiceover segment(s) to ${VOICEOVER_DIR}`,
    );

    console.log("Composing the final narrated MP4...");
    composeVideoWithVoiceover({
      outputPath: FINAL_VIDEO_PATH,
      videoPath: artifacts.outputVideoPath,
      voiceoverDir: VOICEOVER_DIR,
      manifest,
    });
    console.log(`Final narrated demo saved to ${FINAL_VIDEO_PATH}`);
  } finally {
    if (!stagehandClosed) {
      console.log("Closing browser...");
      await stagehand.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
