# Contributing to showTime

Thanks for your interest! showTime is a small tool with one job: turn a JSON script into a demo
video that looks hand-edited. Contributions that keep it deterministic, scriptable and
agent-friendly are very welcome.

## Getting started

```bash
git clone https://github.com/mineo71/showTime.git
cd showTime
npm install
npx playwright install chromium
npm link                 # optional: `showtime` on your PATH
```

**Requirements:** Node 20+, ffmpeg on `PATH` (`brew install ffmpeg` / `apt install ffmpeg`).

## Tests

```bash
npm test            # unit tests — pure timeline math, schema, encoders (seconds)
npm run test:int    # Playwright + ffmpeg + Remotion, end to end (a few minutes)
npm run typecheck
```

`src/timeline/` is pure: no `node:` imports, so the same code runs in Node and in the Remotion
bundle. Changes there come with unit tests. Changes to the runner (`src/runner/`) or the renderer
(`src/render/`) come with an integration test against `fixtures/demo-app`.

## Architecture

- `src/script/` — the script format (zod schema → JSON Schema), loading, the action hash.
- `src/runner/` — Playwright: `check` (rehearsal) and `record` (CDP screencast → `raw.mp4` +
  `events.json`).
- `src/timeline/` — `buildTimeline(script, events)`: speed segments, camera keys, captions,
  spotlights. **Pure and tested.**
- `src/render/` — the Remotion composition that turns `timeline.json` + `raw.mp4` into the video.
- `src/cli/` — commander CLI. `skill/` — the Claude Code skill.

The design and the reasoning behind it live in
[`docs/superpowers/specs/2026-10-13-showtime-design.md`](docs/superpowers/specs/2026-10-13-showtime-design.md).

## Changing the script format

Edit `src/script/schema.ts`, then run `npm run schema:write` to refresh
`docs/script.schema.json` (a test fails until you do), and update the reference in `README.md`
and `skill/SKILL.md`.

## Changing how videos look

Re-render the example and refresh the README media:

```bash
npm run example                              # terminal 1
showtime make examples/fennel/demo.json      # terminal 2
showtime frames examples/fennel/demo.json
npm run media                                # → docs/media
```

## Pull requests

- Keep changes focused; describe the *why*.
- `npm run typecheck && npm test` must pass; run `npm run test:int` when the runner or renderer
  changed.
- Match the surrounding style. No new runtime dependencies without a good reason.

## Reporting bugs

Open an [issue](https://github.com/mineo71/showTime/issues) with the script (trimmed), the
output of `showtime check`, and your OS / Node / ffmpeg versions. Never attach stills or videos
that show personal data — use `app.mask`.
