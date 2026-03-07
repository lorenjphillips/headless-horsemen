import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { GoogleGenAI, Modality } from "@google/genai";
import {
  normalizeInstructionSentence,
  normalizeWhitespace,
  type InteractionEvent,
} from "./interaction-events.js";

const DEFAULT_SCRIPT_MODEL = "gemini-3.1-flash-lite-preview";
const DEFAULT_TTS_MODEL = "gemini-2.5-pro-preview-tts";
const DEFAULT_VOICE_NAME = "Zephyr";
const DEFAULT_SEGMENT_GAP_MS = 1500;
export type {
  InteractionDevice,
  InteractionEvent,
  InteractionKind,
} from "./interaction-events.js";

export interface VoiceoverSegment {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  events: InteractionEvent[];
  summary: string;
  script: string;
  audioFile?: string;
  audioMimeType?: string;
  audioDurationMs?: number;
}

export interface VoiceoverManifest {
  generatedAt: string;
  context: string;
  voiceName: string;
  scriptModel: string;
  ttsModel?: string;
  sourceVideo?: string;
  eventCount: number;
  segmentCount: number;
  segments: VoiceoverSegment[];
}

interface GenerateVoiceoverPackageParams {
  ai?: GoogleGenAI;
  context?: string;
  dryRun?: boolean;
  events: InteractionEvent[];
  maxGapMs?: number;
  outputDir: string;
  scriptModel?: string;
  sourceVideo?: string;
  ttsModel?: string;
  voiceName?: string;
}

export interface ScriptedVoiceoverSegmentInput {
  id?: string;
  startMs: number;
  endMs?: number;
  summary?: string;
  script: string;
  events?: InteractionEvent[];
}

interface GenerateScriptedVoiceoverPackageParams {
  ai?: GoogleGenAI;
  context?: string;
  dryRun?: boolean;
  outputDir: string;
  scriptModel?: string;
  segments: ScriptedVoiceoverSegmentInput[];
  sourceVideo?: string;
  ttsModel?: string;
  voiceName?: string;
}

interface InlineAudioBlob {
  data: string;
  mimeType: string;
}

interface WavConversionOptions {
  bitsPerSample: number;
  numChannels: number;
  sampleRate: number;
}

interface SegmentScriptResponse {
  segments?: Array<{
    script?: string;
    segmentId?: string;
  }>;
}

function eventSummary(event: InteractionEvent) {
  const selectorText = event.selector ? ` on ${event.selector}` : "";
  const methodText = event.method ? ` via ${event.method}` : "";
  return `${event.device} ${event.kind}${selectorText}${methodText}: ${event.actionDescription}`;
}

export function buildVoiceoverSegments(
  events: InteractionEvent[],
  maxGapMs = DEFAULT_SEGMENT_GAP_MS,
) {
  const sortedEvents = [...events].sort((left, right) => left.startMs - right.startMs);
  const segments: VoiceoverSegment[] = [];
  let currentEvents: InteractionEvent[] = [];

  const flush = () => {
    if (currentEvents.length === 0) {
      return;
    }

    const index = segments.length;
    const segmentStartMs = Math.min(...currentEvents.map((event) => event.startMs));
    const segmentEndMs = Math.max(...currentEvents.map((event) => event.endMs));

    segments.push({
      id: `segment-${String(index + 1).padStart(3, "0")}`,
      index,
      startMs: segmentStartMs,
      endMs: segmentEndMs,
      events: currentEvents,
      summary: currentEvents.map(eventSummary).join(" | "),
      script: "",
    });

    currentEvents = [];
  };

  for (const event of sortedEvents) {
    const previousEvent = currentEvents[currentEvents.length - 1];
    const shouldStartNewSegment =
      previousEvent !== undefined &&
      event.startMs - previousEvent.endMs > maxGapMs;

    if (shouldStartNewSegment) {
      flush();
    }

    currentEvents.push(event);
  }

  flush();
  return segments;
}

