---
name: showtime
description: Use when the user wants a product demo video, walkthrough, screencast or feature recording of a web app (for a pitch, talk, README or social post). Write a showTime JSON script, rehearse it, record it and render a polished MP4 with auto-zoom, smooth cursor, captions and sped-up loading via the `showtime` CLI.
---

# showTime — scripted demo videos

`showtime` turns a JSON script into a polished 1080p MP4. You are the director: you write the
script; the CLI clicks through the app, records it and edits it (zoom, cursor, ripples,
spotlights, captions, speed-ups, intro card).

## Workflow

1. **Story first.** Settle the audience, target length (30–120 s), the 2–4 moments that sell the
   product, and the URL of a running app (a local dev server is best). Read the pitch, PRD or
   routes if they exist. Plan one scene per moment.
2. **Explore the app** with the Playwright MCP (`browser_navigate`, `browser_snapshot`) to learn
   the flow and pick selectors from the accessibility snapshot. Prefer
   `role=button[name='Save']`, `text=…`, `#id`, `[data-testid=…]` over long CSS chains.
3. **Write the script** in the project, e.g. `demo/pitch.json`. Run `showtime schema` for the
   complete format.
4. **Rehearse:** `showtime check demo/pitch.json`. On failure read the error, the ARIA snapshot it
   prints and `.showtime/<name>/check/failure.png`; fix the selector or add a `wait`, repeat until
   green.
5. **Record:** `showtime record demo/pitch.json` (runs in real time).
6. **Render:** `showtime render demo/pitch.json` → `demo/pitch.mp4`.
7. **QA:** `showtime frames demo/pitch.json`, then Read the PNGs it lists. Check that zoom lands on
   the right control, captions are legible and do not hide the action, and pacing feels right.
8. **Iterate:** edits to `show`, `style` or `meta` only need `render`. Edits to actions (`do`,
   targets, text, `hold`, `app`) need `record` again — `render` refuses a stale take.

`showtime make <script>` runs check → record → render in one go.

## Long-running commands

`record` runs in real time and then encodes; `render`, `frames` and `make` bundle and render with
Remotion. They routinely take longer than the default 2-minute Bash timeout. Run them with
`timeout: 600000`, or with `run_in_background: true` and wait for the completion notification.
Never let a `record` be killed halfway: it replaces the previous take.

## Side effects

`check` performs every action for real (it is a full run, just fast), and `record` repeats them.
Flows that create data ("New project", sign-up, checkout) can collide on the second run
("name already exists"). Use a resettable demo account or seed data, make names unique, or undo
the change in `setup`; after a green `check`, reset the data before `record`.

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
  plain CSS only, not `text=` / `role=`).
- Output lands next to the script; working files in `.showtime/<script-name>/`.

## Direction tips

- One idea per caption, at most ~6 words. Caption the benefit ("Paid in two clicks"), not the
  click ("Click Pay").
- After a payoff screen add `hold` (800–2000 ms) so viewers can read it; put `spotlight` on the one
  number that matters.
- Never `pause` to wait for loading — use `wait {for}`; auto-speed compresses the loader.
- Use `setup` for cookie banners and onboarding, `app.storageState` to start logged in, `app.mask`
  to blur personal data.
- Keep the default 1440×900 viewport at `deviceScaleFactor` 2 for crisp 16:9 zooms.
