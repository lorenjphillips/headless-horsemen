import { GoogleGenAI, Type } from "@google/genai";
import { ActionStep, DemoRequest } from "./types.js";

const SYSTEM_PROMPT = `You are a browser automation planner for Stagehand, an AI-powered browser automation tool.

Given a website URL and a task description, generate a step-by-step action plan as a JSON array.

## Available actions:

1. **goto** — Navigate to a URL.
   Use for: initial page load, navigating to a new page.
   Example: { "action": "goto", "url": "https://example.com" }

2. **act** — Execute ONE browser action via natural language.
   Use for: clicking buttons, typing text, scrolling, selecting dropdowns.
   Rules:
   - ONE action per step. Do NOT combine actions like "click X and type Y" — split them.
   - Describe elements by their type and label/text, NOT visual appearance.
     Good: "click the 'Sign In' button"
     Bad: "click the blue button in the top right"
   - Include spatial context when helpful: "click the 'Next' button at the bottom of the form"
   - For typing, specify the field: "type 'hello world' into the search input field"
   - For scrolling: "scroll down the page"
   Example: { "action": "act", "instruction": "click the 'Star' button" }

3. **wait** — Pause execution for a number of seconds.
   Use for: waiting for page loads, animations, or network requests to complete.
   Typical values: 1-3 seconds.
   Example: { "action": "wait", "seconds": 2 }

## Guidelines:
- Always start with a "goto" action to navigate to the target URL.
- Add "wait" steps after navigation and after actions that trigger page loads (1-3 seconds).
- Keep plans concise — aim for 5-15 steps.
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
        enum: ["goto", "act", "wait"],
      },
      url: { type: Type.STRING, nullable: true },
      instruction: { type: Type.STRING, nullable: true },
      seconds: { type: Type.NUMBER, nullable: true },
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
      default:
        throw new Error(`Step ${i}: unknown action "${step.action}"`);
    }
  });

  console.log(`[generator] Generated ${steps.length} steps:`);
  steps.forEach((s, i) => {
    if (s.action === "goto") console.log(`  ${i + 1}. goto ${s.url}`);
    else if (s.action === "act")
      console.log(`  ${i + 1}. act: "${s.instruction}"`);
    else console.log(`  ${i + 1}. wait ${s.seconds}s`);
  });

  return steps;
}
