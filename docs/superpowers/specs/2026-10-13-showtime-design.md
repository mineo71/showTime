# showTime — AI-directed product demo videos

Date: 2026-10-13
Status: approved direction (approach A — headless core), MVP scope

## 1. Problem

Recording a product demo for a pitch is slow: click through the app, re-take on every
mistake, then hand-edit zooms, highlights, speed-ups and captions. Claude can already write
a shot list, and Playwright can already click through a web app, but nothing joins them into
"script in → polished video out", and nothing makes a re-take after a UI change free.

## 2. Goal

A CLI (`showtime`) plus a Claude Code skill. Claude writes a JSON demo script, `showtime`
rehearses it, records it, and renders a polished MP4: auto-zoom on the action, a smooth
synthetic cursor with click ripples, spotlights, captions, auto speed-up of dead time, a
styled background frame and an intro title card. A UI change means one command to re-take.

Success criteria:

- From a valid script, `showtime make demo.json` produces a 1080p MP4 with no manual edits.
- Changing only presentation (`show`, `style`, `meta`) re-renders **without** re-recording.
- When a step fails, `showtime check` tells Claude which step, why, and what the page looked
  like (screenshot + ARIA snapshot), so Claude can fix the script by itself.
- `showtime frames` gives Claude still frames of the rendered video for visual QA.

Non-goals for the MVP (see §11): voice-over/TTS, vertical follow-cam, desktop/mobile apps,
GUI editor, MCP server, multi-tab flows, background music.

## 3. Key idea: separate capture from direction

```
demo.json ─► check  (fast run, screenshots, errors) ─► Claude fixes script
demo.json ─► record (Playwright + CDP screencast) ─► take/raw.mp4   (no cursor, 2x DPR)
                                                     take/events.json (steps, bboxes, cursor, clicks, idle)
demo.json + events.json ─► buildTimeline() ─► timeline.json ─► Remotion ─► demo.mp4
```

- The runner records a clean video **without** a cursor and logs everything that happened
  with timestamps and element bounding boxes.
- Everything visual is synthesized in post from the log: camera, cursor, ripples, spotlights,
  captions, speed. That is why presentation edits never need a re-take.
- `timeline.json` is the contract between the core and the renderer. The renderer is a pure
  function of it, so the renderer can be swapped later (e.g. a WebCodecs/Pixi renderer
  adapted from OpenScreen, MIT) without touching the runner.

## 4. Script format (`showtime/script` v1)

The script has two layers per step: `do`/action fields drive the **runner**; `show` drives the
**renderer**. Validated with zod; `showtime schema` prints the JSON Schema for Claude.

```jsonc
{
  "version": 1,
  "meta": { "title": "NOVA checkout", "subtitle": "2 clicks for returning customers" },
  "app": {
    "url": "http://localhost:3000",
    "viewport": { "width": 1440, "height": 900 },   // default
    "deviceScaleFactor": 2,                          // default; crisp zooms
    "storageState": "./auth/demo-user.json",         // optional, relative to script
    "colorScheme": "light",                          // optional
    "locale": "uk-UA", "timezoneId": "Europe/Kyiv",  // optional
    "mask": [".customer-email"]                      // CSS selectors blurred in capture
  },
  "setup": [ { "do": "click", "target": "text=Accept cookies" } ],  // run before capture
  "style": {
    "background": "linear-gradient(135deg, #0f172a, #312e81)",  // any CSS background
    "padding": 0.06, "radius": 14, "shadow": true,
    "font": "Inter, system-ui, sans-serif", "accent": "#6366f1",
    "autoZoom": true, "autoSpeed": true, "maxZoom": 1.8
  },
  "scenes": [
    {
      "id": "checkout",
      "steps": [
        { "do": "click", "target": "role=button[name='Buy now']",
          "show": { "caption": "One click to buy" } },
        { "do": "wait", "for": "text=Payment" },
        { "do": "type", "target": "#promo", "text": "NOVA10", "pace": "human" },
        { "do": "hover", "target": ".cashback",
          "show": { "spotlight": true, "caption": "Cashback shown instantly", "hold": 1500 } }
      ]
    }
  ]
}
```

