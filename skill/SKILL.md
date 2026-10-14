---
name: showtime
description: Use when the user wants a product demo video, walkthrough, screencast or feature recording of a web app (for a pitch, talk, README or social post). Write a showTime JSON script, rehearse it, record it and render a polished MP4 (or a 9:16 cut, GIF or WebP) with auto-zoom, smooth cursor, captions, narration and sped-up loading via the `showtime` CLI.
---

# showTime — scripted demo videos

`showtime` turns a JSON script into a polished 1080p MP4. You are the director: you write the
script; the CLI clicks through the app, records it and edits it (zoom, cursor, ripples,
spotlights, captions, speed-ups, intro card, narration, music, subtitles). One take renders as
16:9, 9:16 or 1:1, as MP4, GIF or WebP.

## Setup

Run `showtime --help`. If the command is missing, install it (needs Node ≥ 20 and ffmpeg):

```bash
npm install -g @mineo71/showtime
showtime setup    # downloads the browsers it records with
```

## Workflow

1. **Story first.** Settle the audience, target length (30–120 s), the 2–4 moments that sell the
   product, and the URL of a running app (a local dev server is best). Read the pitch, PRD or
   routes if they exist. Plan one scene per moment.
2. **Explore the app:** `showtime inspect <url>` lists every named control on a page with a ready
   target (and how many elements it matches) and saves a screenshot to look at. Run it on each
   page of the flow. A browser tool (e.g. the Playwright MCP) helps for flows behind clicks. Prefer
   the role targets it prints, `text=…`, `#id`, `[data-testid=…]` over long CSS chains. If the app
   isn't running, add `server` to the script (`{ "run": "npm run dev", "url": "…" }`): showTime
   starts it for `check` and `record` and stops it afterwards.
3. **Write the script** in the project, e.g. `demo/pitch.json`. Run `showtime schema` for the
   complete format.
4. **Rehearse:** `showtime check demo/pitch.json`. On failure read the error, the ARIA snapshot it
   prints and `.showtime/<name>/check/failure.png`; fix the selector or add a `wait`, repeat until
   green. When a later part is expensive (paid AI calls, real sends), rehearse up to the step before
   it with `--until scene#n`.
5. **Lint:** `showtime lint demo/pitch.json` and fix every warning (long captions, pauses that
   should be waits, zoom or spotlight on steps without a target).
6. **Record:** `showtime record demo/pitch.json` (runs in real time).
7. **Render:** `showtime render demo/pitch.json` → `demo/pitch.mp4`. For social posts add
   `--aspect 9:16` (→ `demo/pitch-9x16.mp4`); for a README or docs `--format gif` or `--format webp`
   (`--width` sets the size). Each is a render of the same take, never a new recording.
8. **QA:** `showtime frames demo/pitch.json`, then Read the contact sheet it prints first
   (`sheet.png`: every step in one image); open single stills only to look closer. Check that zoom
   lands on the right control, captions are legible, and pacing feels right. Run `showtime lint`
   again: with a take it also flags captions on screen too briefly to read.
9. **Iterate:** edits to `show` (including `say`), `style`, `meta` or `audio` only need `render`. Edits to actions (`do`,
   targets, text, `hold`, `app`) need `record` again — `render` refuses a stale take.

`showtime make <script>` runs check → record → render in one go. Every command takes `--json`
and then prints exactly one JSON document on stdout.

## Long-running commands

`record` runs in real time and then encodes; `render`, `frames` and `make` bundle and render with
Remotion. They routinely take several minutes. In Claude Code run them with `timeout: 600000`, or
with `run_in_background: true` and wait for the completion notification. In Codex and other
agents, give the command a timeout of at least 10 minutes.
A `record` that fails or is stopped halfway leaves the previous take in place.

## When the person wants to take over

- **Fine-tuning by hand:** suggest `showtime studio <script>`. It opens a local page with the video,
  a step timeline and an inspector; their edits are written to the script. It runs until Ctrl+C, so
  start it in the background if you start it at all, and **re-read the script before you edit it
  again**: the person may have changed it. Your own edits to the file show up in their page live.
