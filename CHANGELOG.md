# Changelog

## Unreleased

- `showtime frames` also renders a contact sheet (`frames/sheet.png`) of every step.
- `showtime lint`: long captions, pauses that should be waits, zoom/spotlight that cannot apply,
  and, with a take, captions too brief to read and overall length.
- `--json` on every command.
- `hooks.before` / `hooks.after`: shell commands or HTTP calls around every `check` and `record`,
  so state can be reset between rehearsal and take.
- `app.mock` (canned responses for matching requests), `app.clock` (the page clock starts at a fixed date),
  `app.dialogs` (accept or dismiss native dialogs; accepted by default).
- Safe re-takes: a failed `record` leaves the previous take untouched (`take.tmp` keeps the failure).
- Settling ignores event streams; relative `goto` URLs resolve against `app.url`.
- Captions never overlap, and move to the top when the action is at the bottom of the screen.
- `meta.outro` closing card and `meta.logo` on the intro and outro cards.
- `showtime.config.json` brand file with default `style` and `meta` for every script below it.
- Takes recorded with 0.2 stay valid.

## 0.2.1 — 2026-10-13

- Releases are automated: `npm version patch|minor|major` dates the changelog, tags and pushes;
  the `release` workflow publishes to npm through trusted publishing (with provenance) and
  creates the GitHub Release.

## 0.2.0 — 2026-10-13

- Published to npm as `@mineo71/showtime`.
- `showtime setup`: downloads the Chromium build Playwright drives and Remotion's headless
  shell, and links the skill into Claude Code (`~/.claude/skills`) and Codex (`~/.agents/skills`).
- The skill works with Codex: agent-neutral instructions, a setup step.
- Browser window chrome around the take (`style.chrome`, `style.address`); the window eases in
  after the intro card.
- `examples/fennel`: a showcase app and script; `npm run example`, `npm run media`.
- `docs/script.schema.json` for editor autocomplete (`"$schema"` in your script).

## 0.1.0 — 2026-10-13

First release: `showtime check | record | render | frames | make`, the Claude Code skill,
auto-zoom, synthetic cursor, click ripples, spotlights, captions, auto speed-up of idle time,
intro card, privacy masks, stale-take detection.
