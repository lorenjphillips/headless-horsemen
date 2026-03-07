import {
  mapSourceRangeToOutputRange,
  readDemoMetadata,
  type DemoMetadataSpeedSegment,
} from "./demo-metadata.js";

const DEFAULT_INTERACTION_FALLBACK = "Narrate the visible interaction.";

export type InteractionDevice = "mouse" | "keyboard";
export type InteractionKind =
  | "move"
  | "click"
  | "scroll"
  | "hover"
  | "drag"
  | "type"
  | "press";

export interface InteractionEvent {
  id: string;
  device: InteractionDevice;
  kind: InteractionKind;
  instruction: string;
  actionDescription: string;
  stepId?: string;
  selector?: string;
  method?: string;
  arguments?: string[];
  startMs: number;
  endMs: number;
}

export interface SerializedDemoEvent {
  kind: string;
  startMs: number;
  endMs: number;
  stepId?: string;
  description?: string;
  url?: string;
  textLength?: number;
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeInstructionSentence(
  value: string,
  fallback = DEFAULT_INTERACTION_FALLBACK,
) {
  const cleaned = normalizeWhitespace(value)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^[\d.\-:)\]]+\s*/, "");

  if (!cleaned) {
    return fallback;
  }

  const withPeriod = /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
  return withPeriod.charAt(0).toUpperCase() + withPeriod.slice(1);
}

function inferInteractionFromText(haystack: string) {
  if (!haystack) {
    return null;
  }

  if (/\b(type|fill|enter text|insert text|input)\b/.test(haystack)) {
    return {
      device: "keyboard" as const,
      kind: "type" as const,
    };
  }

  if (
    /\b(press|hit|shortcut|hotkey|key\b|keyboard\b|tab\b|enter\b|escape\b)\b/.test(
      haystack,
    )
  ) {
    return {
      device: "keyboard" as const,
      kind: "press" as const,
    };
  }

  if (/\b(scroll|wheel)\b/.test(haystack)) {
    return {
      device: "mouse" as const,
      kind: "scroll" as const,
    };
  }

  if (/\b(move|pointer-move|cursor)\b/.test(haystack)) {
    return {
      device: "mouse" as const,
      kind: "move" as const,
    };
  }

  if (/\b(hover)\b/.test(haystack)) {
    return {
      device: "mouse" as const,
      kind: "hover" as const,
    };
  }

  if (/\b(drag|drop)\b/.test(haystack)) {
    return {
      device: "mouse" as const,
      kind: "drag" as const,
    };
  }

  if (/\b(click|tap|button|select|open|toggle|check|uncheck)\b/.test(haystack)) {
    return {
      device: "mouse" as const,
      kind: "click" as const,
    };
  }

  return null;
}

export function inferInteractionFromSerializedDemoEvent(
  event: SerializedDemoEvent,
) {
  const inferred = inferInteractionFromText(
    normalizeWhitespace([event.kind, event.description, event.url].filter(Boolean).join(" ")).toLowerCase(),
  );

  if (inferred) {
    return inferred;
  }

  if (event.kind === "click") {
    return {
      device: "mouse" as const,
      kind: "click" as const,
    };
  }

  if (event.kind === "pointer-move") {
    return {
      device: "mouse" as const,
      kind: "move" as const,
    };
  }

  if (event.kind === "type") {
    return {
      device: "keyboard" as const,
      kind: "type" as const,
    };
  }

  return null;
}

export function buildInteractionEvents(
  events: SerializedDemoEvent[],
  speedSegments?: DemoMetadataSpeedSegment[],
): InteractionEvent[] {
  return events
    .map((event, index) => {
      const interaction = inferInteractionFromSerializedDemoEvent(event);
      if (!interaction) {
        return null;
      }

      const fallbackDescription =
        event.kind === "navigate" && event.url
          ? `Navigate to ${event.url}.`
          : DEFAULT_INTERACTION_FALLBACK;
      const description = normalizeInstructionSentence(
        event.description ?? fallbackDescription,
      );
      const outputWindow = mapSourceRangeToOutputRange(
        speedSegments,
        event.startMs,
        event.endMs,
      );

      return {
        id: `event-${String(outputWindow.startMs).padStart(6, "0")}-${String(index + 1).padStart(2, "0")}`,
        device: interaction.device,
        kind: interaction.kind,
        instruction: description,
        actionDescription: description,
        stepId: event.stepId,
        selector: undefined,
        method: event.kind,
        arguments:
          event.kind === "type" && event.textLength
            ? [`${event.textLength} characters`]
            : undefined,
        startMs: outputWindow.startMs,
        endMs: outputWindow.endMs,
      } satisfies InteractionEvent;
    })
    .filter(Boolean) as InteractionEvent[];
}

export function buildInteractionEventsFromMetadataFile(metadataPath: string) {
  const metadata = readDemoMetadata(metadataPath);
  return buildInteractionEvents(
    (metadata.events ?? []) as SerializedDemoEvent[],
    metadata.speedSegments,
  );
}