### 4.1 Actions (`do`)

| do | fields | runner behaviour |
|---|---|---|
| `goto` | `url` | navigate, wait for `load` |
| `click` | `target` | move cursor to target, click |
| `type` | `target`, `text`, `pace?` (`human` \| `fast` \| ms/char), `clear?` | move, click, type char by char |
| `press` | `key` (Playwright key, e.g. `Enter`, `Meta+K`) | keyboard press |
| `hover` | `target` | move cursor to target |
| `select` | `target`, `value` | move, select option |
| `scroll` | `target?` or `by?` (px, vertical) | smooth scroll to element / by offset |
| `wait` | `for?` (target) or `ms?` | wait for element visible / fixed time; logged as idle |
| `pause` | `ms` | real-time hold for the viewer (not sped up) |

`target` is a Playwright selector string (`role=button[name='Save']`, `text=Save`, CSS,
`#id`, `[data-testid=x]`). Steps must resolve to exactly one element (strict mode).

### 4.2 Presentation (`show`)

| field | default | meaning |
|---|---|---|
| `zoom` | auto (if `style.autoZoom`) for click/type/select/hover | number = depth, `false` = no zoom |
| `caption` | — | text shown in a lower pill from step start to end + hold (min 1.5 s) |
| `spotlight` | `false` | dim everything except the target bbox |
| `hold` | 0 | extra real-time ms after the step (runner waits, renderer keeps 1×) |
| `speed` | 1 (auto for idle if `style.autoSpeed`) | playback speed for this step's span |

`hold` is the only `show` field that affects recording; it is included in the action hash
(§6.3) so changing it asks for a re-take.

## 5. Runner (`record` and `check`)

Chromium via Playwright, headless by default (`--headed` for debugging). Context uses the
script's viewport, DPR, storageState, colorScheme, locale, timezone. Mask selectors get
`filter: blur(10px)` via an init-script stylesheet.

Order: launch → `goto app.url` → `setup` steps (fast, not captured) → start capture → scenes →
final 800 ms tail → stop capture.

Per step:

1. Resolve locator; `scrollIntoViewIfNeeded`; read `boundingBox()` (CSS px, viewport-relative)
   and computed `cursor` style (`pointer` → hand, `text` → I-beam, else arrow).
2. Cursor travel (record mode only): duration `clamp(350 + dist*0.35, 350, 900)` ms. The real
   mouse is moved with `page.mouse.move(..., { steps })` across that time so hover states
   fire as they would for a person. A `move` event is logged.
3. Perform the action. Clicks log `{tMs, x, y}`. Human typing: 45–110 ms/char jitter.
4. Settle: best-effort `waitForLoadState('networkidle')` capped at 3 s, plus a 450 ms beat,
   plus `show.hold`. Time spent waiting beyond 300 ms is logged as an **idle** interval, as is
   every `wait` step.

Per-step timeout 10 s (`wait`: 15 s). Failure aborts the run.

### 5.1 Capture

CDP `Page.startScreencast` (JPEG q92, every frame, max size = viewport × DPR). Each frame is
acked immediately and written to `take/frames/NNNNNN.jpg` with its CDP timestamp. After
stopping, frames are assembled with ffmpeg's concat demuxer (per-frame durations from
timestamps) into a CFR 30 fps H.264 `raw.mp4` (crf 14, yuv420p, even dimensions). Screencast
only emits frames on change; the concat durations hold the last frame across static spans.
Frames are deleted after a successful encode unless `--keep-frames`.

Event timestamps use the same wall clock, relative to capture start `t0`.

### 5.2 `check` (rehearsal)

Same runner, no capture, no cursor travel, `fast` typing. After every step: screenshot to
`check/NN-<do>.png`. On failure: error message (not found / N matches / timeout),
`check/failure.png`, and an ARIA snapshot of the page (`locator('body').ariaSnapshot()`) in
the report so Claude can pick a working selector. Prints a human summary; `--json` prints the
machine report.

