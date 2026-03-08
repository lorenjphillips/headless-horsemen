import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { VoiceoverManifest } from "./voiceover.js";

const DEFAULT_MUSIC_PATH = path.resolve("public/music/lofi-chill.mp3");
const MUSIC_VOLUME = 0.12;
const CROSSFADE_SEC = 3;
const FADE_IN_SEC = 2;
const FADE_OUT_SEC = 3.5;

interface ComposeVideoWithVoiceoverParams {
  outputPath: string;
  videoPath: string;
  voiceoverDir: string;
  manifest: VoiceoverManifest;
  backgroundMusic?: string | false;
}

function probeSeconds(filePath: string): number {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    const val = parseFloat(out);
    return Number.isFinite(val) ? val : 0;
  } catch {
    return 0;
  }
}

function buildCrossfadeLoopTrack(
  musicPath: string,
  videoDurationSec: number,
  outputDir: string,
): string | undefined {
  const clipDur = probeSeconds(musicPath);
  if (clipDur <= 0) return undefined;

  const loopOffset = Math.max(1, Math.floor(clipDur - CROSSFADE_SEC));
  const fadeOutStart = Math.max(0, Math.floor(videoDurationSec) - Math.ceil(FADE_OUT_SEC));
  const totalDur = Math.ceil(videoDurationSec) + 1;

  const filter = [
    `[0:a]afade=t=out:st=${loopOffset}:d=${CROSSFADE_SEC}[a0]`,
    `[1:a]afade=t=in:st=0:d=${CROSSFADE_SEC},afade=t=out:st=${loopOffset}:d=${CROSSFADE_SEC},adelay=${loopOffset * 1000}|${loopOffset * 1000}[a1]`,
    `[2:a]afade=t=in:st=0:d=${CROSSFADE_SEC},adelay=${loopOffset * 2 * 1000}|${loopOffset * 2 * 1000}[a2]`,
    `[a0][a1][a2]amix=inputs=3:duration=longest:normalize=0,` +
      `atrim=0:${totalDur},` +
      `afade=t=in:st=0:d=${FADE_IN_SEC},afade=t=out:st=${fadeOutStart}:d=${FADE_OUT_SEC},` +
      `volume=${MUSIC_VOLUME}[bgloop]`,
  ].join(";");

  const bgPath = path.join(outputDir, "bg_loop.wav");
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-i", musicPath, "-i", musicPath, "-i", musicPath, "-filter_complex", filter, "-map", "[bgloop]", bgPath],
      { stdio: "pipe", timeout: 120_000 },
    );
    return bgPath;
  } catch {
    return undefined;
  }
}

export function composeVideoWithVoiceover(
  params: ComposeVideoWithVoiceoverParams,
) {
  const { outputPath, videoPath, voiceoverDir, manifest, backgroundMusic } = params;
  const audioSegments = manifest.segments.filter((segment) => segment.audioFile);

  if (audioSegments.length === 0) {
    fs.copyFileSync(videoPath, outputPath);
    return outputPath;
  }

  // Resolve background music path
  const musicPath =
    backgroundMusic === false
      ? undefined
      : backgroundMusic
        ? path.resolve(backgroundMusic)
        : fs.existsSync(DEFAULT_MUSIC_PATH)
          ? DEFAULT_MUSIC_PATH
          : undefined;

  // Build crossfade-looped background track if music is available
  const videoDurationSec = probeSeconds(videoPath);
  const bgTrackPath =
    musicPath && fs.existsSync(musicPath) && videoDurationSec > 0
      ? buildCrossfadeLoopTrack(musicPath, videoDurationSec, path.dirname(outputPath))
      : undefined;

  const ffmpegArgs = ["-y", "-i", videoPath];
  for (const segment of audioSegments) {
    ffmpegArgs.push("-i", path.join(voiceoverDir, segment.audioFile!));
  }

  // Background music is the last input if present
  let bgInputIndex: number | undefined;
  if (bgTrackPath) {
    bgInputIndex = 1 + audioSegments.length;
    ffmpegArgs.push("-i", bgTrackPath);
  }

  const delayedAudioLabels = audioSegments.map((segment, index) => {
    const delayMs = Math.max(0, Math.round(segment.startMs));
    return {
      filter: `[${index + 1}:a]adelay=${delayMs}:all=1[a${index}]`,
      label: `[a${index}]`,
    };
  });

  // Mix voiceover segments
  let voMixFilter: string;
  let voMixLabel: string;
  if (audioSegments.length === 1) {
    voMixFilter = `${delayedAudioLabels[0].filter};${delayedAudioLabels[0].label}anull[vo]`;
    voMixLabel = "[vo]";
  } else {
    voMixFilter =
      `${delayedAudioLabels.map((e) => e.filter).join(";")};` +
      `${delayedAudioLabels.map((e) => e.label).join("")}amix=inputs=${audioSegments.length}:normalize=0[vo]`;
    voMixLabel = "[vo]";
  }

  // Mix voiceover + background music, then fade out all audio at the end
  const fadeOutStart = Math.max(0, Math.floor(videoDurationSec) - Math.ceil(FADE_OUT_SEC));
  let filterComplex: string;
  if (bgInputIndex !== undefined) {
    filterComplex =
      `${voMixFilter};` +
      `${voMixLabel}[${bgInputIndex}:a]amix=inputs=2:duration=first:normalize=0,` +
      `afade=t=out:st=${fadeOutStart}:d=${FADE_OUT_SEC}[aout]`;
  } else {
    filterComplex =
      `${voMixFilter};` +
      `${voMixLabel}afade=t=out:st=${fadeOutStart}:d=${FADE_OUT_SEC}[aout]`;
  }

  ffmpegArgs.push(
    "-filter_complex",
    filterComplex,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath,
  );

  execFileSync("ffmpeg", ffmpegArgs, { stdio: "pipe", timeout: 300_000 });

  // Clean up temp background track
  if (bgTrackPath && fs.existsSync(bgTrackPath)) {
    fs.unlinkSync(bgTrackPath);
  }

  return outputPath;
}
