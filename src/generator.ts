import { GoogleGenAI, Type } from "@google/genai";
import { ActionStep, DemoRequest } from "./types.js";

const SYSTEM_PROMPT = `You are a browser automation planner for Stagehand, an AI-powered browser automation tool.
The output will be recorded as a demo video, so PACING matters — the viewer needs time to see what's happening.

Given a website URL and a task description, generate a step-by-step action plan as a JSON array.

## Available actions:

1. **goto** — Navigate to a URL.
   Use for: initial page load, navigating to a new page.
   Example: { "action": "goto", "url": "https://example.com" }

2. **act** — Execute ONE browser action via natural language.
   Use for: clicking buttons, typing text, selecting dropdowns, hovering.
   Do NOT use act for scrolling — use the "scroll" action instead.
   Rules:
   - ONE action per step. Do NOT combine actions like "click X and type Y" — split them.
   - Describe elements by their type and label/text, NOT visual appearance.
     Good: "click the 'Sign In' button"
     Bad: "click the blue button in the top right"
   - Include spatial context when helpful: "click the 'Next' button at the bottom of the form"
   - For typing, specify the field: "type 'hello world' into the search input field"
   Example: { "action": "act", "instruction": "click the 'Star' button" }

3. **scroll** — Smoothly scroll the page up or down.
   Use for: ALL scrolling. This produces smooth animated scrolling in the video.
   - "pixels" controls how far to scroll (default 400). Use 300-600 for normal scrolling.
   - To scroll through content, use MULTIPLE scroll steps with waits between them.
   Example: { "action": "scroll", "direction": "down", "pixels": 400 }

4. **wait** — Pause execution for a number of seconds.
   Use for: waiting for page loads, animations, letting the viewer see the current state.
   Typical values: 1-3 seconds.
   Example: { "action": "wait", "seconds": 2 }

## Pacing guidelines (IMPORTANT — this is for a demo video):
- Always start with "goto" then "wait" 3 seconds so the viewer sees the page load.
- Add a "wait" of 2-3 seconds AFTER every click or navigation so the viewer can see the result.
- For scrolling through content, use 3-5 separate scroll steps with "wait" 1-2 seconds between each.
- The total plan should produce a 15-30 second video. Aim for 10-20 steps.
- Do NOT rush — each action should have breathing room.

## Other guidelines:
- Use descriptive, unambiguous instructions for "act" steps.
- If the task involves typing, remember to click the input field FIRST, then type.
- Do NOT include login/authentication steps unless explicitly asked.`;

const ACTION_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        enum: ["goto", "act", "wait", "scroll"],
      },
      url: { type: Type.STRING, nullable: true },
      instruction: { type: Type.STRING, nullable: true },
      seconds: { type: Type.NUMBER, nullable: true },
      direction: { type: Type.STRING, enum: ["up", "down"], nullable: true },
      pixels: { type: Type.INTEGER, nullable: true },
    },
    required: ["action"],
  },
};

export async function generateActionPlan(
  request: DemoRequest
): Promise<ActionStep[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const userPrompt = `Website: ${request.siteUrl}
Task: ${request.demoTask}

Generate the action plan.`;

  console.log("[generator] Calling Gemini 3.1 Pro...");
  console.log(`[generator] Site: ${request.siteUrl}`);
  console.log(`[generator] Task: ${request.demoTask}`);

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: ACTION_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("[generator] Empty response from Gemini");
  }

  const raw: Array<{
    action: string;
    url?: string;
    instruction?: string;
    seconds?: number;
    direction?: string;
    pixels?: number;
  }> = JSON.parse(text);

  // Validate and convert to typed ActionStep[]
  const steps: ActionStep[] = raw.map((step, i) => {
    switch (step.action) {
      case "goto":
        if (!step.url) throw new Error(`Step ${i}: goto requires url`);
        return { action: "goto" as const, url: step.url };
      case "act":
        if (!step.instruction)
          throw new Error(`Step ${i}: act requires instruction`);
        return { action: "act" as const, instruction: step.instruction };
      case "wait":
        return {
          action: "wait" as const,
          seconds: step.seconds ?? 2,
        };
      case "scroll":
        return {
          action: "scroll" as const,
          direction: (step.direction === "up" ? "up" : "down") as
            | "up"
            | "down",
          pixels: step.pixels ?? 400,
        };
      default:
        throw new Error(`Step ${i}: unknown action "${step.action}"`);
    }
  });

  console.log(`[generator] Generated ${steps.length} steps:`);
  steps.forEach((s, i) => {
    if (s.action === "goto") console.log(`  ${i + 1}. goto ${s.url}`);
    else if (s.action === "act")
      console.log(`  ${i + 1}. act: "${s.instruction}"`);
    else if (s.action === "scroll")
      console.log(`  ${i + 1}. scroll ${s.direction} ${s.pixels}px`);
    else console.log(`  ${i + 1}. wait ${s.seconds}s`);
  });

  return steps;
}
