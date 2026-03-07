import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { GoogleGenAI } from "@google/genai";
import {
  generateVoiceoverPackage,
  type InteractionEvent,
} from "../src/voiceover";

function readEvents(inputPath: string) {
  const raw = fs.readFileSync(inputPath, "utf8");
  return JSON.parse(raw) as InteractionEvent[];
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const dryRun = rawArgs.includes("--dry-run");
  const args = rawArgs.filter((arg) => arg !== "--dry-run");

  const inputPath = path.resolve(args[0] ?? "output/interaction-events.json");
  const outputDir = path.resolve(args[1] ?? "output/voiceover");
  const context =
    args.slice(2).join(" ") ||
    process.env.VOICEOVER_CONTEXT ||
    "A concise screen-recorded product demo.";

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Interaction event file not found: ${inputPath}`);
  }

  if (!dryRun && !process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required to generate Gemini voiceover audio.");
  }

  const events = readEvents(inputPath);
  const ai =
    dryRun || !process.env.GEMINI_API_KEY
      ? undefined
      : new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
        });

  const { manifest } = await generateVoiceoverPackage({
    ai,
    context,
    dryRun,
    events,
    outputDir,
    scriptModel: process.env.GEMINI_SCRIPT_MODEL,
    ttsModel: process.env.GEMINI_TTS_MODEL,
    voiceName: process.env.GEMINI_TTS_VOICE,
  });

  console.log(
    `Saved ${manifest.segmentCount} voiceover segment(s) to ${outputDir}.`,
  );
  console.log(`Manifest: ${path.join(outputDir, "manifest.json")}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
