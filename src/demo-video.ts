import type { Action, Stagehand } from "@browserbasehq/stagehand";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";

type BrowserPage = any;

const DEFAULT_VIEWPORT = {
  width: 1280,
  height: 720,
} as const;

const DEFAULT_OPTIONS = {
  outputDir: path.resolve("output"),
  rawCaptureFps: 30,
  outputFps: 30,
  fastForwardMultiplier: 6,
  movementHoverHoldMs: 120,
  actionSettleMs: 900,
  gotoSettleMs: 1800,
};

const DEFAULT_CAMERA_TRANSITION_MS = 260;
const MIN_CAMERA_TRANSITION_MS = 140;

type CursorKind = "default" | "pointer" | "text";

interface Point {
  x: number;
  y: number;
}

interface Viewport {
  width: number;
  height: number;
}

interface RecordedFrame {
  atMs: number;
  filePath: string;
}

interface CameraKeyframe {
  atMs: number;
  focus: Point;
  scale: number;
}

interface SpeedSegment {
  sourceStartMs: number;
  sourceEndMs: number;
  outputStartMs: number;
  outputEndMs: number;
  speed: number;
}

interface CursorSnapshot {
  visible: boolean;
  kind: CursorKind;
  sourcePoint: Point;
}

interface ClickPulse {
  x: number;
  y: number;
  progress: number;
}

interface RenderPayload {
  imageDataUrl?: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  cursor: {
    visible: boolean;
    kind: CursorKind;
    x: number;
    y: number;
  };
  clickPulse: ClickPulse | null;
}

interface TargetSnapshot {
  point: Point;
  cursor: CursorKind;
}

interface ManualTargetSnapshot extends TargetSnapshot {
  label: string;
}

const CURSOR_SVG_ASSET_PATHS: Record<CursorKind, string> = {
  default: path.resolve("svgs/default.svg"),
  pointer: path.resolve("svgs/handpointing.svg"),
  text: path.resolve("svgs/textcursor.svg"),
};

const CURSOR_HOTSPOTS: Record<CursorKind, Point> = {
  default: { x: 10, y: 7 },
  pointer: { x: 15, y: 8 },
  text: { x: 16, y: 16 },
};

const MANUAL_CLICKABLE_SELECTORS = [
  "button",
  "a[href]",
  "summary",
  "label",
  "option",
  "input[type=\"button\"]",
  "input[type=\"submit\"]",
  "input[type=\"reset\"]",
  "[role=\"button\"]",
  "[role=\"link\"]",
  "[role=\"tab\"]",
  "[role=\"option\"]",
  "[role=\"menuitem\"]",
] as const;

const MANUAL_INPUT_SELECTORS = [
  "input",
  "textarea",
  "[contenteditable]",
  "[role=\"textbox\"]",
  "[role=\"searchbox\"]",
  "[role=\"combobox\"]",
] as const;

interface MoveEvent {
  kind: "pointer-move";
  startMs: number;
  endMs: number;
  stepId?: string;
  from: Point;
  to: Point;
  cp1: Point;
  cp2: Point;
  cursor: CursorKind;
  description: string;
}

interface ClickEvent {
  kind: "click";
  startMs: number;
  endMs: number;
  stepId?: string;
  position: Point;
  cursor: CursorKind;
  description: string;
}

interface TypeEvent {
  kind: "type";
  startMs: number;
  endMs: number;
  stepId?: string;
  position: Point;
  cursor: CursorKind;
  description: string;
  textLength: number;
}

interface ActivityEvent {
  kind: "activity";
  startMs: number;
  endMs: number;
  stepId?: string;
  position: Point;
  cursor: CursorKind;
  description: string;
}

interface PressEvent {
  kind: "press";
  startMs: number;
  endMs: number;
  stepId?: string;
  position: Point;
  cursor: CursorKind;
  description: string;
  key: string;
}

interface PauseEvent {
  kind: "pause";
  startMs: number;
  endMs: number;
  stepId?: string;
  focus: Point;
  scale: number;
  description: string;
  transitionMs?: number;
}

interface NavigateEvent {
  kind: "navigate";
  startMs: number;
  endMs: number;
  stepId?: string;
  url: string;
}

type DemoEvent =
  | MoveEvent
  | ClickEvent
  | TypeEvent
  | ActivityEvent
  | PressEvent
  | PauseEvent
  | NavigateEvent;

export interface DemoGotoStep {
  kind: "goto";
  stepId?: string;
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  settleMs?: number;
}

export interface DemoActStep {
  kind: "act";
  stepId?: string;
  instruction: string;
  text?: string;
  settleMs?: number;
  fallbackTexts?: string[];
  fallbackTargetKind?: "clickable" | "input" | "any";
  observeAttempts?: number;
  optional?: boolean;
}

export interface DemoPressStep {
  kind: "press";
  stepId?: string;
  key: string;
  description?: string;
  settleMs?: number;
}

export interface DemoFocusStep {
  kind: "focus";
  stepId?: string;
  instruction: string;
  seconds: number;
  description?: string;
  scale?: number;
  transitionMs?: number;
  fallbackTexts?: string[];
  fallbackTargetKind?: "clickable" | "input" | "any";
  observeAttempts?: number;
}

export interface DemoPauseStep {
  kind: "pause";
  stepId?: string;
  seconds: number;
  description?: string;
  focus?: "center" | "cursor";
  scale?: number;
  transitionMs?: number;
}

export type DemoStep =
  | DemoGotoStep
  | DemoActStep
  | DemoPressStep
  | DemoFocusStep
  | DemoPauseStep;

export interface DemoRunOptions {
  outputDir?: string;
  viewport?: Viewport;
  rawCaptureFps?: number;
  outputFps?: number;
  fastForwardMultiplier?: number;
  beforeRender?: () => Promise<void> | void;
}

export interface DemoArtifacts {
  rawFramesDir: string;
  renderedFramesDir: string;
  metadataPath: string;
  outputVideoPath: string;
  rawFrameCount: number;
  renderedFrameCount: number;
}

class FrameCapturer {
  private readonly page: BrowserPage;
  private readonly framesDir: string;
  private readonly intervalMs: number;
  private frameIndex = 0;
  private loopPromise: Promise<void> | null = null;
  private running = false;
  private startedAt = 0;
  private frames: RecordedFrame[] = [];

  constructor(page: BrowserPage, framesDir: string, framesPerSecond: number) {
    this.page = page;
    this.framesDir = framesDir;
    this.intervalMs = Math.max(50, Math.round(1000 / framesPerSecond));
  }

  start() {
    this.startedAt = Date.now();
    this.running = true;
    this.loopPromise = this.captureLoop();
  }

  now() {
    return Math.max(0, Date.now() - this.startedAt);
  }

  recordedFrames() {
    return [...this.frames];
  }

  async captureNow() {
    await this.captureFrame();
  }

  async stop() {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
    }
  }

  private async captureLoop() {
    while (this.running) {
      const started = Date.now();
      await this.captureFrame();
      const elapsed = Date.now() - started;
      await sleep(Math.max(0, this.intervalMs - elapsed));
    }
  }

  private async captureFrame() {
    const buffer = await this.page.screenshot({
      scale: "css",
      type: "png",
    });
    const filePath = path.join(
      this.framesDir,
      `frame_${String(this.frameIndex).padStart(5, "0")}.png`
    );
    fs.writeFileSync(filePath, buffer);
    this.frames.push({
      atMs: this.now(),
      filePath,
    });
    this.frameIndex += 1;
  }
}