function buildScriptPrompt(context: string, segments: VoiceoverSegment[]) {
  const segmentText = segments
    .map((segment) => {
      const events = segment.events
        .map((event) => `- ${eventSummary(event)}`)
        .join("\n");

      return [
        `${segment.id} | ${segment.startMs}ms-${segment.endMs}ms`,
        events,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "You write concise voiceover lines for a product demo screen recording.",
    "Return JSON with shape {\"segments\":[{\"segmentId\":\"...\",\"script\":\"...\"}]}.",
    "Rules:",
    "- Write one short sentence per segment.",
    "- Keep each sentence between 6 and 18 words.",
    "- Narrate only visible mouse or keyboard interactions.",
    "- Prefer describing user intent or UI outcome over saying \"click\" unless necessary.",
    "- Use present tense.",
    "- Do not add introductions, timestamps, bullet markers, or speaker labels.",
    "",
    `Demo context: ${context}`,
    "",
    "Segments:",
    segmentText,
  ].join("\n");
}

function fallbackScript(segment: VoiceoverSegment) {
  const primaryEvent =
    segment.events.find((event) => event.kind !== "move") ?? segment.events[0];
  return normalizeInstructionSentence(primaryEvent?.instruction ?? segment.summary);
}

function normalizeNarrationScript(value: string | undefined, fallback: string) {
  const cleaned = normalizeWhitespace(value ?? "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^[\-\d.:\s]+/, "");

  if (!cleaned) {
    return fallback;
  }

  const withPunctuation = /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
  return withPunctuation.charAt(0).toUpperCase() + withPunctuation.slice(1);
}

function parseSegmentScripts(responseText: string | undefined) {
  if (!responseText) {
    return new Map<string, string>();
  }

  try {
    const parsed = JSON.parse(responseText) as SegmentScriptResponse;
    return new Map(
      (parsed.segments ?? [])
        .filter((segment) => segment.segmentId && segment.script)
        .map((segment) => [segment.segmentId!, segment.script!]),
    );
  } catch {
    return new Map<string, string>();
  }
}

async function generateSegmentScripts(params: {
  ai: GoogleGenAI;
  context: string;
  scriptModel: string;
  segments: VoiceoverSegment[];
}) {
  const { ai, context, scriptModel, segments } = params;
  const response = await ai.models.generateContent({
    model: scriptModel,
    contents: buildScriptPrompt(context, segments),
    config: {
      maxOutputTokens: 1200,
      responseJsonSchema: {
        additionalProperties: false,
        properties: {
          segments: {
            items: {
              additionalProperties: false,
              properties: {
                script: { type: "string" },
                segmentId: { type: "string" },
              },
              required: ["segmentId", "script"],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["segments"],
        type: "object",
      },
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });

  const scriptBySegmentId = parseSegmentScripts(response.text);

  return segments.map((segment) => {
    const fallback = fallbackScript(segment);
    return {
      ...segment,
      script: normalizeNarrationScript(
        scriptBySegmentId.get(segment.id),
        fallback,
      ),
    };
  });
}

function firstInlineAudioBlob(response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>) {
  const part = response.candidates?.[0]?.content?.parts?.find(
    (candidatePart) => candidatePart.inlineData?.data,
  );
  const data = part?.inlineData?.data ?? response.data;
  const mimeType = part?.inlineData?.mimeType ?? "audio/wav";

  if (!data) {
    throw new Error("Gemini TTS response did not include inline audio data.");
  }

  return {
    data,
    mimeType,
  } satisfies InlineAudioBlob;
}

function parseMimeType(mimeType: string) {
  const [fileType, ...params] = mimeType.split(";").map((value) => value.trim());
  const [, format] = fileType.split("/");
  const options: Partial<WavConversionOptions> = {
    bitsPerSample: 16,
    numChannels: 1,
    sampleRate: 24000,
  };

  if (format && format.startsWith("L")) {
    const bitsPerSample = Number.parseInt(format.slice(1), 10);
    if (!Number.isNaN(bitsPerSample)) {
      options.bitsPerSample = bitsPerSample;
    }
  }

  for (const param of params) {
    const [key, value] = param.split("=").map((segment) => segment.trim());
    if (key === "rate") {
      const sampleRate = Number.parseInt(value, 10);
      if (!Number.isNaN(sampleRate)) {
        options.sampleRate = sampleRate;
      }
    }
  }

  return options as WavConversionOptions;
}

function createWavHeader(dataLength: number, options: WavConversionOptions) {
  const { bitsPerSample, numChannels, sampleRate } = options;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

function convertToWav(rawData: string, mimeType: string) {
  const pcmBuffer = Buffer.from(rawData, "base64");
  const header = createWavHeader(pcmBuffer.length, parseMimeType(mimeType));
  return Buffer.concat([header, pcmBuffer]);
}

function extensionForMimeType(mimeType: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();

  if (!normalized) {
    return "wav";
  }

  if (normalized === "audio/mpeg" || normalized === "audio/mp3") {
    return "mp3";
  }

  if (
    normalized === "audio/wav" ||
    normalized === "audio/wave" ||
    normalized === "audio/x-wav"
  ) {
    return "wav";
  }

  if (normalized === "audio/ogg") {
    return "ogg";
  }

  if (normalized === "audio/flac") {
    return "flac";
  }

  if (normalized.startsWith("audio/l")) {
    return "wav";
  }

  return "wav";
}

function isRawPcmMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase().startsWith("audio/l");
}

function transcodeToMp3(sourcePath: string, destinationPath: string) {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      sourcePath,
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "2",
      destinationPath,
    ],
    { stdio: "pipe" },
  );
}

function probeAudioDurationMs(filePath: string) {
  try {
    const output = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
    const durationSeconds = Number.parseFloat(output);

    if (Number.isFinite(durationSeconds)) {
      return Math.round(durationSeconds * 1000);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function clearPreviousVoiceoverArtifacts(outputDir: string) {
  if (!fs.existsSync(outputDir)) {
    return;
  }

  for (const entry of fs.readdirSync(outputDir)) {
    if (
      entry === "manifest.json" ||
      entry === "transcript.txt" ||
      /^segment-\d+\.(mp3|wav|ogg|flac)$/i.test(entry)
    ) {
      fs.unlinkSync(path.join(outputDir, entry));
    }
  }
}

function persistAudioBlobAsSegment(params: {
  blob: InlineAudioBlob;
  outputDir: string;
  segmentId: string;
}) {
  const { blob, outputDir, segmentId } = params;
  const sourceExtension = extensionForMimeType(blob.mimeType);
  const sourcePath = path.join(outputDir, `${segmentId}.${sourceExtension}`);
  const sourceBuffer = isRawPcmMimeType(blob.mimeType)
    ? convertToWav(blob.data, blob.mimeType)
    : Buffer.from(blob.data, "base64");

  fs.writeFileSync(sourcePath, sourceBuffer);

  if (sourceExtension === "mp3") {
    return {
      audioDurationMs: probeAudioDurationMs(sourcePath),
      audioFile: path.basename(sourcePath),
      audioMimeType: "audio/mpeg",
    };
  }

  const mp3Path = path.join(outputDir, `${segmentId}.mp3`);

  try {
    transcodeToMp3(sourcePath, mp3Path);
    fs.unlinkSync(sourcePath);
    return {
      audioDurationMs: probeAudioDurationMs(mp3Path),
      audioFile: path.basename(mp3Path),
      audioMimeType: "audio/mpeg",
    };
  } catch {
    return {
      audioDurationMs: probeAudioDurationMs(sourcePath),
      audioFile: path.basename(sourcePath),
      audioMimeType: blob.mimeType,
    };
  }
}

async function synthesizeSegmentAudio(params: {
  ai: GoogleGenAI;
  outputDir: string;
  script: string;
  segmentId: string;
  ttsModel: string;
  voiceName: string;
}) {
  const { ai, outputDir, script, segmentId, ttsModel, voiceName } = params;
  const response = await ai.models.generateContent({
    model: ttsModel,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Read this product demo voiceover line exactly as written.",
              "Use a warm, friendly, concise delivery and do not add extra words.",
              "",
              script,
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName,
          },
        },
      },
      temperature: 1,
    },
  });

  return persistAudioBlobAsSegment({
    blob: firstInlineAudioBlob(response),
    outputDir,
    segmentId,
  });
}

function transcriptLine(segment: VoiceoverSegment) {
  const seconds = (segment.startMs / 1000).toFixed(2).padStart(8, " ");
  const audioFile = segment.audioFile ?? "no-audio";
  return `${seconds}s  ${audioFile}  ${segment.script}`;
}

function writeVoiceoverArtifacts(
  outputDir: string,
  manifest: VoiceoverManifest,
  segments: VoiceoverSegment[],
) {
  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(outputDir, "transcript.txt"),
    segments.map(transcriptLine).join("\n") + (segments.length > 0 ? "\n" : ""),
  );
}

export async function generateVoiceoverPackage(
  params: GenerateVoiceoverPackageParams,
) {
  const {
    ai,
    context = "A concise screen-recorded product demo.",
    dryRun = false,
    events,
    maxGapMs = DEFAULT_SEGMENT_GAP_MS,
    outputDir,
    scriptModel = DEFAULT_SCRIPT_MODEL,
    sourceVideo,
    ttsModel = DEFAULT_TTS_MODEL,
    voiceName = DEFAULT_VOICE_NAME,
  } = params;

  fs.mkdirSync(outputDir, { recursive: true });
  clearPreviousVoiceoverArtifacts(outputDir);

  const segments = buildVoiceoverSegments(events, maxGapMs);

  const scriptedSegments =
    dryRun || segments.length === 0
      ? segments.map((segment) => ({
          ...segment,
          script: fallbackScript(segment),
        }))
      : await generateSegmentScripts({
          ai: assertAiClient(ai),
          context,
          scriptModel,
          segments,
        });

  const renderedSegments: VoiceoverSegment[] = [];

  for (const segment of scriptedSegments) {
    if (dryRun) {
      renderedSegments.push(segment);
      continue;
    }

    const audio = await synthesizeSegmentAudio({
      ai: assertAiClient(ai),
      outputDir,
      script: segment.script,
      segmentId: segment.id,
      ttsModel,
      voiceName,
    });

    renderedSegments.push({
      ...segment,
      ...audio,
    });
  }

  const manifest: VoiceoverManifest = {
    generatedAt: new Date().toISOString(),
    context,
    voiceName,
    scriptModel,
    ttsModel: dryRun ? undefined : ttsModel,
    sourceVideo,
    eventCount: events.length,
    segmentCount: renderedSegments.length,
    segments: renderedSegments,
  };

  writeVoiceoverArtifacts(outputDir, manifest, renderedSegments);

  return {
    manifest,
    segments: renderedSegments,
  };
}

export async function generateScriptedVoiceoverPackage(
  params: GenerateScriptedVoiceoverPackageParams,
) {
  const {
    ai,
    context = "A concise screen-recorded product demo.",
    dryRun = false,
    outputDir,
    scriptModel = "manual-script",
    segments,
    sourceVideo,
    ttsModel = DEFAULT_TTS_MODEL,
    voiceName = DEFAULT_VOICE_NAME,
  } = params;

  fs.mkdirSync(outputDir, { recursive: true });
  clearPreviousVoiceoverArtifacts(outputDir);

  const normalizedSegments: VoiceoverSegment[] = segments.map((segment, index) => {
    const startMs = Math.max(0, Math.round(segment.startMs));
    const endMs = Math.max(startMs, Math.round(segment.endMs ?? startMs));

    return {
      id: segment.id ?? `segment-${String(index + 1).padStart(3, "0")}`,
      index,
      startMs,
      endMs,
      events: segment.events ?? [],
      summary: segment.summary ?? segment.script,
      script: normalizeNarrationScript(segment.script, fallbackScript({
        id: "fallback",
        index,
        startMs,
        endMs,
        events: segment.events ?? [],
        summary: segment.summary ?? segment.script,
        script: segment.script,
      })),
    };
  });

  const renderedSegments: VoiceoverSegment[] = [];

  for (const segment of normalizedSegments) {
    if (dryRun) {
      renderedSegments.push(segment);
      continue;
    }

    const audio = await synthesizeSegmentAudio({
      ai: assertAiClient(ai),
      outputDir,
      script: segment.script,
      segmentId: segment.id,
      ttsModel,
      voiceName,
    });

    renderedSegments.push({
      ...segment,
      ...audio,
      endMs:
        audio.audioDurationMs !== undefined
          ? Math.max(segment.endMs, segment.startMs + audio.audioDurationMs)
          : segment.endMs,
    });
  }

  const manifest: VoiceoverManifest = {
    generatedAt: new Date().toISOString(),
    context,
    voiceName,
    scriptModel,
    ttsModel: dryRun ? undefined : ttsModel,
    sourceVideo,
    eventCount: normalizedSegments.reduce(
      (count, segment) => count + segment.events.length,
      0,
    ),
    segmentCount: renderedSegments.length,
    segments: renderedSegments,
  };

  writeVoiceoverArtifacts(outputDir, manifest, renderedSegments);

  return {
    manifest,
    segments: renderedSegments,
  };
}

function assertAiClient(ai: GoogleGenAI | undefined) {
  if (!ai) {
    throw new Error(
      "Gemini API client is required unless generateVoiceoverPackage is running in dry-run mode.",
    );
  }

  return ai;
}
