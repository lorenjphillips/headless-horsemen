# Headless Horsemen Research Log

## Gemini API — Structured Output & JSON Mode

### Package: Use `@google/genai` (NOT `@google/generative-ai`)

| Package | Status |
|---|---|
| `@google/generative-ai` | **Deprecated Nov 2025** — listed in CLAUDE.md but outdated |
| `@google/genai` | **Current** — GA since May 2025, actively maintained |

The API shapes are different between the two. The new package uses:
```typescript
import { GoogleGenAI, Type } from "@google/genai";
const ai = new GoogleGenAI({ apiKey });
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "...",
  config: { systemInstruction, responseMimeType, responseSchema }
});
const text = response.text; // property, not method
```

### JSON Mode — Fully Supported

Two modes available:
1. **JSON mode** (`responseMimeType: "application/json"`) — guarantees valid JSON, no schema enforcement
2. **Schema-constrained** (add `responseSchema`) — output MUST match the provided JSON Schema

Schema supports: `string`, `number`, `integer`, `boolean`, `object`, `array`, `null`, plus `enum`, `nullable`, `required`, `description`, `minimum`/`maximum`, `minItems`/`maxItems`.

### System Prompts — Supported

Via `config.systemInstruction` in the new SDK. Works alongside structured output.

### Model Recommendation: `gemini-2.5-flash`

| | 2.0 Flash | 2.5 Flash | 2.5 Pro |
|---|---|---|---|
| Status | **Retiring March 2026** | Active | Active |
| Output tokens | 8K | 65K | 65K |
| Structured output | Yes | Yes | Yes |
| Speed | Fast | Fast | Slower |
| Cost | Low | Low-Med | High |

**Decision: Use `gemini-2.5-flash`.** 2.0 Flash is being retired. 2.5 Flash has 8x more output tokens (65K vs 8K), which matters for longer demo plans and caption generation.

### Key Gotchas

1. **Structured output NOT compatible with thinking mode** — don't enable thinking when using `responseSchema`
2. **`nullable: true` must be explicit** for optional fields
3. **Temperature: keep at 1.0** for 2.5 models (Google recommendation)
4. **Schema complexity can cause 400 errors** — keep schemas flat
5. **Free tier rate limits (2.5 Flash):** ~10 RPM, 250K TPM, 250 RPD — reduced in Dec 2025
6. **JSON mode guarantees syntax, not semantics** — still need to validate values in app code

### API Pattern for Our Use Case

```typescript
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: userPrompt,
  config: {
    systemInstruction: "You are a browser automation planner...",
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, enum: ["goto", "act", "wait", "screenshot"] },
          url: { type: Type.STRING, nullable: true },
          instruction: { type: Type.STRING, nullable: true },
          seconds: { type: Type.INTEGER, nullable: true },
          label: { type: Type.STRING, nullable: true },
        },
        required: ["action"],
      },
    },
  },
});

const steps = JSON.parse(response.text!);
```

---

## Stagehand v3 — Browser Automation

### Core Methods

| Method | Purpose | Takes LLM? |
|---|---|---|
| `act(instruction)` | Execute ONE browser action via natural language | Yes (unless passed an Action object) |
| `act(action)` | Execute a cached Action object (from observe) | No — deterministic replay |
| `observe(instruction)` | List actionable elements matching description | Yes |
| `extract(options)` | Pull structured data from DOM | Yes |
| `agent(config)` | Multi-step autonomous workflow | Yes |

### act() — Key Details

- **Single action per call.** "Click X and type Y" is WRONG — split into two calls.
- Takes natural language: `await stagehand.act("click the Create new button")`
- Supports variable substitution: `stagehand.act("type %email%", { variables: { email } })`
- Returns `{ success, message, actionDescription, actions[] }`

**Prompting best practices:**
- Use element type not visual attributes: `"click the 'Sign In' button"` not `"click the blue button"`
- Include spatial context: `"click the 'Next' button at the bottom of the form"`

### observe() — Planning Primitive

Returns `Action[]` without executing anything:
```typescript
interface Action {
  selector: string;      // XPath
  description: string;   // Human-readable
  method: string;        // "click" | "fill" | "type" | "press" | "scroll" | "select"
  arguments: string[];   // e.g., text to type
}
```

**observe → act pattern (2-3x faster, no LLM on replay):**
```typescript
const actions = await stagehand.observe("find the submit button");
await stagehand.act(actions[0]); // deterministic, no LLM call
```

### Navigation

`page.goto()` on the page object, NOT through `stagehand.act()`:
```typescript
const page = stagehand.context.pages()[0];
await page.goto("https://example.com");
```

### Video Recording — Important Limitation

Stagehand v3 uses CDP, not Playwright for automation. Playwright's `recordVideo` doesn't work.

**Our approach (already implemented in test-stagehand.ts):** screenshot-per-frame + FFmpeg stitching. This gives us full control for captions/transitions.

### Architecture Note

v3 changed the API surface:
- Methods on `stagehand` instance (not `page`): `stagehand.act()`, `stagehand.observe()`
- Page access: `stagehand.context.pages()[0]`
- `selfHeal: true` (default) — auto-recovers from failures with LLM retry

---

## Action Plan Schema — Mapping Gemini Output to Stagehand

The JSON action plan Gemini generates should use these action types:

| Action | Maps To | Notes |
|---|---|---|
| `goto` | `page.goto(url)` | Navigation — use page object directly |
| `act` | `stagehand.act(instruction)` | AI-powered action — natural language |
| `wait` | `sleep(seconds * 1000)` | Pause for page load / animation |
| `screenshot` | `page.screenshot()` | Capture key moment for narration |

Schema:
```typescript
type DemoAction =
  | { action: "goto"; url: string }
  | { action: "act"; instruction: string }
  | { action: "wait"; seconds: number }
  | { action: "screenshot"; label: string }
```

This maps cleanly to Stagehand's API. `act` with natural language instructions is the core — Stagehand handles element finding, clicking, typing etc.

---

## Open Questions

- [ ] Need GEMINI_API_KEY to test
- [ ] Should we add `observe` as an action type? (for pre-flight page analysis)
- [ ] Should we add `extract` for data validation steps?
- [ ] How detailed should `act` instructions be? "Click Create" vs "Click the blue Create button in the top right"