class DemoTimelineRecorder {
  private readonly page: BrowserPage;
  private readonly stagehand: Stagehand;
  private readonly viewport: Viewport;
  private readonly events: DemoEvent[] = [];
  private readonly options: typeof DEFAULT_OPTIONS;
  private readonly capturer: FrameCapturer;
  private cursorPosition: Point;
  private currentCursorKind: CursorKind;

  constructor(args: {
    page: BrowserPage;
    stagehand: Stagehand;
    viewport: Viewport;
    capturer: FrameCapturer;
    options: typeof DEFAULT_OPTIONS;
  }) {
    this.page = args.page;
    this.stagehand = args.stagehand;
    this.viewport = args.viewport;
    this.capturer = args.capturer;
    this.options = args.options;
    this.cursorPosition = {
      x: Math.round(this.viewport.width * 0.9),
      y: Math.round(this.viewport.height * 0.88),
    };
    this.currentCursorKind = "default";
  }

  allEvents() {
    return [...this.events];
  }

  async runStep(step: DemoStep) {
    if (step.kind === "goto") {
      await this.runGoto(step);
      return;
    }
    if (step.kind === "focus") {
      await this.runFocus(step);
      return;
    }
    if (step.kind === "pause") {
      await this.runPause(step);
      return;
    }
    if (step.kind === "press") {
      await this.runPress(step);
      return;
    }
    await this.runAct(step);
  }

  private async runGoto(step: DemoGotoStep) {
    const startMs = this.capturer.now();
    await this.page.goto(step.url, {
      waitUntil: step.waitUntil ?? "domcontentloaded",
    });
    await wait(this.page, step.settleMs ?? this.options.gotoSettleMs);
    await this.capturer.captureNow();
    this.events.push({
      kind: "navigate",
      startMs,
      endMs: this.capturer.now(),
      stepId: step.stepId,
      url: step.url,
    });
  }

  private async runAct(step: DemoActStep) {
    try {
      await this.runActInternal(step);
    } catch (error) {
      if (!step.optional) {
        throw error;
      }
      console.warn("Optional act step failed, continuing.", {
        stepId: step.stepId,
        instruction: step.instruction,
        error: formatErrorForLog(error),
      });
      await this.capturer.captureNow().catch(() => undefined);
    }
  }

  private async runActInternal(step: DemoActStep) {
    if (/\bscroll\b/i.test(step.instruction)) {
      await this.runFallbackActivity(
        step.instruction,
        this.cursorPosition,
        "default",
        async () => {
          await this.stagehand.act(step.instruction, { page: this.page });
        },
        step.settleMs,
        step.stepId,
      );
      return;
    }

    const resolved = await this.resolveTargetForStep(step);
    if (!resolved) {
      if (step.optional) {
        console.warn("Optional act step target not found, skipping.", {
          stepId: step.stepId,
          instruction: step.instruction,
          fallbackTexts: step.fallbackTexts,
        });
        await this.capturer.captureNow().catch(() => undefined);
        return;
      }
      await this.runFallbackActivity(
        step.instruction,
        this.cursorPosition,
        step.text ? "text" : "pointer",
        async () => {
          await this.stagehand.act(step.instruction, { page: this.page });
        },
        step.settleMs,
        step.stepId,
      );
      return;
    }

    if (!resolved.action) {
      if (step.text) {
        await this.performPointType(
          resolved.target,
          step.text,
          resolved.description,
          step.settleMs,
          step.stepId,
        );
        return;
      }

      await this.performPointClick(
        resolved.target,
        resolved.description,
        step.settleMs,
        step.stepId,
      );
      return;
    }

    const { action, target, description } = resolved;
    const method = normalizeMethod(action.method);
    if (method.includes("scroll") || method === "wait") {
      await this.runFallbackActivity(
        description,
        this.cursorPosition,
        "default",
        async () => {
          await this.stagehand.act(step.instruction, { page: this.page });
        },
        step.settleMs,
        step.stepId,
      );
      return;
    }

    const locator = this.page.deepLocator(action.selector);

    await this.moveCursorTo(target.point, target.cursor, description, step.stepId);
    await wait(this.page, this.options.movementHoverHoldMs);

    if (method === "click" || method === "") {
      await this.performClick(
        locator,
        target,
        description,
        step.settleMs,
        step.stepId,
      );
      return;
    }

    if ((method === "fill" || method === "type") && !step.text && !action.arguments?.[0]) {
      await this.performClick(
        locator,
        target,
        description,
        step.settleMs,
        step.stepId,
      );
      return;
    }

    if ((method === "fill" || method === "type") && (step.text || action.arguments?.[0])) {
      await this.performType(
        locator,
        target,
        step.text ?? action.arguments?.[0] ?? "",
        description,
        step.settleMs,
        step.stepId,
      );
      return;
    }

    if (method === "hover") {
      const hoverStartedAt = this.capturer.now();
      await locator.hover();
      await wait(this.page, step.settleMs ?? this.options.actionSettleMs);
      await this.capturer.captureNow();
      this.events.push({
        kind: "activity",
        startMs: hoverStartedAt,
        endMs: this.capturer.now(),
        stepId: step.stepId,
        position: target.point,
        cursor: target.cursor,
        description,
      });
      return;
    }

    await this.runFallbackActivity(
      description,
      target.point,
      target.cursor,
      async () => {
        await this.stagehand.act(step.instruction, { page: this.page });
      },
      step.settleMs,
      step.stepId,
    );
  }

  private async runFocus(step: DemoFocusStep) {
    const resolved = await this.resolveTargetForStep(step);
    const target = resolved?.target ?? {
      point: this.cursorPosition,
      cursor: this.currentCursorKind,
    };
    const description =
      step.description ??
      resolved?.description ??
      `Focus on ${step.instruction}`;

    await this.moveCursorTo(target.point, target.cursor, description, step.stepId);
    await wait(this.page, this.options.movementHoverHoldMs);

    const startMs = this.capturer.now();
    await wait(this.page, step.seconds * 1000);
    await this.capturer.captureNow();
    this.events.push({
      kind: "pause",
      startMs,
      endMs: this.capturer.now(),
      stepId: step.stepId,
      focus: target.point,
      scale: step.scale ?? 1,
      description,
      transitionMs: step.transitionMs,
    });
  }

  private async runPress(step: DemoPressStep) {
    const startMs = this.capturer.now();
    await this.page.keyPress(step.key);
    await wait(this.page, step.settleMs ?? this.options.actionSettleMs);
    await this.capturer.captureNow();
    this.events.push({
      kind: "press",
      startMs,
      endMs: this.capturer.now(),
      stepId: step.stepId,
      position: this.cursorPosition,
      cursor: this.currentCursorKind,
      description: step.description ?? `Press ${step.key}`,
      key: step.key,
    });
  }

  private async runPause(step: DemoPauseStep) {
    const startMs = this.capturer.now();
    const focus =
      step.focus === "center"
        ? {
            x: Math.round(this.viewport.width / 2),
            y: Math.round(this.viewport.height / 2),
          }
        : { ...this.cursorPosition };

    await wait(this.page, step.seconds * 1000);
    await this.capturer.captureNow();
    this.events.push({
      kind: "pause",
      startMs,
      endMs: this.capturer.now(),
      stepId: step.stepId,
      focus,
      scale: step.scale ?? 1,
      description:
        step.description ?? `Pause for ${step.seconds.toFixed(1)} second(s)`,
      transitionMs: step.transitionMs,
    });
  }

