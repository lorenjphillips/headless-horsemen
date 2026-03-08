export type ActionStep =
  | { action: "goto"; url: string }
  | { action: "act"; instruction: string }
  | { action: "wait"; seconds: number }
  | { action: "scroll"; direction: "up" | "down"; pixels?: number };

export interface ActionLogEntry {
  step: number;
  action: ActionStep;
  timestamp_ms: number;
  success: boolean;
  error?: string;
}

export type MusicTrack = "lofi-chill" | "upbeat-tech" | "ambient-focus" | "cinematic-reveal";

export type VoiceName = "Puck" | "Kore" | "Charon" | "Fenrir" | "Achird";

export interface DemoOptions {
  // Post-production
  subtitles?: boolean;
  backgroundMusic?: MusicTrack | false;
  narration?: { enabled: boolean; voice?: VoiceName; context?: string } | false;

  // Video quality
  videoQuality?: "low" | "medium" | "high";
  viewport?: { width: number; height: number };

  // Pacing
  speed?: "slow" | "normal" | "fast";
}

export interface DemoRequest {
  siteUrl: string;
  demoTask: string;
  options?: DemoOptions;
}
