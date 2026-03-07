import * as fs from "fs";

export interface DemoMetadataEvent {
  kind: string;
  startMs: number;
  endMs: number;
  stepId?: string;
  description?: string;
  url?: string;
  textLength?: number;
  [key: string]: unknown;
}

export interface DemoMetadataSpeedSegment {
  sourceStartMs: number;
  sourceEndMs: number;
  outputStartMs: number;
  outputEndMs: number;
  speed: number;
}

export interface DemoMetadata {
  events?: DemoMetadataEvent[];
  speedSegments?: DemoMetadataSpeedSegment[];
  outputDurationMs?: number;
  [key: string]: unknown;
}

export function readDemoMetadata(metadataPath: string): DemoMetadata {
  return JSON.parse(fs.readFileSync(metadataPath, "utf8")) as DemoMetadata;
}

export function mapSourceToOutputTime(
  speedSegments: DemoMetadataSpeedSegment[] | undefined,
  sourceTimeMs: number,
) {
  if (!speedSegments?.length) {
    return Math.max(0, Math.round(sourceTimeMs));
  }

  const segment =
    speedSegments.find(
      (candidate) =>
        sourceTimeMs >= candidate.sourceStartMs &&
        sourceTimeMs <= candidate.sourceEndMs,
    ) ??
    speedSegments.find((candidate) => sourceTimeMs < candidate.sourceStartMs) ??
    speedSegments.at(-1);

  if (!segment) {
    return Math.max(0, Math.round(sourceTimeMs));
  }

  if (sourceTimeMs <= segment.sourceStartMs) {
    return Math.max(0, Math.round(segment.outputStartMs));
  }

  const unclampedOutputMs =
    segment.outputStartMs +
    (sourceTimeMs - segment.sourceStartMs) / Math.max(segment.speed, 0.0001);

  return Math.max(
    0,
    Math.round(
      Math.min(
        Math.max(unclampedOutputMs, segment.outputStartMs),
        segment.outputEndMs,
      ),
    ),
  );
}

export function mapSourceRangeToOutputRange(
  speedSegments: DemoMetadataSpeedSegment[] | undefined,
  startMs: number,
  endMs: number,
) {
  const outputStartMs = mapSourceToOutputTime(speedSegments, startMs);
  const outputEndMs = Math.max(
    outputStartMs,
    mapSourceToOutputTime(speedSegments, endMs),
  );

  return {
    startMs: outputStartMs,
    endMs: outputEndMs,
  };
}

export function findFirstEventByStepId(
  metadata: DemoMetadata,
  stepId: string,
) {
  return metadata.events?.find((event) => event.stepId === stepId);
}
