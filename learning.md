# Learnings

## Stagehand and capture

- Stagehand v3 provides enough structure to drive a polished demo pipeline without Playwright video recording.
- `observe()` is useful for extracting actionable selectors and methods before executing an interaction.
- The page and locator APIs we needed were `deepLocator()`, `centroid()`, `hover()`, `click()`, `type()`, and `keyPress()`.
- For this project, the reliable capture primitive is still periodic screenshots, not native video capture.

## Rendering strategy

- The polished output needs a second render pass after raw capture.
- The raw pass records screenshots plus event metadata.
- The composition pass adds cursor SVGs, click pulses, zooms, and speed ramps.
- A dedicated composer page is an effective way to render those overlays frame-by-frame before encoding with `ffmpeg`.

## SVG cursor assets

- The cursor visuals are implemented as inline SVG strings in the composer renderer, not as separate asset files.
- There are three SVG cursor variants:
  - default arrow cursor
  - pointer/hand cursor
  - text input cursor
- Keeping the SVGs inline makes it easy to switch cursor shape per frame during composition.
- Each SVG needs an explicit hotspot offset so the visible tip of the cursor lines up with the click target.
- The cursor renderer swaps SVG markup based on the inferred cursor type for the active element.
- If we want designer-owned assets later, the current inline SVG approach can be replaced with external SVG files without changing the higher-level event timeline model.

## Cursor behavior

- Smooth mouse movement works better as synthesized animation than as literal replayed pointer samples.
- Cubic Bezier curves give the cursor motion a more natural path between targets.
- Movement duration should scale with travel distance so short hops stay quick and long moves do not look abrupt.
- Cursor state can be inferred from the target element:
  - text cursor for `input`, `textarea`, and contenteditable targets
  - pointer cursor for buttons, links, and elements with `cursor: pointer`
  - default cursor otherwise

## Zoom and pacing

- Screen Studio-style zoom is best modeled as camera keyframes around interactions.
- Small zoom on pointer movement, stronger zoom on click or typing, then easing back out feels natural.
- Fast-forwarding is easiest as source-time to output-time remapping.
- Building active windows around mouse and keyboard events makes it straightforward to compress idle sections.

## Stagehand-specific constraints

- Scroll actions are a special case and should not be forced through `observe()` when there is no clear element target.
- For scrolling, direct `act()` execution plus generic activity timeline entries is more reliable.
- The main uncertainty left is runtime tuning:
  - zoom strength
  - idle thresholds
  - how consistently `observe()` picks the right selector on real sites

## Voiceover integration

- The existing voiceover flow did not need to be replaced.
- The new demo metadata can be translated back into `InteractionEvent` records and reused by the Gemini voiceover generator.

## Validation

- The implementation was validated with `npm run typecheck`.
- A full live run still depends on Browserbase credentials, Gemini credentials, and `ffmpeg`.