  private async observeActionWithRetries(step: DemoActStep | DemoFocusStep) {
    const attempts = Math.max(1, step.observeAttempts ?? 3);
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const observed = (await this.stagehand.observe(step.instruction, {
          page: this.page,
        })) as Action[];
        const action = pickBestAction(observed, step);
        if (action) {
          return action;
        }
      } catch (error) {
        lastError = error;
      }

      if (attempt < attempts - 1) {
        await wait(this.page, 1200 * (attempt + 1));
      }
    }

    if (lastError) {
      console.warn("observe() failed, falling back:", lastError);
    }

    return null;
  }

  private async resolveTargetForStep(step: DemoActStep | DemoFocusStep) {
    const action = await this.observeActionWithRetries(step);
    if (action) {
      const locator = this.page.deepLocator(action.selector);
      const target = await getTargetSnapshot(
        this.page,
        locator,
        action,
        this.viewport,
      );
      return {
        action,
        target,
        description: action.description || step.instruction,
      };
    }

    const manualTarget = step.fallbackTexts?.length
      ? await findManualTargetByText(this.page, {
          texts: step.fallbackTexts,
          targetKind:
            step.fallbackTargetKind ??
            ("text" in step && step.text ? "input" : "clickable"),
          viewport: this.viewport,
        })
      : null;

    if (manualTarget) {
      return {
        action: null,
        target: manualTarget,
        description: manualTarget.label || step.instruction,
      };
    }

    const debugSummary = await summarizeVisibleTargets(this.page).catch(
      () => undefined,
    );
    if (debugSummary) {
      console.warn("No observed action or manual fallback target found.", {
        instruction: step.instruction,
        summary: debugSummary,
      });
    }

    return null;
  }

  private async moveCursorTo(
    targetPoint: Point,
    cursor: CursorKind,
    description: string,
    stepId?: string,
  ) {
    const distance = Math.hypot(
      targetPoint.x - this.cursorPosition.x,
      targetPoint.y - this.cursorPosition.y,
    );
    if (distance < 1 && cursor === this.currentCursorKind) {
      this.cursorPosition = targetPoint;
      return;
    }

    const durationMs = computeMovementDurationMs(this.cursorPosition, targetPoint);
    const curve = buildBezierCurve(
      this.cursorPosition,
      targetPoint,
      this.events.filter((event) => event.kind === "pointer-move").length
    );
    const startMs = this.capturer.now();
    await wait(this.page, durationMs);
    const endMs = this.capturer.now();
    this.events.push({
      kind: "pointer-move",
      startMs,
      endMs,
      stepId,
      from: this.cursorPosition,
      to: targetPoint,
      cp1: curve.cp1,
      cp2: curve.cp2,
      cursor,
      description,
    });
    this.cursorPosition = targetPoint;
    this.currentCursorKind = cursor;
  }

  private async performClick(
    locator: any,
    target: TargetSnapshot,
    description: string,
    settleMs?: number,
    stepId?: string,
  ) {
    await locator.hover().catch(() => undefined);
    const clickStartedAt = this.capturer.now();
    await locator.click();
    this.events.push({
      kind: "click",
      startMs: clickStartedAt,
      endMs: clickStartedAt + 220,
      stepId,
      position: target.point,
      cursor: target.cursor,
      description,
    });
    this.currentCursorKind = target.cursor;
    await wait(this.page, settleMs ?? this.options.actionSettleMs);
    await this.capturer.captureNow();
  }

  private async performType(
    locator: any,
    target: TargetSnapshot,
    text: string,
    description: string,
    settleMs?: number,
    stepId?: string,
  ) {
    await locator.click();
    const clickStartedAt = this.capturer.now();
    this.events.push({
      kind: "click",
      startMs: clickStartedAt,
      endMs: clickStartedAt + 220,
      stepId,
      position: target.point,
      cursor: "text",
      description,
    });

    await this.page.keyPress("Ctrl+A").catch(() => undefined);
    await this.page.keyPress("Backspace").catch(() => undefined);

    const typeStartedAt = this.capturer.now();
    await locator.type(text, { delay: 70 });
    this.events.push({
      kind: "type",
      startMs: typeStartedAt,
      endMs: this.capturer.now(),
      stepId,
      position: target.point,
      cursor: "text",
      description,
      textLength: text.length,
    });
    this.currentCursorKind = "text";
    await wait(this.page, settleMs ?? this.options.actionSettleMs);
    await this.capturer.captureNow();
  }

  private async performPointClick(
    target: TargetSnapshot,
    description: string,
    settleMs?: number,
    stepId?: string,
  ) {
    await this.moveCursorTo(target.point, target.cursor, description, stepId);
    await wait(this.page, this.options.movementHoverHoldMs);
    await this.page.hover(target.point.x, target.point.y).catch(() => undefined);
    const clickStartedAt = this.capturer.now();
    await this.page.click(target.point.x, target.point.y);
    this.events.push({
      kind: "click",
      startMs: clickStartedAt,
      endMs: clickStartedAt + 220,
      stepId,
      position: target.point,
      cursor: target.cursor,
      description,
    });
    this.currentCursorKind = target.cursor;
    await wait(this.page, settleMs ?? this.options.actionSettleMs);
    await this.capturer.captureNow();
  }

  private async performPointType(
    target: TargetSnapshot,
    text: string,
    description: string,
    settleMs?: number,
    stepId?: string,
  ) {
    await this.moveCursorTo(target.point, target.cursor, description, stepId);
    await wait(this.page, this.options.movementHoverHoldMs);
    await this.page.click(target.point.x, target.point.y);
    const clickStartedAt = this.capturer.now();
    this.events.push({
      kind: "click",
      startMs: clickStartedAt,
      endMs: clickStartedAt + 220,
      stepId,
      position: target.point,
      cursor: "text",
      description,
    });

    await this.page.keyPress("Ctrl+A").catch(() => undefined);
    await this.page.keyPress("Backspace").catch(() => undefined);

    const typeStartedAt = this.capturer.now();
    await this.page.type(text, { delay: 70 });
    this.events.push({
      kind: "type",
      startMs: typeStartedAt,
      endMs: this.capturer.now(),
      stepId,
      position: target.point,
      cursor: "text",
      description,
      textLength: text.length,
    });
    this.currentCursorKind = "text";
    await wait(this.page, settleMs ?? this.options.actionSettleMs);
    await this.capturer.captureNow();
  }

  private async runFallbackActivity(
    description: string,
    position: Point,
    cursor: CursorKind,
    run: () => Promise<void>,
    settleMs?: number,
    stepId?: string,
  ) {
    const startMs = this.capturer.now();
    await run();
    await wait(this.page, settleMs ?? this.options.actionSettleMs);
    await this.capturer.captureNow();
    this.events.push({
      kind: "activity",
      startMs,
      endMs: this.capturer.now(),
      stepId,
      position,
      cursor,
      description,
    });
    this.currentCursorKind = cursor;
  }
}

async function clearBrowserSessionCache(page: BrowserPage) {
  if (!page || typeof page.sendCDP !== "function") {
    return;
  }

  await page.sendCDP("Network.enable").catch(() => undefined);
  await page.sendCDP("Network.clearBrowserCache").catch(() => undefined);
  await page.sendCDP("Network.clearBrowserCookies").catch(() => undefined);
}

