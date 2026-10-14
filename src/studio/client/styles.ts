/** The studio page's stylesheet (inlined by the server). */
export const STYLES = `
:root {
  color-scheme: dark;
  --bg: #0b1120; --panel: #111a2e; --panel-2: #16213a; --line: #24304a; --text: #e2e8f0; --muted: #8a99b3;
  --accent: #818cf8; --accent-2: #6366f1; --ok: #22c55e; --warn: #f59e0b; --bad: #f87171;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.45 Inter, -apple-system, "Segoe UI", system-ui, sans-serif; }
button, input, select, textarea { font: inherit; color: inherit; }
.loading { display: grid; place-items: center; height: 100%; color: var(--muted); }
.studio { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; height: 100%; overflow: hidden; }
.muted { color: var(--muted); font-weight: 400; }

.top { display: flex; align-items: center; gap: 16px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); }
.brand { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.brand .dot { width: 10px; height: 10px; border-radius: 50%; background: linear-gradient(135deg, #a78bfa, #6366f1); margin-right: 4px; }
.brand .file { margin-left: 10px; padding: 2px 8px; border-radius: 6px; background: var(--panel-2); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.segmented { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.segmented button { border: 0; background: transparent; padding: 5px 12px; cursor: pointer; color: var(--muted); }
.segmented button.on { background: var(--panel-2); color: var(--text); }
.actions { display: flex; gap: 8px; align-items: center; }
.render { display: flex; }
.render select { border: 1px solid var(--line); border-right: 0; border-radius: 8px 0 0 8px; background: var(--panel-2); padding: 5px 8px; }
button.primary, button.ghost, .banner button { border-radius: 8px; padding: 6px 14px; cursor: pointer; border: 1px solid var(--line); }
button.primary { background: var(--accent-2); border-color: var(--accent-2); color: white; font-weight: 600; border-radius: 0 8px 8px 0; }
button.ghost, .banner button { background: transparent; }
button:disabled { opacity: 0.45; cursor: default; }

.banners { display: flex; flex-direction: column; }
.banner { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 16px; border-bottom: 1px solid var(--line); }
.banner pre { flex-basis: 100%; margin: 4px 0 0; white-space: pre-wrap; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #fecaca; }
.banner.error { background: #2a1215; } .banner.warn { background: #2a2010; } .banner.info { background: #10213a; } .banner.done { background: #0f2a1a; }
.banner.job { background: var(--panel-2); }
.banner code { font-size: 12px; }
.bar { flex: 1; max-width: 360px; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent-2); transition: width 0.2s; }

.work { display: grid; grid-template-columns: minmax(0, 1fr) 340px; min-height: 0; }
.stage { display: flex; align-items: center; justify-content: center; padding: 20px; min-height: 0; min-width: 0; overflow: hidden; container-type: size; background: radial-gradient(circle at 50% 40%, #131d35, var(--bg) 70%); }
.stage.empty { color: var(--muted); }
.side { border-left: 1px solid var(--line); background: var(--panel); overflow-y: auto; }
.panel { padding: 14px 16px 18px; border-bottom: 1px solid var(--line); }
.panel.hint { color: var(--muted); }
.panel h2 { margin: 0 0 12px; font-size: 13px; font-weight: 600; display: flex; gap: 8px; align-items: baseline; }
.panel h2 .muted { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.label { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; }
.label small { opacity: 0.7; }
.row input, .row textarea, .row select { width: 100%; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel-2); outline: none; resize: vertical; }
.row input:focus, .row textarea:focus, .row select:focus { border-color: var(--accent); }
.row input.invalid { border-color: #ef4444; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.check { display: flex; align-items: center; gap: 8px; margin: 6px 0 10px; cursor: pointer; }
.color { display: flex; align-items: center; gap: 8px; }
.color input { width: 36px !important; height: 30px; padding: 2px !important; }
button.link { border: 0; background: none; color: var(--accent); cursor: pointer; padding: 0; }

.timeline { border-top: 1px solid var(--line); background: var(--panel); padding: 12px 16px 16px; }
.track { position: relative; height: 72px; border-radius: 10px; background: var(--panel-2); overflow: hidden; cursor: pointer; }
.track > .step, .track > .card { position: absolute; top: 6px; bottom: 6px; border-radius: 7px; padding: 5px 7px; overflow: hidden; white-space: nowrap; display: flex; flex-direction: column; gap: 1px; border: 1px solid transparent; }
.track > .card { background: #1d2742; color: var(--muted); justify-content: center; font-size: 12px; }
.track > .step { background: #1f2a48; border-color: #2c3a5e; }
.track > .step:hover { border-color: var(--accent); }
.track > .step.playing { background: #26335a; }
.track > .step.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; background: #2a3566; }
.track > .step.unplaced { display: none; }
.step .name { font-size: 11px; color: var(--muted); }
.step .do { font-weight: 600; font-size: 12px; }
.step .icons i { font-style: normal; font-size: 11px; margin-right: 3px; opacity: 0.85; }
.grip { position: absolute; top: 0; right: 0; bottom: 0; width: 9px; cursor: ew-resize; border-right: 3px solid transparent; touch-action: none; }
.grip:hover, .dragging .grip, .cap:hover .grip { border-right-color: var(--accent); }
.track > .step.dragging { border-color: var(--accent); z-index: 2; }
.track.captions { height: 30px; margin-bottom: 6px; cursor: default; }
.track > .cap { position: absolute; top: 4px; bottom: 4px; border-radius: 6px; padding: 3px 12px 3px 7px; background: #33295a; border: 1px solid #4a3d80; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.track > .freeze { position: absolute; top: 6px; bottom: 6px; border-radius: 0 7px 7px 0; pointer-events: none; background: repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0 5px, transparent 5px 10px); }
.playhead { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fbbf24; pointer-events: none; box-shadow: 0 0 8px #fbbf24aa; }
.toast { position: fixed; right: 16px; bottom: 112px; max-width: 520px; padding: 10px 14px; border-radius: 10px; background: #3b1219; border: 1px solid #7f1d1d; white-space: pre-wrap; cursor: pointer; box-shadow: 0 10px 30px #0008; }
@media (max-width: 900px) { .work { grid-template-columns: 1fr; } .side { border-left: 0; border-top: 1px solid var(--line); } }
`;
