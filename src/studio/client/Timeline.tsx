import { useRef, useState, type FC, type MouseEvent, type PointerEvent } from 'react';
import { introFrames, totalFrames, videoEndFrame } from '../../timeline/frames';
import { sourceToOutput } from '../../timeline/timemap';
import type { Edit } from '../edit';
import type { StudioState } from '../server';
import { captionMsFor, speedFor } from './drag';

const ICONS: Array<[key: string, icon: string, label: string]> = [
  ['caption', '❝', 'caption'],
  ['say', '🎙', 'narration'],
  ['zoom', '⌕', 'zoom'],
  ['spotlight', '◎', 'spotlight'],
];

/** A block being resized: which one, and its length in frames so far. */
interface Drag {
  kind: 'step' | 'caption';
  where: string;
  frames: number;
}

export const Timeline: FC<{
  state: StudioState;
  frame: number;
  selected: string | null;
  onSelect: (where: string, frame: number | null) => void;
  onSeek: (frame: number) => void;
  onEdit: (edit: Edit) => void;
  /** a drag is starting: stop playback, so the blocks hold still */
  onDragStart: () => void;
}> = ({ state, frame, selected, onSelect, onSeek, onEdit, onDragStart }) => {
  const t = state.timeline;
  const total = t ? totalFrames(t) : 1;
  const pct = (f: number) => `${(100 * f) / total}%`;
  const steps = state.steps;
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Where the pointer went down; a ref, since every move re-renders the handles.
  const origin = useRef({ x: 0, perPx: 0, live: 0 });
  // While playing, the step under the playhead is highlighted.
  const playing = [...steps].reverse().find((s) => s.startFrame !== null && s.startFrame <= frame)?.where;
  const seekTo = (e: MouseEvent<HTMLDivElement>) => {
    if (!t || e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.round(((e.clientX - r.left) / r.width) * (total - 1)));
  };

  /** The right-edge handle of a block `frames` long; `done` gets the length it was dragged to. */
  const grip = (kind: Drag['kind'], where: string, frames: number, done: (frames: number) => void) => {
    const o = origin.current;
    return (
      <span
        className="grip"
        data-grip
        title={kind === 'step' ? 'drag to change the speed' : 'drag to change how long it stays'}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e: PointerEvent<HTMLSpanElement>) => {
          e.stopPropagation();
          e.preventDefault();
          onDragStart();
          e.currentTarget.setPointerCapture(e.pointerId);
          o.x = e.clientX;
          o.perPx = total / (track.current?.getBoundingClientRect().width || 1);
          o.live = frames;
          setDrag({ kind, where, frames });
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          o.live = Math.max(1, Math.round(frames + (e.clientX - o.x) * o.perPx));
          setDrag({ kind, where, frames: o.live });
        }}
        onPointerUp={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDrag(null);
          if (o.live !== frames) done(o.live);
        }}
        onPointerCancel={() => setDrag(null)}
      />
    );
  };

  const captions = t
    ? t.captions.flatMap((c) => {
        if (!c.where) return [];
        const start = introFrames(t) + Math.round((sourceToOutput(t.segments, c.startMs) * t.fps) / 1000);
        const end = introFrames(t) + Math.round((sourceToOutput(t.segments, c.endMs) * t.fps) / 1000);
        return [{ where: c.where, text: c.text, start, frames: Math.max(1, end - start) }];
      })
    : [];

  return (
    <footer className="timeline">
      {captions.length ? (
        <div className="track captions">
          {captions.map((c) => {
            const frames = drag?.kind === 'caption' && drag.where === c.where ? drag.frames : c.frames;
            return (
              <div key={c.where} data-caption={c.where} className="cap" style={{ left: pct(c.start), width: pct(frames) }} title={c.text}>
                <span className="text">{drag?.kind === 'caption' && drag.where === c.where ? `${(captionMsFor(frames, t!.fps) / 1000).toFixed(1)} s` : c.text}</span>
                {grip('caption', c.where, c.frames, (f) =>
                  onEdit({ where: c.where, step: steps.find((s) => s.where === c.where)?.id, show: { captionMs: captionMsFor(f, t!.fps) } } as Edit),
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="track" ref={track} onClick={seekTo}>
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
          const block = placed ? Math.max(1, end! - start!) : 0;
          const dragging = drag?.kind === 'step' && drag.where === s.where;
          const span = placed && s.srcMs !== null && s.endFrame !== null ? { srcMs: s.srcMs, holdMs: s.holdMs, stepFrames: s.endFrame - start!, blockFrames: block } : null;
          const style = placed ? { left: pct(start!), width: pct(dragging ? drag.frames : block) } : { position: 'relative' as const };
          return (
            <div
              key={s.where}
              data-where={s.where}
              className={`step${s.where === selected ? ' selected' : ''}${s.where === playing ? ' playing' : ''}${placed ? '' : ' unplaced'}${dragging ? ' dragging' : ''}`}
              style={style}
              title={`${s.where} · ${s.label}`}
              onClick={() => onSelect(s.where, start)}
            >
              <span className="name">{s.where}</span>
              <span className="do">{dragging && span ? `${speedFor(span, drag.frames, t!.fps)}×` : s.do}</span>
              <span className="icons">
                {ICONS.filter(([k]) => s.show[k] !== undefined && s.show[k] !== false).map(([k, icon, label]) => (
                  <i key={k} data-icon={k} title={label}>
                    {icon}
                  </i>
                ))}
              </span>
              {/* A pause runs at real time whatever its speed. */}
              {span && s.do !== 'pause' ? grip('step', s.where, block, (f) => onEdit({ where: s.where, step: s.id, show: { speed: speedFor(span, f, t!.fps) } } as Edit)) : null}
            </div>
          );
        })}
        {t
          ? steps.flatMap((s) => {
              const ms = typeof s.show.freezeMs === 'number' ? s.show.freezeMs : 0;
              if (!ms || s.endFrame === null) return [];
              const frames = Math.round((ms * t.fps) / 1000);
              return [<div key={`freeze-${s.where}`} data-freeze={s.where} className="freeze" style={{ left: pct(s.endFrame - frames), width: pct(frames) }} title={`${s.where}: frozen ${ms} ms`} />];
            })
          : null}
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