export async function runStagehandDemo(
  stagehand: Stagehand,
  steps: DemoStep[],
  options: DemoRunOptions = {}
): Promise<DemoArtifacts> {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const outputDir = merged.outputDir;
  const rawFramesDir = path.join(outputDir, "raw-frames");
  const renderedFramesDir = path.join(outputDir, "rendered-frames");
  const metadataPath = path.join(outputDir, "demo-metadata.json");
  const outputVideoPath = path.join(outputDir, "demo.mp4");

  resetDir(outputDir);
  resetDir(rawFramesDir);
  resetDir(renderedFramesDir);

  const page = stagehand.context.pages()[0];
  await clearBrowserSessionCache(page);
  await page.setViewportSize(viewport.width, viewport.height, {
    deviceScaleFactor: 1,
  });

  const capturer = new FrameCapturer(page, rawFramesDir, merged.rawCaptureFps);
  capturer.start();

  const recorder = new DemoTimelineRecorder({
    page,
    stagehand,
    viewport,
    capturer,
    options: merged,
  });

  try {
    for (const step of steps) {
      await recorder.runStep(step);
    }
    await capturer.captureNow();
  } finally {
    await capturer.stop();
  }

  const rawFrames = capturer.recordedFrames();
  if (rawFrames.length === 0) {
    throw new Error("No raw frames were captured.");
  }
  console.log(`[demo-video] Captured ${rawFrames.length} raw frame(s).`);

  const events = recorder.allEvents();
  const sourceDurationMs = Math.max(
    rawFrames.at(-1)?.atMs ?? 0,
    ...events.map((event) => event.endMs)
  );

  const speedSegments = buildSpeedSegments({
    sourceDurationMs,
    events,
    fastForwardMultiplier: merged.fastForwardMultiplier,
  });
  const cameraKeyframes = buildCameraKeyframes({
    sourceDurationMs,
    events,
    viewport,
    initialFocus: {
      x: viewport.width / 2,
      y: viewport.height / 2,
    },
  });

  if (typeof options.beforeRender === "function") {
    console.log("[demo-video] Running pre-render cleanup...");
    await options.beforeRender();
  }

  const renderedFrameCount = await renderCompositedFrames({
    rawFrames,
    renderedFramesDir,
    viewport,
    events,
    speedSegments,
    cameraKeyframes,
    outputFps: merged.outputFps,
  });
  console.log(
    `[demo-video] Rendered ${renderedFrameCount} composited frame(s).`,
  );

  writeMetadata(metadataPath, {
    viewport,
    rawFrames,
    events,
    speedSegments,
    cameraKeyframes,
    sourceDurationMs,
    outputDurationMs: speedSegments.at(-1)?.outputEndMs ?? 0,
  });

  console.log("[demo-video] Encoding final polished video...");
  encodeVideo(renderedFramesDir, outputVideoPath, merged.outputFps);

  return {
    rawFramesDir,
    renderedFramesDir,
    metadataPath,
    outputVideoPath,
    rawFrameCount: rawFrames.length,
    renderedFrameCount,
  };
}

async function renderCompositedFrames(args: {
  rawFrames: RecordedFrame[];
  renderedFramesDir: string;
  viewport: Viewport;
  events: DemoEvent[];
  speedSegments: SpeedSegment[];
  cameraKeyframes: CameraKeyframe[];
  outputFps: number;
}) {
  const {
    rawFrames,
    renderedFramesDir,
    viewport,
    events,
    speedSegments,
    cameraKeyframes,
    outputFps,
  } = args;

  const { composerBrowser, composerPage } = await launchLocalComposer(viewport);

  try {
    const outputDurationMs = speedSegments.at(-1)?.outputEndMs ?? 0;
    const outputFrameCount = Math.max(
      1,
      Math.ceil((outputDurationMs / 1000) * outputFps)
    );
    console.log(
      `[demo-video] Rendering ${outputFrameCount} composited frame(s) at ${outputFps} fps...`,
    );

    const dataUrlCache = new Map<string, string>();
    let previousRawFramePath = "";
    const renderStartedAt = Date.now();

    for (let frameIndex = 0; frameIndex < outputFrameCount; frameIndex += 1) {
      const outputTimeMs = (frameIndex * 1000) / outputFps;
      const sourceTimeMs = mapOutputToSourceTime(speedSegments, outputTimeMs);
      const rawFrame = pickRawFrame(rawFrames, sourceTimeMs);
      const cursor = sampleCursor(events, sourceTimeMs, viewport);
      const camera = sampleCamera(cameraKeyframes, sourceTimeMs, viewport);
      const offset = computeCameraOffset(camera.focus, camera.scale, viewport);
      const screenPoint = {
        x: offset.x + cursor.sourcePoint.x * camera.scale,
        y: offset.y + cursor.sourcePoint.y * camera.scale,
      };

      const payload: RenderPayload = {
        scale: camera.scale,
        offsetX: offset.x,
        offsetY: offset.y,
        cursor: {
          visible: cursor.visible,
          kind: cursor.kind,
          x: screenPoint.x,
          y: screenPoint.y,
        },
        clickPulse: sampleClickPulse(events, sourceTimeMs, camera.scale, offset),
      };

      if (rawFrame.filePath !== previousRawFramePath) {
        payload.imageDataUrl = getImageDataUrl(rawFrame.filePath, dataUrlCache);
        previousRawFramePath = rawFrame.filePath;
      }

      await composerPage.evaluate(async (state: RenderPayload) => {
        const render = (window as any).__renderFrame;
        await render(state);
      }, payload);

      const screenshot = await composerPage.screenshot({
        scale: "css",
        type: "png",
      });
      const outputFramePath = path.join(
        renderedFramesDir,
        `frame_${String(frameIndex).padStart(5, "0")}.png`
      );
      fs.writeFileSync(outputFramePath, screenshot);

      if (
        frameIndex === 0 ||
        frameIndex === outputFrameCount - 1 ||
        (frameIndex + 1) % 120 === 0
      ) {
        const elapsedSeconds = Math.max(1, (Date.now() - renderStartedAt) / 1000);
        const framesDone = frameIndex + 1;
        const framesPerSecond = framesDone / elapsedSeconds;
        const remainingSeconds = Math.max(
          0,
          (outputFrameCount - framesDone) / Math.max(framesPerSecond, 0.01),
        );
        console.log(
          `[demo-video] Render progress: ${framesDone}/${outputFrameCount} (${framesPerSecond.toFixed(2)} fps, eta ${remainingSeconds.toFixed(0)}s)`,
        );
      }
    }

    return outputFrameCount;
  } finally {
    await composerPage.close().catch(() => undefined);
    await composerBrowser.close().catch(() => undefined);
  }
}

async function launchLocalComposer(viewport: Viewport) {
  const defaultPath =
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/usr/bin/google-chrome-stable";

  const executablePath =
    process.env.LOCAL_CHROME_PATH ||
    process.env.GOOGLE_CHROME_BIN ||
    defaultPath;

  if (!fs.existsSync(executablePath)) {
    throw new Error(
      `Local Chrome executable not found at ${executablePath}. Set LOCAL_CHROME_PATH or GOOGLE_CHROME_BIN.`,
    );
  }

  console.log(
    `[demo-video] Launching local compositor with ${executablePath}...`,
  );

  const composerBrowser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-breakpad",
      "--disable-crash-reporter",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--mute-audio",
    ],
  });
  const composerPage = await composerBrowser.newPage({
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
    deviceScaleFactor: 1,
  });
  await composerPage.goto(buildComposerDataUrl());
  await composerPage.waitForTimeout(100);

  return {
    composerBrowser,
    composerPage,
  };
}

