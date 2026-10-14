# Changelog

## Unreleased

- New actions: `dblclick`; `click` with `button` (`right` for context menus, `middle`) and
  `modifiers` (`Shift`, `ControlOrMeta`, …); `drag` from a target to another (`to`) or by an offset
  (`by`), for boards, sliders and resizers; `upload` through the button a person clicks, or straight
  into a hidden file input; `closeTab`.
- Tabs and popups: a step that opens one is followed, and the video shows it; when it closes (by
  itself, like an OAuth window, or with `closeTab`) the page before it comes back.
- Keys on screen: presses with a modifier (and modifier clicks) show as keycaps; `style.keys`
  (`combos`, `all`, `off`). A `press` plays a key sound with `audio.sounds`.
- `record-human` keeps double, right and modifier clicks, file picks and popups.
- The integration suite (recording, encoding, rendering) runs on Linux in CI, and a release is
  published only when it passes.
- The studio's Record picks the network mode for scripts with `replay`.

### Fixed

- Ctrl+C stops a running hook and everything it started.
- Replay globs without a scheme (`**/ws`) route WebSockets too.
- Service workers are blocked when the script mocks or replays requests, so they can't answer in
  the mocks' place.
- `check --until` says it records nothing and marks its report (`until`); `--locales` errors name
  `--locales` and are reported before anything runs.
- Locale tags with three parts (`zh-Hant-TW`).
- The replay file's temporary name is unique per run.
- Studio: Freeze and Hold refuse text that isn't a whole number instead of clearing the value; a
  page from an earlier session is told to reload; a brand file created after the start is picked
  up; Record and Render refuse an invalid script instead of running the last good one.

## 0.8.0 — 2026-10-14

- Network replay: `replay: { file, match }` records the answers of matching HTTP requests and
  WebSockets on the first run and serves them back after that, so rehearsals and takes stop
  spending API quota and come out the same every time. `--net auto|live|record|replay` on `check`,
  `record` and `make`. No request headers or client text messages are stored; credential-like
  query values are stripped. Event streams stay live. Each locale keeps its own file.
- Locales: `locales: ["en", "uk"]`, any value written as `{ "en": …, "uk": … }`, `{locale}` in
  strings. `--locale` on every command; `make --locales all|en,uk` and `render --locales …` write
  `<name>.<locale>.mp4` for each. The studio opens one locale (`--locale`) and edits only its values.
- Timing by hand in the studio: drag a step's right edge to set its speed, drag a caption's right
  edge to set how long it stays (`show.captionMs`), and freeze a step's last frame
  (`show.freezeMs`). All three are presentation only: no new take.

## 0.7.0 — 2026-10-14

- Sound packs: `audio.sounds` takes `soft` (what `true` means), `mechanical`, `pop`, `tap` or
  `typewriter`, or `{ pack, click, key, volume }` with your own files.
- Click animations: `style.click` and `show.click` (`ripple`, `pulse`, `burst`, `ring`, `none`).
- Highlights: `show.highlight` colours a step's click animation and spotlight; `show.spotlight` takes
  `dim`, `ring` or `glow`; `style.spotlightDim`.
- Overlay text: `style.captionStyle` (`dark`, `light`, `accent`, `outline`, `bar`), `captionFont`,
  `titleFont`, `captionSize`, and `style.fonts` to embed font files in the video.
- `style.watermark`: text and/or an image in a corner of every frame.
- Voices: `show.voice` changes the voice for one line; `showtime voices` lists an engine's voices
  (`--lang`) and tries one (`--try`, `--play`).
- The studio edits click animations, spotlight styles, highlight colours, caption style and font,
  the watermark and the sound pack.

## 0.6.0 — 2026-10-14

- `showtime inspect <url>`: every named control on a page with a ready target and how many
  elements it matches, plus a full-page screenshot.
- `server`: showTime starts the app for `check` and `record` (and the studio's Record), waits until
  it answers and stops it afterwards; a server that already answers is reused.
- `app.hide` (hide dev badges, chat widgets) and `app.reducedMotion` (scroll-reveal content shows at
  once).
- `wait.timeoutMs` for slow backends; `check --until scene#n` rehearses part of a script.
- Captions stay on screen until they can be read (`max(1.5 s, 0.5 s + 0.25 s × words)` of output
  time) unless the next caption starts.
- Burned subtitles get a band of their own under the window in 16:9 and 1:1 instead of covering
  the app; captions keep their usual place.
- `audio.clips`: the app's own sounds, placed at a step; music ducks under them.
- `render --scenes a,b` cuts a short clip (subtitles cut to match); `--fps` for GIF and WebP.

## 0.5.0 — 2026-10-13

- `showtime studio <script>`: a local page with a live preview (the same components the renderer
  uses), a timeline of the steps and an inspector for caption, narration, zoom, spotlight, speed
  and hold, plus the title, colours and window. Edits are validated and saved to the script; the
  page reloads when the file changes on disk; render (MP4, GIF, WebP) and record from the page;
  preview 16:9, 9:16 or 1:1. Listens on 127.0.0.1 only, with a per-session token.
- `showtime record-human <url>`: click through the app in a browser; closing the window writes a
  script of the steps with readable selectors.

## 0.4.0 — 2026-10-13

- Narration: `show.say` on any step is spoken by a TTS engine (`audio.voice`: the macOS/Linux
  system voice, OpenAI, ElevenLabs or any command). The video holds the frame until a line ends.
  Lines are cached; editing them needs no new take.
- `audio.music`: a looped music bed that ducks under the voice. `audio.sounds`: click and
  keystroke sounds (takes now log keystrokes; older takes spread them over each `type` step).
- Subtitles from the narration: an `.srt` next to the video, or burned in (`audio.subtitles`).
- `--aspect 9:16 | 1:1` on `render`, `make` and `frames`: cropped cuts with a camera that follows
  the action, from the same take. Stills of a crop go to `frames-9x16/` or `frames-1x1/`.
- `--format gif | webp` (or an `-o` with that extension) and `--width`; `--no-audio`. Silent
  outputs skip narration (no voice needed) unless subtitles are burned in.
- `render --json` adds `subtitles`; the brand file accepts `audio`.
- `lint`: `narration-stretch` flags lines that hold the frame for long.

## 0.3.0 — 2026-10-13

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
