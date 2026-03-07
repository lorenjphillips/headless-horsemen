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

export interface DemoRequest {
  siteUrl: string;
  demoTask: string;
}
