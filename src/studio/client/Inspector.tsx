import type { FC } from 'react';
import type { Edit } from '../edit';
import type { StepInfo, StudioState } from '../server';
import { ColorInput, Row, TextField } from './fields';

const ZOOMS = ['auto', 'off', '1.25', '1.5', '1.8', '2', '2.5', '3'];
const CLICKS = ['default', 'ripple', 'pulse', 'burst', 'ring', 'none'];
const SPOTLIGHTS = ['off', 'dim', 'ring', 'glow'];
const SPEEDS = ['auto', '0.5', '1', '1.5', '2', '4'];

export const Inspector: FC<{ step: StepInfo | null; take: StudioState['take']; accent?: string; onEdit: (edit: Edit) => void }> = ({ step, accent, onEdit }) => {
  if (!step) return <section className="panel hint">Select a step on the timeline to edit how it is presented.</section>;
  const show = step.show as {
    caption?: string;
    say?: string;
    zoom?: number | false;
    spotlight?: boolean | 'dim' | 'ring' | 'glow';
    speed?: number;
    hold?: number;
    highlight?: string;
    click?: string;
    freezeMs?: number;
  };
  const spotlight = show.spotlight === undefined || show.spotlight === false ? 'off' : show.spotlight === true ? 'dim' : show.spotlight;
  const set = (changes: Record<string, unknown>) => onEdit({ where: step.where, step: step.id, show: changes } as Edit);
  const zoom = show.zoom === false ? 'off' : show.zoom === undefined ? 'auto' : String(show.zoom);
  const speed = show.speed === undefined ? 'auto' : String(show.speed);
  // A value the agent wrote that isn't in the list is still shown as itself.
  const zooms = ZOOMS.includes(zoom) ? ZOOMS : [...ZOOMS, zoom];
  const speeds = SPEEDS.includes(speed) ? SPEEDS : [...SPEEDS, speed];
  return (
    <section className="panel">
      <h2>
        {step.where} <span className="muted">{step.label}</span>
      </h2>
      <Row label="Caption" hint="6 words or fewer">
        <TextField field="caption" value={show.caption} placeholder="What the viewer should notice" onCommit={(v) => set({ caption: v })} />
      </Row>
      <Row label="Narration" hint="⌘↵ to save">
        <TextField field="say" multiline value={show.say} placeholder="A line the voice reads" onCommit={(v) => set({ say: v })} />
      </Row>
      <div className="pair">
        <Row label="Zoom">
          <select data-field="zoom" value={zoom} onChange={(e) => set({ zoom: e.target.value === 'auto' ? null : e.target.value === 'off' ? false : Number(e.target.value) })}>
            {zooms.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Speed">
          <select data-field="speed" value={speed} onChange={(e) => set({ speed: e.target.value === 'auto' ? null : Number(e.target.value) })}>
            {speeds.map((s) => (
              <option key={s} value={s}>
                {s === 'auto' ? 'auto' : `${s}×`}
              </option>
            ))}
          </select>
        </Row>
      </div>
      <div className="pair">
        <Row label="Spotlight">
          <select data-field="spotlightKind" value={spotlight} onChange={(e) => set({ spotlight: e.target.value === 'off' ? null : e.target.value === 'dim' ? true : e.target.value })}>
            {SPOTLIGHTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Click">
          <select data-field="click" value={show.click ?? 'default'} onChange={(e) => set({ click: e.target.value === 'default' ? null : e.target.value })}>
            {CLICKS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Row>
      </div>
      <Row label="Highlight colour" hint="click and spotlight">
        <span className="color">
          <ColorInput field="highlight" value={show.highlight} fallback={accent} onCommit={(highlight) => set({ highlight })} />
          {show.highlight ? (
            <button className="link" onClick={() => set({ highlight: null })}>
              reset
            </button>
          ) : (
            <span className="muted">accent</span>
          )}
        </span>
      </Row>
      <Row label="Freeze (ms)" hint="a still at the step's end">
        <TextField
          field="freezeMs"
          value={show.freezeMs === undefined ? undefined : String(show.freezeMs)}
          placeholder="0"
          onCommit={(v) => set({ freezeMs: v === null ? null : Math.round(Number(v)) })}
        />
      </Row>
      <Row label="Hold (ms)" hint="changes the take: record again">
        <TextField field="hold" value={show.hold === undefined ? undefined : String(show.hold)} placeholder="0" onCommit={(v) => set({ hold: v === null ? null : Math.round(Number(v)) })} />
      </Row>
    </section>
  );
};
