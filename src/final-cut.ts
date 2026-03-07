import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { VoiceoverManifest } from "./voiceover.js";

interface ComposeVideoWithVoiceoverParams {
  outputPath: string;
  videoPath: string;
  voiceoverDir: string;
  manifest: VoiceoverManifest;
}

export function composeVideoWithVoiceover(
  params: ComposeVideoWithVoiceoverParams,
) {
  const { outputPath, videoPath, voiceoverDir, manifest } = params;
  const audioSegments = manifest.segments.filter((segment) => segment.audioFile);

  if (audioSegments.length === 0) {
    fs.copyFileSync(videoPath, outputPath);
    return outputPath;
  }

  const ffmpegArgs = ["-y", "-i", videoPath];
  for (const segment of audioSegments) {
    ffmpegArgs.push("-i", path.join(voiceoverDir, segment.audioFile!));
  }

  const delayedAudioLabels = audioSegments.map((segment, index) => {
    const delayMs = Math.max(0, Math.round(segment.startMs));
    return {
      filter: `[${index + 1}:a]adelay=${delayMs}:all=1[a${index}]`,
      label: `[a${index}]`,
    };
  });

  const filterComplex =
    audioSegments.length === 1
      ? `${delayedAudioLabels[0].filter};${delayedAudioLabels[0].label}anull[aout]`
      : `${delayedAudioLabels.map((entry) => entry.filter).join(";")};${delayedAudioLabels.map((entry) => entry.label).join("")}amix=inputs=${audioSegments.length}:normalize=0[aout]`;

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

  execFileSync("ffmpeg", ffmpegArgs, { stdio: "pipe" });
  return outputPath;
}
