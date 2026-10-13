import { useState, type FC } from 'react';
import type { Job, StudioState } from '../server';

const ASPECTS = ['16:9', '9:16', '1:1'] as const;
const FORMATS = ['mp4', 'gif', 'webp'] as const;

export const TopBar: FC<{
  state: StudioState;
  job: Job | null;
  onAspect: (aspect: string) => void;
  onRender: (format: string) => void;
  onRecord: () => void;
}> = ({ state, job, onAspect, onRender, onRecord }) => {
  const [format, setFormat] = useState<string>('mp4');
  const busy = job?.status === 'running';
  return (
    <header className="top">
      <div className="brand">
        <span className="dot" />
        <b>showTime</b> <span className="muted">studio</span>
        <span className="file" title={state.file}>
          {state.name}.json
        </span>
      </div>
      <div className="segmented" role="group" aria-label="Aspect ratio">
        {ASPECTS.map((a) => (
          <button key={a} className={a === state.aspect ? 'on' : ''} onClick={() => onAspect(a)} disabled={busy}>
            {a}
          </button>
        ))}
      </div>
      <div className="actions">
        <button className="ghost" onClick={onRecord} disabled={busy} title="Record a new take (runs the app in real time)">
          ● Record
        </button>
        <div className="render">
          <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={busy} aria-label="Format">
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => onRender(format)} disabled={busy || state.take !== 'ok'}>
            Render
          </button>
        </div>
      </div>
    </header>
  );
};
