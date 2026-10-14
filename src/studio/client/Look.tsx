import { useEffect, useRef, type FC } from 'react';
import type { Edit } from '../edit';
import type { StudioState } from '../server';
import { Row, TextField } from './fields';

export const Look: FC<{ state: StudioState; onEdit: (edit: Edit) => void }> = ({ state, onEdit }) => {
  const style = state.style;
  const meta = (state.script?.meta ?? {}) as { title?: string; subtitle?: string };
  const setStyle = (changes: Record<string, unknown>) => onEdit({ style: changes } as Edit);
  const setMeta = (changes: Record<string, unknown>) => onEdit({ meta: changes } as Edit);
  return (
    <section className="panel">
      <h2>Look</h2>
      <Row label="Title" hint="intro card">
        <TextField field="title" value={meta.title} placeholder="No intro card" onCommit={(v) => setMeta({ title: v })} />
      </Row>
      <Row label="Subtitle">
        <TextField field="subtitle" value={meta.subtitle} onCommit={(v) => setMeta({ subtitle: v })} />
      </Row>
      {style ? (
        <>
          <Row label="Accent">
            <span className="color">
              <ColorInput value={style.accent} onCommit={(accent) => setStyle({ accent })} />
              <code>{style.accent}</code>
            </span>
          </Row>
          <Row label="Background" hint="any CSS background">
            <TextField field="background" value={style.background} onCommit={(v) => setStyle({ background: v })} />
          </Row>
          <div className="pair">
            <Row label="Captions">
              <select data-field="captionStyle" value={style.captionStyle} onChange={(e) => setStyle({ captionStyle: e.target.value })}>
                {['dark', 'light', 'accent', 'outline', 'bar'].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Clicks">
              <select data-field="styleClick" value={style.click} onChange={(e) => setStyle({ click: e.target.value })}>
                {['ripple', 'pulse', 'burst', 'ring', 'none'].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Row>
          </div>
          <Row label="Caption font" hint="a family on this machine or in style.fonts">
            <TextField field="captionFont" value={style.captionFont} placeholder={style.font.split(',')[0]} onCommit={(v) => setStyle({ captionFont: v })} />
          </Row>
          <Row label="Watermark">
            <TextField
              field="watermark"
              value={style.watermark?.text}
              placeholder="acme.com"
              onCommit={(v) => setStyle({ watermark: v === null ? null : { text: v } })}
            />
          </Row>
          <Row label="Sounds">
            <select
              data-field="sounds"
              value={typeof state.sounds === 'string' ? state.sounds : state.sounds === true ? 'soft' : state.sounds ? 'custom' : 'off'}
              onChange={(e) => onEdit({ audio: { sounds: e.target.value === 'off' ? false : e.target.value } } as Edit)}
            >
              {['off', 'soft', 'mechanical', 'pop', 'tap', 'typewriter'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              {state.sounds && typeof state.sounds === 'object' ? <option value="custom">custom (in the file)</option> : null}
            </select>
          </Row>
          <label className="check">
            <input type="checkbox" checked={style.chrome === 'browser'} onChange={(e) => setStyle({ chrome: e.target.checked ? 'browser' : 'none' })} />
            Browser window
          </label>
          <label className="check">
            <input type="checkbox" checked={style.autoZoom} onChange={(e) => setStyle({ autoZoom: e.target.checked })} />
            Auto-zoom
          </label>
          <label className="check">
            <input type="checkbox" checked={style.autoSpeed} onChange={(e) => setStyle({ autoSpeed: e.target.checked })} />
            Speed up waiting
          </label>
        </>
      ) : null}
    </section>
  );
};

/**
 * A colour picker that saves once, when the pick is done (the native `change` event), not on every
 * step of a drag (React's onChange is the `input` event).
 */
const ColorInput: FC<{ value: string; onCommit: (value: string) => void }> = ({ value, onCommit }) => {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => commit.current(el.value);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  return <input ref={ref} type="color" data-field="accent" defaultValue={/^#[0-9a-f]{6}$/i.test(value) ? value : '#6366f1'} key={value} />;
};