function buildSpeedSegments(args: {
  sourceDurationMs: number;
  events: DemoEvent[];
  fastForwardMultiplier: number;
}) {
  const { sourceDurationMs, events, fastForwardMultiplier } = args;
  const windows = mergeWindows(
    events
      .filter((event) => event.kind !== "navigate")
      .map((event) => ({
        startMs: Math.max(0, event.startMs - 180),
        endMs: Math.min(sourceDurationMs, event.endMs + 420),
      }))
  );

  const segments: SpeedSegment[] = [];
  let cursor = 0;
  let outputCursor = 0;

  const pushSegment = (sourceStartMs: number, sourceEndMs: number, speed: number) => {
    if (sourceEndMs <= sourceStartMs) {
      return;
    }
    const outputStartMs = outputCursor;
    const outputEndMs =
      outputStartMs + (sourceEndMs - sourceStartMs) / Math.max(1, speed);
    segments.push({
      sourceStartMs,
      sourceEndMs,
      outputStartMs,
      outputEndMs,
      speed,
    });
    outputCursor = outputEndMs;
  };

  for (const window of windows) {
    if (window.startMs > cursor) {
      const idleDurationMs = window.startMs - cursor;
      pushSegment(
        cursor,
        window.startMs,
        idleDurationMs >= 1400 ? fastForwardMultiplier : 1
      );
    }
    pushSegment(window.startMs, window.endMs, 1);
    cursor = window.endMs;
  }

  if (cursor < sourceDurationMs) {
    const idleDurationMs = sourceDurationMs - cursor;
    pushSegment(
      cursor,
      sourceDurationMs,
      idleDurationMs >= 1400 ? fastForwardMultiplier : 1
    );
  }

  if (segments.length === 0) {
    return [
      {
        sourceStartMs: 0,
        sourceEndMs: sourceDurationMs,
        outputStartMs: 0,
        outputEndMs: sourceDurationMs,
        speed: 1,
      },
    ];
  }

  return segments;
}

function buildCameraKeyframes(args: {
  sourceDurationMs: number;
  events: DemoEvent[];
  viewport: Viewport;
  initialFocus: Point;
}) {
  const { sourceDurationMs, events, viewport, initialFocus } = args;
  const keyframes: CameraKeyframe[] = [];
  const pauseEvents = events.filter(
    (event): event is PauseEvent => event.kind === "pause",
  );

  const pushKeyframe = (atMs: number, focus: Point, scale: number) => {
    const previousAt = keyframes.at(-1)?.atMs ?? -1;
    keyframes.push({
      atMs: atMs <= previousAt ? previousAt + 1 : atMs,
      focus: clampPointToViewport(focus, viewport),
      scale,
    });
  };

  pushKeyframe(0, initialFocus, 1);

  if (pauseEvents.length > 0) {
    let currentFocus = initialFocus;
    let currentScale = 1;

    for (const event of pauseEvents) {
      const transitionEndMs = Math.min(
        event.endMs,
        event.startMs + resolvePauseTransitionMs(event),
      );
      pushKeyframe(event.startMs, currentFocus, currentScale);
      pushKeyframe(transitionEndMs, event.focus, event.scale);
      pushKeyframe(event.endMs, event.focus, event.scale);
      currentFocus = event.focus;
      currentScale = event.scale;
    }

    pushKeyframe(sourceDurationMs, currentFocus, currentScale);
    return keyframes;
  }

  for (const event of events) {
    if (event.kind === "pointer-move") {
      pushKeyframe(event.startMs, event.from, 1.0);
      pushKeyframe(event.endMs, event.to, 1.05);
      continue;
    }

    if (event.kind === "click") {
      pushKeyframe(event.startMs, event.position, 1.08);
      pushKeyframe(event.endMs + 120, event.position, 1.13);
      pushKeyframe(event.endMs + 650, event.position, 1.02);
      continue;
    }

    if (event.kind === "type") {
      pushKeyframe(event.startMs, event.position, 1.1);
      pushKeyframe(event.endMs + 120, event.position, 1.16);
      pushKeyframe(event.endMs + 650, event.position, 1.02);
      continue;
    }

    if (event.kind === "activity" || event.kind === "press") {
      pushKeyframe(event.startMs, event.position, 1.05);
      pushKeyframe(event.endMs + 450, event.position, 1.0);
      continue;
    }

    if (event.kind === "pause") {
      pushKeyframe(event.startMs, event.focus, event.scale);
      pushKeyframe(event.endMs, event.focus, event.scale);
    }
  }

  pushKeyframe(sourceDurationMs, keyframes.at(-1)?.focus ?? initialFocus, 1);
  return keyframes;
}

function resolvePauseTransitionMs(event: PauseEvent) {
  const durationMs = Math.max(0, event.endMs - event.startMs);
  const requested =
    event.transitionMs ??
    Math.min(
      DEFAULT_CAMERA_TRANSITION_MS,
      Math.max(MIN_CAMERA_TRANSITION_MS, Math.round(durationMs * 0.25))
    );

  return Math.min(durationMs, requested);
}

function sampleCamera(
  keyframes: CameraKeyframe[],
  sourceTimeMs: number,
  viewport: Viewport
) {
  const previous = findPreviousKeyframe(keyframes, sourceTimeMs);
  const next = findNextKeyframe(keyframes, sourceTimeMs);

  if (!previous || !next || previous.atMs === next.atMs) {
    return {
      focus: clampPointToViewport(previous?.focus ?? keyframes[0].focus, viewport),
      scale: previous?.scale ?? 1,
    };
  }

  const progress = clamp01(
    (sourceTimeMs - previous.atMs) / (next.atMs - previous.atMs)
  );
  const eased = easeSmootherStep(progress);

  const focus = {
    x: lerp(previous.focus.x, next.focus.x, eased),
    y: lerp(previous.focus.y, next.focus.y, eased),
  };

  return {
    focus: clampPointToViewport(focus, viewport),
    scale: lerp(previous.scale, next.scale, eased),
  };
}

function sampleCursor(
  events: DemoEvent[],
  sourceTimeMs: number,
  viewport: Viewport
): CursorSnapshot {
  const firstPointerEvent = events.find((event) => event.kind !== "navigate");
  const visible = firstPointerEvent ? sourceTimeMs >= firstPointerEvent.startMs - 80 : false;

  let sourcePoint: Point = {
    x: Math.round(viewport.width * 0.9),
    y: Math.round(viewport.height * 0.88),
  };
  let kind: CursorKind = "default";

  for (const event of events) {
    if (event.kind === "pointer-move") {
      if (sourceTimeMs < event.startMs) {
        break;
      }
      if (sourceTimeMs <= event.endMs) {
        const moveProgress = clamp01(
          (sourceTimeMs - event.startMs) / Math.max(1, event.endMs - event.startMs)
        );
        sourcePoint = cubicBezierPoint(
          event.from,
          event.cp1,
          event.cp2,
          event.to,
          easeInOutCubic(moveProgress)
        );
        kind = event.cursor;
        return {
          visible,
          kind,
          sourcePoint,
        };
      }
      sourcePoint = event.to;
      kind = event.cursor;
      continue;
    }

    if (
      event.kind === "click" ||
      event.kind === "type" ||
      event.kind === "activity" ||
      event.kind === "press"
    ) {
      if (sourceTimeMs >= event.startMs) {
        sourcePoint = event.position;
        kind = event.cursor;
      }
    }
  }

  return {
    visible,
    kind,
    sourcePoint,
  };
}

