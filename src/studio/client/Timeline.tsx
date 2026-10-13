import type { FC, MouseEvent } from 'react';
import { introFrames, totalFrames, videoEndFrame } from '../../timeline/frames';
import type { StudioState } from '../server';

const ICONS: Array<[key: string, icon: string, label: string]> = [
  ['caption', '❝', 'caption'],
  ['say', '🎙', 'narration'],
  ['zoom', '⌕', 'zoom'],
  ['spotlight', '◎', 'spotlight'],
];

export const Timeline: FC<{
  state: StudioState;
  frame: number;
  selected: string | null;
  onSelect: (where: string, frame: number | null) => void;
  onSeek: (frame: number) => void;
}> = ({ state, frame, selected, onSelect, onSeek }) => {
  const t = state.timeline;
  const total = t ? totalFrames(t) : 1;
  const pct = (f: number) => `${(100 * f) / total}%`;
  const steps = state.steps;
  // While playing, the step under the playhead is highlighted.
  const playing = [...steps].reverse().find((s) => s.startFrame !== null && s.startFrame <= frame)?.where;
  const seekTo = (e: MouseEvent<HTMLDivElement>) => {
    if (!t || e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.round(((e.clientX - r.left) / r.width) * (total - 1)));
  };
  return (
    <footer className="timeline">
      <div className="track" onClick={seekTo}>
        {t?.intro ? (
          <div className="card" style={{ left: 0, width: pct(introFrames(t)) }} onClick={() => onSeek(0)}>
            Intro
          </div>
        ) : null}
        {steps.map((s, i) => {
          const start = s.startFrame;
          const next = steps.slice(i + 1).find((n) => n.startFrame !== null)?.startFrame;
          const end = next ?? (t ? videoEndFrame(t) : null);
          const placed = t && start !== null && end !== null;
          const style = placed ? { left: pct(start!), width: pct(Math.max(1, end! - start!)) } : { position: 'relative' as const };
          return (
            <div
              key={s.where}
              data-where={s.where}
              className={`step${s.where === selected ? ' selected' : ''}${s.where === playing ? ' playing' : ''}${placed ? '' : ' unplaced'}`}
              style={style}
              title={`${s.where} · ${s.label}`}
              onClick={() => onSelect(s.where, start)}
            >
              <span className="name">{s.where}</span>
              <span className="do">{s.do}</span>
              <span className="icons">
                {ICONS.filter(([k]) => s.show[k] !== undefined && s.show[k] !== false).map(([k, icon, label]) => (
                  <i key={k} data-icon={k} title={label}>
                    {icon}
                  </i>
                ))}
              </span>
            </div>
          );
        })}
        {t?.outro ? (
          <div className="card" style={{ left: pct(videoEndFrame(t)), width: pct(total - videoEndFrame(t)) }} onClick={() => onSeek(videoEndFrame(t))}>
            Outro
          </div>
        ) : null}
        {t ? <div className="playhead" style={{ left: pct(frame) }} /> : null}
      </div>
    </footer>
  );
};
