# showTime

AI-directed product demo videos. Claude writes a JSON script; `showtime` rehearses it, records the
web app with Playwright and renders a polished MP4 with Remotion: auto-zoom on the action, a
smooth synthetic cursor, click ripples, spotlights, captions, sped-up loading and an intro card.
Change a caption and re-render in seconds; change the UI and re-take with one command.

```
demo.json ─► check  ─► fix selectors (Claude)
demo.json ─► record ─► take/raw.mp4 + take/events.json
script + events ─► timeline.json ─► Remotion ─► demo.mp4
```

## Install

Requirements: Node ≥ 20 and ffmpeg (`brew install ffmpeg`).

```bash
npm install
npx playwright install chromium
npm link                # puts `showtime` on your PATH
npm run install-skill   # links the Claude Code skill to ~/.claude/skills/showtime
```

## Try it

```bash
npm run fixture                    # demo app on http://127.0.0.1:4777
showtime make fixtures/demo.json   # → fixtures/demo.mp4
```

## Commands

| command | what it does |
|---|---|
| `showtime schema` | print the script JSON Schema |
| `showtime check <script> [--json] [--headed]` | rehearse; screenshot per step; first failure with ARIA snapshot |
| `showtime record <script> [--headed] [--keep-frames]` | record a take into `.showtime/<name>/take` |
| `showtime render <script> [-o out.mp4]` | render from the last take (no re-recording) |
| `showtime frames <script>` | QA stills: intro + one per step |
| `showtime make <script> [-o out.mp4]` | check → record → render |

The script format and the director's workflow are documented in [`skill/SKILL.md`](skill/SKILL.md);
the design is in [`docs/superpowers/specs/2026-10-13-showtime-design.md`](docs/superpowers/specs/2026-10-13-showtime-design.md).

## Development

```bash
npm test            # unit tests (fast)
npm run test:int    # Playwright + ffmpeg + Remotion integration tests (slow)
npm run typecheck
```

## Licensing note

Remotion is free for individuals and companies of up to 3 people; larger companies need a
Remotion company licence. The renderer only consumes `timeline.json`, so it can be swapped.
