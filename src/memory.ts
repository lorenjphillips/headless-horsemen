import { CloudClient } from "chromadb";
import type { ActionStep } from "./types.js";

let collection: any = null;
let disabled = false;

export async function initMemory(): Promise<void> {
  const apiKey = process.env.CHROMA_API_KEY;
  const tenant = process.env.CHROMA_TENANT;
  const database = process.env.CHROMA_DATABASE;

  if (!apiKey || !tenant || !database) {
    console.log("[memory] ChromaDB env vars missing — memory disabled");
    disabled = true;
    return;
  }

  try {
    const client = new CloudClient({ apiKey, tenant, database });
    collection = await client.getOrCreateCollection({ name: "demo_plans" });
    console.log("[memory] ChromaDB connected — collection: demo_plans");
  } catch (err: any) {
    console.error("[memory] ChromaDB init failed:", err.message);
    disabled = true;
  }
}

export interface StoredDemo {
  siteUrl: string;
  demoTask: string;
  plan: ActionStep[];
}

export async function storeDemo(
  id: string,
  siteUrl: string,
  demoTask: string,
  plan: ActionStep[]
): Promise<void> {
  if (disabled || !collection) return;

  try {
    await collection.add({
      ids: [id],
      documents: [`Site: ${siteUrl}\nTask: ${demoTask}`],
      metadatas: [{
        siteUrl,
        demoTask,
        stepCount: plan.length,
        planJson: JSON.stringify(plan),
      }],
    });
    console.log(`[memory] Stored demo ${id} (${plan.length} steps)`);
  } catch (err: any) {
    console.error("[memory] Failed to store demo:", err.message);
  }
}

export async function recallSimilarDemos(
  siteUrl: string,
  demoTask: string,
  nResults = 3
): Promise<StoredDemo[]> {
  if (disabled || !collection) return [];

  try {
    const results = await collection.query({
      queryTexts: [`Site: ${siteUrl}\nTask: ${demoTask}`],
      nResults,
      include: ["metadatas", "distances"],
    });

    if (!results || !results.metadatas?.[0]) return [];

    const demos: StoredDemo[] = [];
    for (const meta of results.metadatas[0]) {
      if (!meta?.planJson) continue;
      try {
        demos.push({
          siteUrl: meta.siteUrl as string,
          demoTask: meta.demoTask as string,
          plan: JSON.parse(meta.planJson as string),
        });
      } catch {}
    }

    console.log(`[memory] Found ${demos.length} similar demos`);
    return demos;
  } catch (err: any) {
    console.error("[memory] Recall failed:", err.message);
    return [];
  }
}
