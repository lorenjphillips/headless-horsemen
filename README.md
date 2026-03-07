# DemoForge

DemoForge turns a URL + task into a browser automation demo and is currently split into:

- `npm run start` for the existing API server in `src/server.ts`
- `npm run demo:director` for the fully scripted `director.ai` demo with narrated final cut
- `npm run demo:generated` for the Gemini-generated baseline pipeline
- `npm run demo` for the polished capture + voiceover path

`CLAUDE.md` documents the current architecture, the gap between those paths, and the next unification step.
