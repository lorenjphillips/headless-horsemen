import "dotenv/config";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { generateActionPlan } from "./generator.js";
import { executeActionPlan } from "./executor.js";
import type { ActionStep, ActionLogEntry, DemoRequest, DemoOptions } from "./types.js";

const app = express();
app.use(express.json());
app.use(express.static(path.resolve("public")));

// Serve OpenAPI spec
app.get("/openapi.yaml", (_req, res) => {
  res.sendFile(path.resolve("design/openapi.yaml"));
});

// --------------- Job types ---------------

type JobStatus = "planning" | "executing" | "encoding" | "done" | "failed";

interface DemoJob {
  id: string;
  status: JobStatus;
  siteUrl: string;
  demoTask: string;
  options: DemoOptions;
  plan: ActionStep[] | null;
  actionLog: ActionLogEntry[] | null;
  progress: { currentStep: number; totalSteps: number; currentAction: string } | null;
  videoPath: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

// --------------- In-memory state ---------------

const jobs = new Map<string, DemoJob>();
let activeJobId: string | null = null;

function genId(): string {
  return "demo_" + crypto.randomBytes(6).toString("hex");
}

// --------------- Routes ---------------

app.post("/demos", (req, res) => {
  const { siteUrl, demoTask, options } = req.body as Partial<DemoRequest>;

  if (!siteUrl || !demoTask) {
    res.status(400).json({ error: "siteUrl and demoTask are required" });
    return;
  }

  const demoOptions: DemoOptions = options ?? {};

  if (activeJobId) {
    res.status(409).json({ error: "A demo is already being generated. Try again later." });
    return;
  }

  const id = genId();
  const job: DemoJob = {
    id,
    status: "planning",
    siteUrl,
    demoTask,
    options: demoOptions,
    plan: null,
    actionLog: null,
    progress: null,
    videoPath: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  jobs.set(id, job);
  activeJobId = id;

  // Run pipeline in background
  runPipeline(job).catch(() => {});

  res.status(201).json({ id, status: job.status, createdAt: job.createdAt });
});

app.get("/demos/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const response: Record<string, unknown> = {
    id: job.id,
    status: job.status,
    siteUrl: job.siteUrl,
    demoTask: job.demoTask,
    plan: job.plan,
    progress: job.progress,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };

  if (job.status === "done") {
    response.actionLog = job.actionLog;
    response.videoUrl = `/demos/${job.id}/video`;
  }

  if (job.status === "failed") {
    response.error = job.error;
  }

  res.json(response);
});

app.get("/demos/:id/plan", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (!job.plan) {
    res.status(409).json({ error: "Plan not yet available" });
    return;
  }
  res.json({ id: job.id, status: job.status, plan: job.plan });
});

app.get("/demos/:id/video", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.videoPath) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  if (!fs.existsSync(job.videoPath)) {
    res.status(404).json({ error: "Video file missing" });
    return;
  }
  res.sendFile(job.videoPath);
});

// --------------- Pipeline runner ---------------

async function runPipeline(job: DemoJob) {
  const jobDir = path.resolve("output", job.id);

  try {
    // Phase 1: Generate action plan
    console.log(`[server] Job ${job.id}: generating plan...`);
    const steps = await generateActionPlan({ siteUrl: job.siteUrl, demoTask: job.demoTask }, job.options);
    job.plan = steps;
    job.status = "executing";

    // Phase 2: Execute
    console.log(`[server] Job ${job.id}: executing ${steps.length} steps...`);
    const { videoPath, actionLog } = await executeActionPlan(steps, {
      outputDir: jobDir,
      demoOptions: job.options,
      onProgress: (currentStep, totalSteps, label, done) => {
        job.progress = {
          currentStep: done ? currentStep + 1 : currentStep,
          totalSteps,
          currentAction: done ? `completed: ${label}` : label,
        };
      },
    });

    job.status = "encoding";
    job.actionLog = actionLog;
    job.videoPath = path.resolve(videoPath);
    job.status = "done";
    job.completedAt = new Date().toISOString();
    console.log(`[server] Job ${job.id}: done! Video: ${videoPath}`);
  } catch (err: any) {
    job.status = "failed";
    job.error = err.message || String(err);
    job.completedAt = new Date().toISOString();
    console.error(`[server] Job ${job.id} failed:`, job.error);
  } finally {
    activeJobId = null;
  }
}

// --------------- Start ---------------

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Headless Horsemen running on 0.0.0.0:${PORT}`);
});