- **Showing instead of telling:** if the person would rather click through the flow than describe
  it, ask them to run `showtime record-human <url> -o demo/flow.json` (it opens a browser window;
  they close it when done). Then add captions, `say` lines and waits to the result and continue
  with `check`.

## Narration and sound

Give a step `"say": "…"` and a voice reads it from the start of that step. The video holds the
frame until the line ends before the next narrated step begins, so a line may cover several quick
steps. Write one short sentence per moment about the benefit, not the clicks. `showtime lint`
(with a take) flags lines that hold the frame for seconds (`narration-stretch`): shorten them.

```
"audio": { "voice": { "engine": "system" }, "sounds": true, "subtitles": "burn" }
```

- `voice.engine`: `system` (macOS `say`, Linux `espeak-ng`; free and offline) is the default.
  Use `openai` or `elevenlabs` only when the user asks for a better voice and the key is in the
  environment (`OPENAI_API_KEY` / `ELEVENLABS_API_KEY`); never write keys into the script. Those
  engines send the narration text to the provider. `command` runs any TTS that reads stdin and
  writes `{out}` (inserted already quoted: write it bare, e.g. `piper -m en_US.onnx -f {out}`).
- Pick a voice with `showtime voices --lang <code>` and audition it with
  `showtime voices --try "…" --voice <name>`; a step's `show.voice` changes the voice for its line
  (a second narrator).
- `sounds`: `true`/`"soft"`, `"mechanical"`, `"pop"`, `"tap"`, `"typewriter"`, or
  `{ pack, click: "file.wav", key: "file.wav", volume }`.
- `music: { file, volume? }` adds a looped bed that ducks under the voice; only use files the user
  provides.
- `subtitles`: `file` (default) writes `<video>.srt`; `burn` also draws them (good for 9:16, which
  is often watched muted); `off`.
- `--no-audio` renders without the soundtrack. GIF, WebP and `--no-audio` leave narration out
  (no voice needed, no pauses for it) unless subtitles are burned in.

## Side effects

`check` performs every action for real (it is a full run, just fast), and `record` repeats them.
Flows that create data ("New project", sign-up, checkout) can collide on the second run
("name already exists"). Add `hooks` that reset the data: `before` hooks run at the start of every
`check` and `record`, `after` hooks when they end.

```
"hooks": { "before": [{ "run": "npm run db:reset" }] }
```

A hook is `{ "run": "<shell command, run in the script folder>" }` or
`{ "request": { "url": "…", "method": "POST", "json": {…} } }`. If the project has no reset command,
ask the user for one rather than guessing.

## Example

```json
{
  "version": 1,
  "meta": { "title": "Acme Analytics", "subtitle": "Reports in two clicks" },
  "app": {
    "url": "http://localhost:3000/",
    "viewport": { "width": 1440, "height": 900 },
    "mask": [".customer-email"]
  },
  "setup": [{ "do": "click", "target": "text=Accept cookies" }],
  "style": { "accent": "#6366f1" },
  "scenes": [
    {
      "id": "report",
      "steps": [
        { "do": "click", "target": "role=button[name='New report']", "show": { "caption": "A report in one click" } },
        { "do": "type", "target": "#report-name", "text": "Q3 revenue" },
        { "do": "select", "target": "#period", "value": "30d" },
        { "do": "click", "target": "role=button[name='Create']" },
        { "do": "wait", "for": "text=Report ready" },
        { "do": "hover", "target": ".cashback", "show": { "spotlight": true, "caption": "Cashback at a glance", "hold": 1500 } }
      ]
    }
  ]
}
```

## Reference

- **Actions (`do`):** `goto {url}` · `click {target}` · `type {target, text, pace?: human|fast|ms, clear?}` ·
  `press {key}` · `hover {target}` · `select {target, value}` · `scroll {target} | {by}` ·
  `wait {for} | {ms}` · `pause {ms}`