function sampleClickPulse(
  events: DemoEvent[],
  sourceTimeMs: number,
  scale: number,
  offset: Point
) {
  const clickEvent = [...events]
    .reverse()
    .find(
      (event) =>
        event.kind === "click" &&
        sourceTimeMs >= event.startMs &&
        sourceTimeMs <= event.endMs + 260
    ) as ClickEvent | undefined;

  if (!clickEvent) {
    return null;
  }

  const durationMs = 320;
  const progress = clamp01((sourceTimeMs - clickEvent.startMs) / durationMs);
  return {
    x: offset.x + clickEvent.position.x * scale,
    y: offset.y + clickEvent.position.y * scale,
    progress,
  };
}

function mapOutputToSourceTime(speedSegments: SpeedSegment[], outputTimeMs: number) {
  const segment =
    speedSegments.find(
      (candidate) =>
        outputTimeMs >= candidate.outputStartMs &&
        outputTimeMs <= candidate.outputEndMs
    ) ?? speedSegments.at(-1);

  if (!segment) {
    return 0;
  }

  return clamp(
    segment.sourceStartMs +
      (outputTimeMs - segment.outputStartMs) * segment.speed,
    segment.sourceStartMs,
    segment.sourceEndMs
  );
}

function pickRawFrame(rawFrames: RecordedFrame[], sourceTimeMs: number) {
  let best = rawFrames[0];
  let bestDistance = Math.abs(rawFrames[0].atMs - sourceTimeMs);

  for (const frame of rawFrames) {
    const distance = Math.abs(frame.atMs - sourceTimeMs);
    if (distance <= bestDistance) {
      best = frame;
      bestDistance = distance;
      continue;
    }
    if (frame.atMs > sourceTimeMs && distance > bestDistance) {
      break;
    }
  }

  return best;
}

function computeCameraOffset(focus: Point, scale: number, viewport: Viewport) {
  const minOffsetX = viewport.width - viewport.width * scale;
  const minOffsetY = viewport.height - viewport.height * scale;

  return {
    x: clamp(viewport.width / 2 - focus.x * scale, minOffsetX, 0),
    y: clamp(viewport.height / 2 - focus.y * scale, minOffsetY, 0),
  };
}

function getImageDataUrl(filePath: string, cache: Map<string, string>) {
  const cached = cache.get(filePath);
  if (cached) {
    return cached;
  }

  const buffer = fs.readFileSync(filePath);
  const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
  cache.set(filePath, dataUrl);
  return dataUrl;
}

function readCursorSvgAssets() {
  return {
    default: fs.readFileSync(CURSOR_SVG_ASSET_PATHS.default, "utf8").trim(),
    pointer: fs.readFileSync(CURSOR_SVG_ASSET_PATHS.pointer, "utf8").trim(),
    text: fs.readFileSync(CURSOR_SVG_ASSET_PATHS.text, "utf8").trim(),
  };
}

function buildComposerDataUrl() {
  const cursorSvgs = readCursorSvgAssets();
  const hotspots = CURSOR_HOTSPOTS;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Demo Composer</title>
    <style>
      :root {
        color-scheme: dark;
      }

      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #050816;
      }

      body {
        display: grid;
        place-items: center;
      }

      #viewport {
        position: relative;
        width: 1280px;
        height: 720px;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(39, 68, 120, 0.28), transparent 40%),
          linear-gradient(180deg, #0f172a 0%, #050816 100%);
      }

      #stage {
        position: absolute;
        inset: 0;
        transform-origin: 0 0;
        will-change: transform;
      }

      #shot {
        display: block;
        width: 1280px;
        height: 720px;
        user-select: none;
        -webkit-user-drag: none;
      }

      #cursor {
        position: absolute;
        inset: 0 auto auto 0;
        width: 0;
        height: 0;
        pointer-events: none;
        z-index: 20;
        will-change: transform;
      }

      #cursor svg {
        display: block;
        filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.38));
      }

      #pulse {
        position: absolute;
        inset: 0 auto auto 0;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.92);
        pointer-events: none;
        opacity: 0;
        z-index: 10;
        will-change: transform, opacity;
      }
    </style>
  </head>
  <body>
    <div id="viewport">
      <div id="stage">
        <img id="shot" alt="" />
      </div>
      <div id="pulse"></div>
      <div id="cursor"></div>
    </div>
    <script>
      const cursorSvgs = ${JSON.stringify(cursorSvgs)};
      const hotspots = ${JSON.stringify(hotspots)};

      const shot = document.getElementById("shot");
      const stage = document.getElementById("stage");
      const cursor = document.getElementById("cursor");
      const pulse = document.getElementById("pulse");

      window.__renderFrame = async (state) => {
        if (state.imageDataUrl) {
          await new Promise((resolve) => {
            const done = () => {
              shot.removeEventListener("load", done);
              resolve();
            };

            shot.addEventListener("load", done, { once: true });
            shot.src = state.imageDataUrl;
            if (shot.complete) {
              shot.removeEventListener("load", done);
              resolve();
            }
          });
        }

        stage.style.transform = "translate(" + state.offsetX + "px, " + state.offsetY + "px) scale(" + state.scale + ")";

        if (state.cursor.visible) {
          const kind = state.cursor.kind in cursorSvgs ? state.cursor.kind : "default";
          const hotspot = hotspots[kind];
          cursor.style.display = "block";
          cursor.style.transform = "translate(" + (state.cursor.x - hotspot.x) + "px, " + (state.cursor.y - hotspot.y) + "px)";
          cursor.innerHTML = cursorSvgs[kind];
        } else {
          cursor.style.display = "none";
        }

        if (state.clickPulse) {
          const alpha = 1 - state.clickPulse.progress;
          const scale = 0.55 + state.clickPulse.progress * 1.6;
          pulse.style.opacity = String(alpha);
          pulse.style.transform =
            "translate(" +
            (state.clickPulse.x - 17) +
            "px, " +
            (state.clickPulse.y - 17) +
            "px) scale(" +
            scale +
            ")";
        } else {
          pulse.style.opacity = "0";
        }

        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      };
    </script>
  </body>