## 6. Data contracts

### 6.1 `events.json` (written by `record`)

```ts
interface TakeEvents {
  version: 1;
  actionHash: string;                 // sha256 of normalized actions (see 6.3)
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  video: { file: "raw.mp4"; width: number; height: number; fps: 30; durationMs: number };
  steps: Array<{
    sceneId: string; index: number; do: string;
    startMs: number; endMs: number;   // endMs excludes settle/hold
    settledMs: number;                // after settle + hold
    target?: { x: number; y: number; width: number; height: number };  // CSS px
  }>;
  moves: Array<{ startMs: number; endMs: number; from: Pt; to: Pt; cursor: "arrow" | "pointer" | "text" }>;
  clicks: Array<{ tMs: number; x: number; y: number }>;
  idle: Array<{ startMs: number; endMs: number }>;
}
```

### 6.2 `timeline.json` (built by `buildTimeline(script, events)`, pure)

```ts
interface Timeline {
  version: 1;
  fps: 30;
  output: { width: 1920; height: 1080 };
  stage: { width: number; height: number };            // CSS px (viewport)
  video: { src: string; durationMs: number };
  intro?: { title: string; subtitle?: string; durationMs: number };   // 2200 ms
  segments: Array<{ srcStartMs: number; srcEndMs: number; speed: number }>; // cover [0, duration]
  camera: Array<{ tMs: number; scale: number; cx: number; cy: number }>;  // source-time keyframes
  moves: TakeEvents["moves"];
  clicks: TakeEvents["clicks"];
  captions: Array<{ startMs: number; endMs: number; text: string }>;
  spotlights: Array<{ startMs: number; endMs: number; rect: Rect }>;
  style: ResolvedStyle;
}
```

All overlay times are **source** times. The renderer maps output frame → source time via
`segments` and evaluates every layer in source time, so overlays stay locked to the video
at any speed.

### 6.3 Action hash

`sha256` of the canonical JSON of `app` (minus `mask`), `setup`, and for each step all fields
except `show` (plus `show.hold`). `render` refuses to use a take whose hash differs and says
"actions changed since the take — run `showtime record`".

## 7. Timeline rules

- **Segments.** Start with one 1× segment. If `autoSpeed`, each idle interval longer than
  800 ms becomes a segment with `speed = clamp(len / 600, 2, 8)`, so it plays in ~0.6 s.
  An explicit `show.speed` on a step overrides its `[startMs, settledMs]` span and clips any
  idle interval it overlaps. `pause` steps are always 1×; a step's `hold` tail is never part
  of an idle interval. Adjacent segments with equal speed are merged.
- **Zoom regions.** For each step with a target and zoom enabled:
  `depth = explicit ?? clamp(min(vw / (w + 160), vh / (h + 160)), 1, maxZoom)`; skip if
  `depth < 1.15`. Region = `[move.startMs, settledMs]`, focus = bbox centre.
- **Camera keyframes.** Region → `(start − 700, 1×, centre)`, `(start, d, f)`, `(end, d, f)`,
  `(end + 700, 1×, centre)`. If the next region starts within 1500 ms of this one's end, they
  connect: pan straight from `(end, d1, f1)` to `(start2, d2, f2)` without zooming out.
  Focus is clamped so the visible window stays inside the stage:
  `cx ∈ [0.5/scale, 1 − 0.5/scale]` (same for `cy`). Interpolation is easeInOutCubic.
- **Captions** from `show.caption`: `[startMs, max(settledMs, startMs + 1500)]`.
- **Spotlights** from `show.spotlight`: `[startMs, settledMs]`, rect = bbox padded by 8 px.

## 8. Renderer (Remotion)

One composition, `ShowtimeVideo`, 1920×1080 @ 30 fps, props = `Timeline`.
Duration = intro + Σ(segment length / speed).

Layers, back to front:

