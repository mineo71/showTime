# Changelog

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