- **`show` (per step):** `zoom` (number, or `false`), `caption`, `spotlight` (`true`/`dim`, `ring`,
  `glow`), `highlight` (CSS colour), `click` (`ripple`, `pulse`, `burst`, `ring`, `none`), `hold`
  (ms, real time), `speed`, `say` (narration), `voice` (changes to `audio.voice` for this line).
- **`audio`:** `voice` (`{ engine: system | openai | elevenlabs | command, name?, speed?, model?,
  instructions?, command? }`), `music` (`{ file, volume? }`), `sounds` (clicks and keystrokes),
  `subtitles` (`file` | `burn` | `off`), `clips` (`[{ file, at: "scene#n", offsetMs?, volume? }]`:
  the app's own sounds, which the capture can't hear).
- **`style`:** `background` (any CSS background), `chrome` (`browser` window frame | `none`), `address`
  (address-bar text), `padding`, `radius`, `shadow`, `font`, `accent`, `autoZoom`, `autoSpeed`, `maxZoom`,
  `click` (default click animation), `spotlightDim`, `captionStyle` (`dark`, `light`, `accent`,
  `outline`, `bar`), `captionFont`, `titleFont`, `captionSize`, `fonts` (`[{ family, file }]`, embedded),
  `watermark` (`{ text?, image?, position?, opacity?, size? }`).
- **`app`:** `url`, `viewport`, `deviceScaleFactor`, `storageState` (Playwright storage-state JSON,
  path relative to the script), `colorScheme`, `locale`, `timezoneId`, `mask` (CSS selectors to blur —
  plain CSS only, not `text=` / `role=`), `hide` (CSS selectors to hide: dev badges such as Next.js's
  `nextjs-portal`, chat widgets), `reducedMotion` (`reduce` for sites with scroll-reveal animations), `mock` (`[{ url: "**/api/x*", json | body, status?,
  method?, delayMs? }]`), `clock` (ISO date-time the page clock starts at; first matching mock wins), `dialogs` (`accept` | `dismiss`).
  Relative `goto` URLs resolve against `app.url`.
- **`meta`:** `title`, `subtitle` (intro card), `logo` (SVG/PNG/JPEG/WebP), `outro`
  (`{ title, subtitle?, url? }`, closing card).
- **`hooks`:** `before` / `after` lists of `{ run }` or `{ request }`.
- **`server`:** `{ run, url?, timeoutMs? }`: start the app for `check`/`record` (an app already
  answering at the URL is reused).
- **`wait`** takes `timeoutMs` (default 15000, up to 300000) for pages waiting on slow backends.
- **Brand file:** `showtime.config.json` in the script's folder or above holds default `style`,
  `meta` (logo, outro) and `audio` for every script; the script's own fields win.
- **Render options** (`render`, `make`): `-o <file>`, `--aspect 16:9|9:16|1:1`,
  `--format mp4|gif|webp`, `--width <px>`, `--fps <n>`, `--scenes a,b` (a short cut, no cards),
  `--no-audio`. `frames --aspect` reviews a crop.
- Output lands next to the script; working files in `.showtime/<script-name>/`.

## Direction tips

- One idea per caption, at most ~6 words. Caption the benefit ("Paid in two clicks"), not the
  click ("Click Pay").
- After a payoff screen add `hold` (800–2000 ms) so viewers can read it; put `spotlight` on the one
  number that matters.
- Never `pause` to wait for loading — use `wait {for}`; auto-speed compresses the loader.
- Use `setup` for cookie banners and onboarding, `app.storageState` to start logged in, `app.mask`
  to blur personal data.
- Mock APIs that are slow, random or need real accounts (`app.mock`), and pin the date
  (`app.clock`) so every take shows the same numbers and timestamps.
- End pitch demos with `meta.outro`: the product name and the URL to visit. Put brand colours, logo
  and outro in `showtime.config.json` when a project has several demos.
- Keep the default 1440×900 viewport at `deviceScaleFactor` 2 for crisp 16:9 zooms.
- For a 9:16 cut, review it with `showtime frames <script> --aspect 9:16`: the camera follows each
  target, so check that every step's target is the thing worth showing.