1. **Background**: any CSS background from `style.background`.
2. **Window**: stage scaled to fit inside the output with `padding`, `radius`, soft shadow.
   Inside the window is the **camera** (CSS transform from the current camera state). Inside
   the camera:
   - **Video**: one `<Sequence>` per segment, each an `<OffthreadVideo>` trimmed to the
     segment's source start with `playbackRate = speed`, muted.
   - **Spotlight**: rounded hole via a huge box-shadow, 250 ms fade.
   - **Click ripples**: accent-coloured ring, 0 → 48 px radius, fade over 450 ms.
   - **Cursor**: SVG arrow / hand / I-beam at the eased position (easeInOutCubic with a
     slight perpendicular arc); 0.85× squash for 120 ms on each click. Hidden until the first
     move starts.
3. **Captions** (screen space, not zoomed): bottom-centre pill, `style.font`, fade + 12 px
   slide in/out over 220 ms.
4. **Intro** (before the video): title + subtitle over the background, scale/fade in.

Rendering via `@remotion/bundler` + `@remotion/renderer` (`renderMedia`, H.264, crf 18).
The take directory is the bundle's `publicDir`, so the video is `staticFile("raw.mp4")`.
`showtime frames` uses `renderStill` at: intro midpoint, then each step's zoom peak (or
midpoint), into `frames/NN-<sceneId>-<index>.png`.

## 9. CLI

```
showtime schema                     print the script JSON Schema
showtime check  <script> [--json] [--headed]
showtime record <script> [--headed] [--keep-frames]
showtime render <script> [--out <file>]       (default <script-name>.mp4 next to the script)
showtime frames <script>                       (stills for visual QA)
showtime make   <script> [--out <file>]       check → record → render
```

Working directory: `.showtime/<script-name>/` next to the script, containing `check/`,
`take/` (`raw.mp4`, `events.json`), `timeline.json`, `frames/`.

Errors are explicit and actionable: zod issues with JSON paths; missing ffmpeg with the
install hint; locator failures with the step id and ARIA snapshot; stale take with the
re-record hint. Exit code 1 on any failure.

## 10. Claude Code integration

`skill/SKILL.md` (installed by symlink into `~/.claude/skills/showtime`) teaches the loop:

1. Clarify the story: audience, length, 2–4 features, from the pitch/PRD/code.
2. Explore the running app (Playwright MCP snapshot) to get role/text selectors.
3. Write the script (`showtime schema` for the format).
4. `showtime check` until green; fix selectors using the ARIA snapshot.
5. `showtime record`, then `showtime render`.
6. `showtime frames` and look at the PNGs: zoom framing, caption overlap, pacing.
7. Iterate on `show`/`style` with `render` only; re-record only when actions change.

## 11. Later (not MVP)

- Narration: TTS per scene, step durations stretched to audio length, burnt subtitles.
- Vertical 9:16 follow-cam and 1:1 from the same take.
- Deterministic frame-by-frame capture with virtual time (perfect 60 fps).
- MCP server (Claude Desktop), Electron studio (timeline editing), human-recorded sessions
  converted into scripts, export to an OpenScreen `.openscreen` project for manual tweaks.
- Mobile (iOS Simulator + Maestro) and desktop drivers producing the same `events.json`.

## 12. Tech and testing

TypeScript (ESM, Node ≥ 20), pnpm, zod, commander, playwright, remotion +
`@remotion/bundler` + `@remotion/renderer`, react, system ffmpeg/ffprobe, vitest.

- Unit: script schema + defaults, action hash, time mapping, segment builder, zoom depth,
  camera keyframes + evaluation, cursor interpolation.
- Integration: a local fixture app (`fixtures/demo-app`, static HTML with a form, a modal,
  and a 2 s fake loader) served on a random port; `check` passes and fails as expected;
  `record` yields `events.json` with sane values and `raw.mp4` with the expected duration
  (ffprobe); `render` of the fixture produces a playable MP4; `frames` produces PNGs.
- License note: Remotion is free for individuals and companies up to 3 people; a company
  licence is needed beyond that.
