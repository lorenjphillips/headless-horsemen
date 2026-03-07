import "dotenv/config";
import { initMemory, storeDemo } from "../src/memory.js";
import type { ActionStep } from "../src/types.js";

const seeds: Array<{ id: string; siteUrl: string; demoTask: string; plan: ActionStep[] }> = [
  {
    id: "seed_github_explore",
    siteUrl: "https://github.com/browserbase/stagehand",
    demoTask: "Explore the Stagehand repository and read the README",
    plan: [
      { action: "goto", url: "https://github.com/browserbase/stagehand" },
      { action: "wait", seconds: 3 },
      { action: "scroll", direction: "down", pixels: 400 },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 350 },
      { action: "wait", seconds: 2 },
      { action: "act", instruction: "click the 'README.md' file link" },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 500 },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 300 },
      { action: "wait", seconds: 2 },
    ],
  },
  {
    id: "seed_hackernews_browse",
    siteUrl: "https://news.ycombinator.com",
    demoTask: "Browse the front page and open the top story",
    plan: [
      { action: "goto", url: "https://news.ycombinator.com" },
      { action: "wait", seconds: 3 },
      { action: "scroll", direction: "down", pixels: 300 },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "up", pixels: 300 },
      { action: "wait", seconds: 1 },
      { action: "act", instruction: "click the first story title link on the page" },
      { action: "wait", seconds: 3 },
      { action: "scroll", direction: "down", pixels: 450 },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 350 },
      { action: "wait", seconds: 2 },
    ],
  },
  {
    id: "seed_wikipedia_search",
    siteUrl: "https://en.wikipedia.org",
    demoTask: "Search for 'artificial intelligence' and read the overview",
    plan: [
      { action: "goto", url: "https://en.wikipedia.org" },
      { action: "wait", seconds: 3 },
      { action: "act", instruction: "click the search input field" },
      { action: "act", instruction: "type 'artificial intelligence' into the search input field" },
      { action: "wait", seconds: 1 },
      { action: "act", instruction: "click the search button" },
      { action: "wait", seconds: 3 },
      { action: "scroll", direction: "down", pixels: 400 },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 500 },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 350 },
      { action: "wait", seconds: 2 },
    ],
  },
  {
    id: "seed_producthunt_browse",
    siteUrl: "https://www.producthunt.com",
    demoTask: "Browse today's top products and upvote the first one",
    plan: [
      { action: "goto", url: "https://www.producthunt.com" },
      { action: "wait", seconds: 3 },
      { action: "scroll", direction: "down", pixels: 350 },
      { action: "wait", seconds: 2 },
      { action: "act", instruction: "hover over the first product card" },
      { action: "wait", seconds: 1 },
      { action: "act", instruction: "click the upvote button on the first product" },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 450 },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 300 },
      { action: "wait", seconds: 2 },
    ],
  },
  {
    id: "seed_docs_navigate",
    siteUrl: "https://docs.trychroma.com",
    demoTask: "Navigate to the getting started guide and read the installation steps",
    plan: [
      { action: "goto", url: "https://docs.trychroma.com" },
      { action: "wait", seconds: 3 },
      { action: "act", instruction: "click the 'Getting Started' link in the navigation" },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 400 },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 350 },
      { action: "wait", seconds: 2 },
      { action: "act", instruction: "click the 'Installation' section link" },
      { action: "wait", seconds: 2 },
      { action: "scroll", direction: "down", pixels: 500 },
      { action: "wait", seconds: 2 },
    ],
  },
];

async function main() {
  await initMemory();
  console.log(`\nSeeding ${seeds.length} demo plans into ChromaDB...\n`);

  for (const seed of seeds) {
    await storeDemo(seed.id, seed.siteUrl, seed.demoTask, seed.plan);
  }

  console.log("\nDone! ChromaDB now has seed data for memory recall.");
}

main().catch(console.error);