</html>`;

  return `data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`;
}

async function getTargetSnapshot(
  page: BrowserPage,
  locator: any,
  action: Action,
  viewport: Viewport
): Promise<TargetSnapshot> {
  try {
    const point = await locator.centroid();
    const domSnapshot = await page.evaluate(
      ({ x, y }: Point) => {
        const element = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!element) {
          return {
            tag: "",
            role: "",
            cursor: "",
            isContentEditable: false,
            inputType: "",
          };
        }

        const computed = window.getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") ?? "",
          cursor: computed.cursor ?? "",
          isContentEditable: element.isContentEditable,
          inputType:
            element instanceof HTMLInputElement ? element.type.toLowerCase() : "",
        };
      },
      point
    );

    return {
      point: clampPointToViewport(point, viewport),
      cursor: inferCursorKind(action, domSnapshot),
    };
  } catch {
    return {
      point: {
        x: Math.round(viewport.width / 2),
        y: Math.round(viewport.height / 2),
      },
      cursor: inferCursorKind(action, null),
    };
  }
}

function getManualTargetSelectors(
  targetKind: "clickable" | "input" | "any"
) {
  if (targetKind === "clickable") {
    return [...MANUAL_CLICKABLE_SELECTORS];
  }
  if (targetKind === "input") {
    return [...MANUAL_INPUT_SELECTORS];
  }
  return [...new Set([...MANUAL_CLICKABLE_SELECTORS, ...MANUAL_INPUT_SELECTORS])];
}

function isManualInputSelector(selector: string) {
  return MANUAL_INPUT_SELECTORS.includes(selector as (typeof MANUAL_INPUT_SELECTORS)[number]);
}

function scoreManualTargetMatch(values: string[], textNeedles: string[]) {
  let score = 0;
  let label = "";

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) {
      continue;
    }

    const normalized = value.toLowerCase();
    for (const needle of textNeedles) {
      if (normalized === needle) {
        return {
          score: 1000 + needle.length,
          label: value,
        };
      }

      let candidateScore = 0;
      if (normalized.startsWith(needle)) {
        candidateScore = 800 + needle.length;
      } else if (normalized.includes(needle)) {
        candidateScore = 600 + needle.length;
      } else if (needle.includes(normalized) && normalized.length >= 4) {
        candidateScore = 400 + normalized.length;
      }

      if (candidateScore > score) {
        score = candidateScore;
        label = value;
      }
    }
  }

  return {
    score,
    label,
  };
}

function formatErrorForLog(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function findManualTargetByLocator(
  page: BrowserPage,
  args: {
    texts: string[];
    targetKind: "clickable" | "input" | "any";
    viewport: Viewport;
    selectors: string[];
  }
): Promise<ManualTargetSnapshot | null> {
  const textNeedles = args.texts
    .map((text) => text.trim().toLowerCase())
    .filter(Boolean);
  if (textNeedles.length === 0) {
    return null;
  }

  let best:
    | {
        score: number;
        selector: string;
        index: number;
        cursor: CursorKind;
        label: string;
      }
    | null = null;

  for (const selector of args.selectors) {
    const candidates = page.locator(selector);
    let count = 0;
    try {
      count = Math.min(await candidates.count(), 24);
    } catch {
      continue;
    }

    for (let index = 0; index < count; index += 1) {
      const locator = candidates.nth(index);
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) {
        continue;
      }

      const values = [
        await locator.innerText().catch(() => ""),
        await locator.textContent().catch(() => ""),
        await locator.inputValue().catch(() => ""),
      ]
        .map((value) => value.trim())
        .filter(Boolean);

      const matched = scoreManualTargetMatch(values, textNeedles);
      if (matched.score <= 0) {
        continue;
      }

      const score = matched.score + Math.min(120, values.join(" ").length);
      if (!best || score > best.score) {
        best = {
          score,
          selector,
          index,
          cursor:
            args.targetKind === "input" || isManualInputSelector(selector)
              ? "text"
              : "pointer",
          label: matched.label || values[0] || "",
        };
      }
    }
  }

  if (!best) {
    return null;
  }

  const point = await page
    .locator(best.selector)
    .nth(best.index)
    .centroid()
    .catch(() => null);
  if (!point) {
    return null;
  }

  return {
    point: clampPointToViewport(
      {
        x: Math.round(point.x),
        y: Math.round(point.y),
      },
      args.viewport
    ),
    cursor: best.cursor,
    label: best.label,
  };
}

async function findManualTargetByText(
  page: BrowserPage,
  args: {
    texts: string[];
    targetKind: "clickable" | "input" | "any";
    viewport: Viewport;
  }
): Promise<ManualTargetSnapshot | null> {
  const selectors = getManualTargetSelectors(args.targetKind);

  try {
    const result = await page.evaluate(
      ({
        texts,
        targetKind,
        selectors,
      }: {
        texts: string[];
        targetKind: "clickable" | "input" | "any";
        selectors: string[];
      }) => {
        const textNeedles = texts
          .map((text) => text.trim().toLowerCase())
          .filter(Boolean);
        if (textNeedles.length === 0) {
          return null;
        }

        const selectorText = selectors.join(", ");

        const visible = (element: Element) => {
          try {
            if (!(element instanceof HTMLElement)) {
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.width < 6 || rect.height < 6) {
              return false;
            }
            const style = window.getComputedStyle(element);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0"
            );
          } catch {
            return false;
          }
        };

        const clickable = (element: Element) => {
          try {
            const html = element as HTMLElement;
            const role = (element.getAttribute("role") ?? "").toLowerCase();
            const tag = element.tagName.toLowerCase();
            const cursor = window.getComputedStyle(html).cursor;
            return (
              tag === "button" ||
              tag === "a" ||
              tag === "summary" ||
              tag === "label" ||
              tag === "option" ||
              role === "button" ||
              role === "link" ||
              role === "tab" ||
              role === "option" ||
              role === "menuitem" ||
              tag === "input" ||
              cursor === "pointer" ||
              html.onclick !== null ||
              html.tabIndex >= 0
            );
          } catch {
            return false;
          }
        };

        const editable = (element: Element) => {
          try {
            const role = (element.getAttribute("role") ?? "").toLowerCase();
            return (
              element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement ||
              (element as HTMLElement).isContentEditable ||
              role === "textbox" ||
              role === "searchbox" ||
              role === "combobox"
            );
          } catch {
            return false;
          }
        };

        const safeText = (read: () => unknown) => {
          try {
            const value = read();
            return value == null ? "" : String(value).trim();
          } catch {
            return "";
          }
        };

        const collectText = (element: Element) => {
          const html = element as HTMLElement;
          const values = [
            safeText(() => html.innerText),
            safeText(() => html.textContent),
            safeText(() => html.getAttribute("aria-label")),
            safeText(() => html.getAttribute("placeholder")),
            safeText(() => html.getAttribute("title")),
            safeText(() => html.getAttribute("data-testid")),
            safeText(() => html.getAttribute("data-test-id")),
            safeText(() => html.getAttribute("name")),
            safeText(() => html.getAttribute("value")),
            safeText(() => (element instanceof HTMLInputElement ? element.value : "")),
          ].filter(Boolean);

          return Array.from(new Set(values));
        };

        const matchScore = (values: string[]) => {
          let score = 0;
          let label = "";

          for (const value of values) {
            const normalized = value.toLowerCase();
            for (const needle of textNeedles) {
              if (normalized === needle) {
                return {
                  score: 1000 + needle.length,
                  label: value,
                };
              }

              let candidateScore = 0;
              if (normalized.startsWith(needle)) {
                candidateScore = 800 + needle.length;
              } else if (normalized.includes(needle)) {
                candidateScore = 600 + needle.length;
              } else if (needle.includes(normalized) && normalized.length >= 4) {
                candidateScore = 400 + normalized.length;
              }

              if (candidateScore > score) {
                score = candidateScore;
                label = value;
              }
            }
          }

          return {
            score,
            label,
          };
        };

        const roots: Array<Document | ShadowRoot> = [document];
        const seen = new Set<Element>();
        let best:
          | {
              score: number;
              x: number;
              y: number;
              cursor: CursorKind;
              label: string;
            }
          | null = null;

        while (roots.length > 0) {
          const root = roots.pop();
          if (!root) {
            continue;
          }

          let elements: Element[] = [];
          try {
            elements = Array.from(root.querySelectorAll(selectorText));
          } catch {
            continue;
          }

          for (const element of elements) {
            if (seen.has(element)) {
              continue;
            }
            seen.add(element);

            try {
              const html = element as HTMLElement;
              if (html.shadowRoot) {
                roots.push(html.shadowRoot);
              }

              if (!visible(element)) {
                continue;
              }
              if (targetKind === "clickable" && !clickable(element)) {
                continue;
              }
              if (targetKind === "input" && !editable(element)) {
                continue;
              }

              const values = collectText(element);
              const matched = matchScore(values);
              if (matched.score <= 0) {
                continue;
              }

              const rect = html.getBoundingClientRect();
              const cursor: CursorKind =
                editable(element)
                  ? "text"
                  : clickable(element)
                    ? "pointer"
                    : "default";
              const score =
                matched.score +
                Math.min(120, Math.round(rect.width + rect.height));

              if (!best || score > best.score) {
                best = {
                  score,
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                  cursor,
                  label: matched.label || values[0] || "",
                };
              }
            } catch {
              continue;
            }
          }
        }

        return best;
      },
      {
        texts: args.texts,
        targetKind: args.targetKind,
        selectors,
      }
    );

    if (result) {
      return {
        point: clampPointToViewport(
          {
            x: Math.round(result.x),
            y: Math.round(result.y),
          },
          args.viewport
        ),
        cursor: result.cursor,
        label: result.label,
      };
    }
  } catch (error) {
    console.warn("Manual target DOM scan failed, falling back to locators.", {
      texts: args.texts,
      targetKind: args.targetKind,
      error: formatErrorForLog(error),
    });
  }

  return findManualTargetByLocator(page, {
    ...args,
    selectors,
  });
}

async function summarizeVisibleTargets(page: BrowserPage) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 6 || rect.height < 6) {
        return false;
      }
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    };

    const roots: Array<Document | ShadowRoot> = [document];
    const seen = new Set<Element>();
    const labels: string[] = [];

    while (roots.length > 0 && labels.length < 20) {
      const root = roots.pop();
      if (!root) {
        continue;
      }

      for (const element of Array.from(root.querySelectorAll("*"))) {
        if (seen.has(element) || !visible(element)) {
          continue;
        }
        seen.add(element);

        const html = element as HTMLElement;
        if (html.shadowRoot) {
          roots.push(html.shadowRoot);
        }

        const label = [
          html.innerText,
          html.getAttribute("aria-label"),
          html.getAttribute("placeholder"),
          html.getAttribute("title"),
        ]
          .filter(Boolean)
          .map((value) => String(value).trim())
          .find(Boolean);

        if (!label) {
          continue;
        }

        labels.push(label.slice(0, 120));
        if (labels.length >= 20) {
          break;
        }
      }
    }

    return {
      url: window.location.href,
      labels,
    };
  });
}

function inferCursorKind(
  action: Action,
  domSnapshot:
    | {
        tag: string;
        role: string;
        cursor: string;
        isContentEditable: boolean;
        inputType: string;
      }
    | null
): CursorKind {
  const method = normalizeMethod(action.method);
  if (method === "fill" || method === "type") {
    return "text";
  }

  const tag = domSnapshot?.tag ?? "";
  const role = domSnapshot?.role ?? "";
  const cursor = (domSnapshot?.cursor ?? "").toLowerCase();
  const inputType = domSnapshot?.inputType ?? "";

  if (
    tag === "textarea" ||
    domSnapshot?.isContentEditable ||
    tag === "input" ||
    inputType === "search" ||
    inputType === "email"
  ) {
    return "text";
  }

  if (
    cursor === "pointer" ||
    role === "button" ||
    tag === "button" ||
    tag === "a" ||
    tag === "summary"
  ) {
    return "pointer";
  }

  if (method === "click") {
    return "pointer";
  }

  return "default";
}

function pickBestAction(actions: Action[], step: DemoActStep | DemoFocusStep) {
  if (!actions.length) {
    return null;
  }

  if ("text" in step && step.text) {
    return (
      actions.find((action) => {
        const method = normalizeMethod(action.method);
        return method === "fill" || method === "type";
      }) ?? actions[0]
    );
  }

  return actions[0];
}

function normalizeMethod(method?: string) {
  return (method ?? "").trim().toLowerCase();
}

function buildBezierCurve(from: Point, to: Point, seed: number) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 8) {
    return { cp1: from, cp2: to };
  }

  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const normalX = -unitY;
  const normalY = unitX;
  const bend = clamp(distance * 0.12, 18, 90) * (seed % 2 === 0 ? 1 : -1);
  const lead = clamp(distance * 0.24, 22, 110);

  return {
    cp1: {
      x: from.x + unitX * lead + normalX * bend,
      y: from.y + unitY * lead + normalY * bend,
    },
    cp2: {
      x: to.x - unitX * lead - normalX * bend * 0.65,
      y: to.y - unitY * lead - normalY * bend * 0.65,
    },
  };
}

function cubicBezierPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number
) {
  const oneMinusT = 1 - t;
  const x =
    oneMinusT ** 3 * p0.x +
    3 * oneMinusT ** 2 * t * p1.x +
    3 * oneMinusT * t ** 2 * p2.x +
    t ** 3 * p3.x;
  const y =
    oneMinusT ** 3 * p0.y +
    3 * oneMinusT ** 2 * t * p1.y +
    3 * oneMinusT * t ** 2 * p2.y +
    t ** 3 * p3.y;
  return { x, y };
}

function computeMovementDurationMs(from: Point, to: Point) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.round(clamp(220 + distance * 0.65, 260, 850));
}

function findPreviousKeyframe(keyframes: CameraKeyframe[], atMs: number) {
  let result = keyframes[0];
  for (const keyframe of keyframes) {
    if (keyframe.atMs > atMs) {
      break;
    }
    result = keyframe;
  }
  return result;
}

function findNextKeyframe(keyframes: CameraKeyframe[], atMs: number) {
  return keyframes.find((keyframe) => keyframe.atMs >= atMs) ?? keyframes.at(-1);
}

function mergeWindows(windows: Array<{ startMs: number; endMs: number }>) {
  const sorted = [...windows].sort((left, right) => left.startMs - right.startMs);
  const merged: Array<{ startMs: number; endMs: number }> = [];

  for (const window of sorted) {
    const last = merged.at(-1);
    if (!last || window.startMs > last.endMs) {
      merged.push({ ...window });
      continue;
    }
    last.endMs = Math.max(last.endMs, window.endMs);
  }

  return merged;
}

function encodeVideo(renderedFramesDir: string, outputVideoPath: string, outputFps: number) {
  execSync(
    `ffmpeg -y -framerate ${outputFps} -i "${renderedFramesDir}/frame_%05d.png" -c:v libx264 -pix_fmt yuv420p "${outputVideoPath}"`,
    {
      stdio: "pipe",
    }
  );
}

function writeMetadata(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function resetDir(dirPath: string) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function clampPointToViewport(point: Point, viewport: Viewport) {
  return {
    x: clamp(point.x, 0, viewport.width),
    y: clamp(point.y, 0, viewport.height),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wait(page: BrowserPage, ms: number) {
  if (ms <= 0) {
    return;
  }
  if (page?.waitForTimeout) {
    await page.waitForTimeout(ms);
    return;
  }
  await sleep(ms);
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function easeInOutSine(progress: number) {
  return -(Math.cos(Math.PI * progress) - 1) / 2;
}

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - ((-2 * progress + 2) ** 3) / 2;
}

function easeSmootherStep(progress: number) {
  const clamped = clamp01(progress);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}
