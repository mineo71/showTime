---
name: showtime
description: Use when the user wants a product demo video, walkthrough, screencast or feature recording of a web app (for a pitch, talk, README or social post). Write a showTime JSON script, rehearse it, record it and render a polished MP4 with auto-zoom, smooth cursor, captions and sped-up loading via the `showtime` CLI.
---

# showTime — scripted demo videos

`showtime` turns a JSON script into a polished 1080p MP4. You are the director: you write the
script; the CLI clicks through the app, records it and edits it (zoom, cursor, ripples,
spotlights, captions, speed-ups, intro card).

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
2. **Explore the app** with a browser tool if you have one (e.g. the Playwright MCP:
   `browser_navigate`, `browser_snapshot`) to learn the flow and pick selectors from the
   accessibility snapshot. Without one, read the routes and templates and let `showtime check`
   show you the page (it prints an ARIA snapshot when a step fails). Prefer
   `role=button[name='Save']`, `text=…`, `#id`, `[data-testid=…]` over long CSS chains.
3. **Write the script** in the project, e.g. `demo/pitch.json`. Run `showtime schema` for the
   complete format.
4. **Rehearse:** `showtime check demo/pitch.json`. On failure read the error, the ARIA snapshot it
   prints and `.showtime/<name>/check/failure.png`; fix the selector or add a `wait`, repeat until
   green.
5. **Lint:** `showtime lint demo/pitch.json` and fix every warning (long captions, pauses that
   should be waits, zoom or spotlight on steps without a target).
6. **Record:** `showtime record demo/pitch.json` (runs in real time).
7. **Render:** `showtime render demo/pitch.json` → `demo/pitch.mp4`.
8. **QA:** `showtime frames demo/pitch.json`, then Read the contact sheet it prints first
   (`sheet.png`: every step in one image); open single stills only to look closer. Check that zoom
   lands on the right control, captions are legible, and pacing feels right. Run `showtime lint`
   again: with a take it also flags captions on screen too briefly to read.
9. **Iterate:** edits to `show`, `style` or `meta` only need `render`. Edits to actions (`do`,
   targets, text, `hold`, `app`) need `record` again — `render` refuses a stale take.

`showtime make <script>` runs check → record → render in one go. Every command takes `--json`
and then prints exactly one JSON document on stdout.

## Long-running commands

`record` runs in real time and then encodes; `render`, `frames` and `make` bundle and render with
Remotion. They routinely take several minutes. In Claude Code run them with `timeout: 600000`, or
with `run_in_background: true` and wait for the completion notification. In Codex and other
agents, give the command a timeout of at least 10 minutes.
Never let a `record` be killed halfway: it replaces the previous take.

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
- **`show` (per step):** `zoom` (number, or `false`), `caption`, `spotlight`, `hold` (ms, real time),
  `speed`.
- **`style`:** `background` (any CSS background), `chrome` (`browser` window frame | `none`), `address`
  (address-bar text), `padding`, `radius`, `shadow`, `font`, `accent`, `autoZoom`, `autoSpeed`, `maxZoom`.
- **`app`:** `url`, `viewport`, `deviceScaleFactor`, `storageState` (Playwright storage-state JSON,
  path relative to the script), `colorScheme`, `locale`, `timezoneId`, `mask` (CSS selectors to blur —
  plain CSS only, not `text=` / `role=`), `mock` (`[{ url: "**/api/x*", json | body, status?,
  method?, delayMs? }]`), `clock` (ISO date-time; freezes `Date`), `dialogs` (`accept` | `dismiss`).
  Relative `goto` URLs resolve against `app.url`.
- **`meta`:** `title`, `subtitle` (intro card), `logo` (SVG/PNG/JPEG/WebP), `outro`
  (`{ title, subtitle?, url? }`, closing card).
- **`hooks`:** `before` / `after` lists of `{ run }` or `{ request }`.
- **Brand file:** `showtime.config.json` in the script's folder or above holds default `style` and
  `meta` (logo, outro) for every script; the script's own fields win.
- Output lands next to the script; working files in `.showtime/<script-name>/`.

## Direction tips

- One idea per caption, at most ~6 words. Caption the benefit ("Paid in two clicks"), not the
  click ("Click Pay").
- After a payoff screen add `hold` (800–2000 ms) so viewers can read it; put `spotlight` on the one
  number that matters.
- Never `pause` to wait for loading — use `wait {for}`; auto-speed compresses the loader.
- Use `setup` for cookie banners and onboarding, `app.storageState` to start logged in, `app.mask`
  to blur personal data.
- Mock APIs that are slow, random or need real accounts (`app.mock`), and freeze the date
  (`app.clock`) so every take shows the same numbers and timestamps.
- End pitch demos with `meta.outro`: the product name and the URL to visit. Put brand colours, logo
  and outro in `showtime.config.json` when a project has several demos.
- Keep the default 1440×900 viewport at `deviceScaleFactor` 2 for crisp 16:9 zooms.
