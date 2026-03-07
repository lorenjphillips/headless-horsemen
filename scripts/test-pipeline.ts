import "dotenv/config";
import { generateActionPlan } from "../src/generator.js";
import { executeActionPlan } from "../src/executor.js";
import type { DemoRequest } from "../src/types.js";

async function main() {
  const request: DemoRequest = {
    siteUrl: "https://www.mintlify.com/blog",
    demoTask: "Load the blog page, click on one of the blog posts, then scroll down through the article",
  };

  console.log("=== DemoForge Pipeline Test ===\n");

  // Step 1: Generate action plan
  console.log("--- Phase 1: Generate Action Plan ---");
  const steps = await generateActionPlan(request);
  console.log();

  // Step 2: Execute plan
  console.log("--- Phase 2: Execute Action Plan ---");
  const { videoPath, actionLog } = await executeActionPlan(steps);
  console.log();

  // Summary
  console.log("=== Pipeline Complete ===");
  console.log(`Video: ${videoPath}`);
  console.log(
    `Actions: ${actionLog.filter((a) => a.success).length}/${actionLog.length} succeeded`
  );
  console.log("Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
