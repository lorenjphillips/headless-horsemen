import { Stagehand } from "@browserbasehq/stagehand";

const DEFAULT_VIEWPORT = {
  width: 1280,
  height: 720,
} as const;

export const DEFAULT_STAGEHAND_MODEL_NAME = "google/gemini-3.1-flash-lite-preview";
export const DEFAULT_BROWSERBASE_SESSION_TIMEOUT_SECONDS = 1800;

function browserbaseSessionTimeoutSeconds() {
  const raw = process.env.BROWSERBASE_SESSION_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_BROWSERBASE_SESSION_TIMEOUT_SECONDS;
}

export function createBrowserbaseStagehand() {
  return new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    model: {
      modelName: DEFAULT_STAGEHAND_MODEL_NAME,
      apiKey: process.env.GEMINI_API_KEY,
    },
    browserbaseSessionCreateParams: {
      timeout: browserbaseSessionTimeoutSeconds(),
      browserSettings: {
        recordSession: true,
        viewport: { ...DEFAULT_VIEWPORT },
      },
    },
  });
}

export function browserbaseSessionReplayUrl(sessionId: string | undefined) {
  return sessionId
    ? `https://www.browserbase.com/sessions/${sessionId}`
    : undefined;
}

export function configuredBrowserbaseSessionTimeoutSeconds() {
  return browserbaseSessionTimeoutSeconds();
}
