import type { CSSProperties, FC } from 'react';
import { RIPPLE_MS } from '../../timeline/cursor';
import { CAPTION_FADE_MS, SPOTLIGHT_FADE_MS } from '../../timeline/fades';
import { clamp, easeOutCubic } from '../../timeline/math';
import type { Timeline } from '../../timeline/types';
import { cssFamily } from './css';

type LayerProps = { timeline: Timeline; srcMs: number };

/** 0 → 1 → 0 over [start, end] with `ms` ramps. */
const envelope = (t: number, start: number, end: number, ms: number) => clamp(Math.min((t - start) / ms, (end - t) / ms), 0, 1);

const alpha = (color: string, a: number) => `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;

export const Spotlights: FC<LayerProps> = ({ timeline, srcMs }) => (
  <>
    {timeline.spotlights
      .filter((s) => srcMs >= s.startMs && srcMs <= s.endMs)
      .map((s) => {
        const o = envelope(srcMs, s.startMs, s.endMs, SPOTLIGHT_FADE_MS);
        const look: CSSProperties =
          s.kind === 'glow'
            ? { boxShadow: `0 0 0 3px ${alpha(s.color, 0.9)}, 0 0 36px 14px ${alpha(s.color, 0.45)}` }
            : s.kind === 'ring'
              ? { outline: `4px solid ${s.color}`, outlineOffset: 3, boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)' }
              : { boxShadow: `0 0 0 9999px rgba(2, 6, 23, ${timeline.style.spotlightDim})`, outline: `3px solid ${s.color}`, outlineOffset: 2 };
        return (
          <div
            key={s.startMs}
            style={{ position: 'absolute', left: s.rect.x, top: s.rect.y, width: s.rect.width, height: s.rect.height, borderRadius: 12, opacity: o, ...look }}
          />
        );
      })}
  </>
);

/** Click animations: ripple, pulse, burst or ring, in the step's colour. */
export const Ripples: FC<LayerProps> = ({ timeline, srcMs }) => (
  <>
    {timeline.clickFx
      .filter((c) => srcMs >= c.tMs && srcMs <= c.tMs + RIPPLE_MS)
      .map((c) => {
        const p = (srcMs - c.tMs) / RIPPLE_MS;
        const e = easeOutCubic(p);
        if (c.kind === 'burst') {
          const rays = Array.from({ length: 8 }, (_, i) => {
            const a = (Math.PI * 2 * i) / 8;
            const r1 = 10 + 26 * e;
            const r2 = r1 + 14 * (1 - p);
            return <line key={i} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * r2} y2={Math.sin(a) * r2} />;
          });
          return (
            <svg key={c.tMs} style={{ position: 'absolute', left: c.x - 60, top: c.y - 60, overflow: 'visible' }} width={120} height={120} viewBox="-60 -60 120 120">
              <g stroke={c.color} strokeWidth={3.5} strokeLinecap="round" opacity={1 - p * 0.9}>
                {rays}
              </g>
            </svg>
          );
        }
        const disc = (radius: number, style: CSSProperties, key: string | number) => (
          <div key={key} style={{ position: 'absolute', left: c.x - radius, top: c.y - radius, width: radius * 2, height: radius * 2, borderRadius: '50%', ...style }} />
        );
        if (c.kind === 'pulse') return disc(8 + 30 * e, { background: c.color, opacity: 0.45 * (1 - p) }, c.tMs);
        if (c.kind === 'ring') {
          const late = clamp((p - 0.3) / 0.7, 0, 1);
          return (
            <div key={c.tMs}>
              {disc(6 + 34 * e, { border: `3px solid ${c.color}`, opacity: 1 - p }, 'a')}
              {late > 0 ? disc(6 + 34 * easeOutCubic(late), { border: `2px solid ${c.color}`, opacity: 1 - late }, 'b') : null}
            </div>
          );
        }
        return disc(6 + 42 * e, { border: `3px solid ${c.color}`, opacity: 1 - p }, c.tMs);
      })}
  </>
);

/** Where an overlay row sits: an inset from the top or bottom, or a band (top + height / top + bottom). */
type Place = Pick<CSSProperties, 'top' | 'bottom' | 'height' | 'alignItems'>;

const row = (place: Place): CSSProperties => ({ position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center', ...place });

/** The pill (or band) a caption sits in, by `style.captionStyle`. */
function captionLook(style: Timeline['style']): CSSProperties {
  switch (style.captionStyle) {
    case 'light':
      return { background: 'rgba(255, 255, 255, 0.95)', color: '#0f172a', borderRadius: 22, boxShadow: '0 12px 40px rgba(0, 0, 0, 0.25)' };
    case 'accent':
      return { background: style.accent, color: '#fff', borderRadius: 22, boxShadow: '0 12px 40px rgba(0, 0, 0, 0.3)' };
    case 'outline':
      return { color: '#fff', WebkitTextStroke: '7px rgba(2, 6, 23, 0.9)', paintOrder: 'stroke fill', textShadow: '0 6px 24px rgba(0, 0, 0, 0.45)' };
    case 'bar':
      return { background: 'rgba(15, 23, 42, 0.88)', color: '#fff', borderRadius: 0, maxWidth: '100%', width: '100%' };
    default:
      return { background: 'rgba(15, 23, 42, 0.9)', color: '#fff', borderRadius: 22, boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)' };
  }
}

/** The active caption, placed at `top` or `bottom` by its position. */
export const Captions: FC<LayerProps & { top: Place; bottom: Place; fontSize: number }> = ({ timeline, srcMs, top, bottom, fontSize }) => {
  const active = timeline.captions.filter((c) => srcMs >= c.startMs && srcMs <= c.endMs);
  const c = active[active.length - 1];
  if (!c) return null;
  const o = envelope(srcMs, c.startMs, c.endMs, CAPTION_FADE_MS);
  const { style } = timeline;
  return (
    <div style={row(c.position === 'top' ? top : bottom)}>
      <div
        style={{
          maxWidth: '70%',
          padding: '18px 34px',
          fontFamily: cssFamily(style.captionFont ?? style.font),
          fontSize: style.captionSize ?? fontSize,
          fontWeight: 600,
          lineHeight: 1.25,
          textAlign: 'center',
          ...captionLook(style),
          opacity: o,
          transform: `translateY(${(1 - o) * (c.position === 'top' ? -12 : 12)}px)`,
        }}
      >
        {c.text}
      </div>
    </div>
  );
};

/** Burned-in narration subtitles. `videoMs` is output time from the start of the video. */
export const Subtitles: FC<{ timeline: Timeline; videoMs: number; place: Place; fontSize: number }> = ({ timeline, videoMs, place, fontSize }) => {
  if (!timeline.subtitlesBurned) return null;
  const c = timeline.subtitles.find((s) => videoMs >= s.startMs && videoMs < s.endMs);
  if (!c) return null;
  return (
    <div style={row(place)}>
      <div
        style={{
          maxWidth: '80%',
          padding: '10px 24px',
          borderRadius: 12,
          background: 'rgba(0, 0, 0, 0.72)',
          color: '#fff',
          fontFamily: cssFamily(timeline.style.captionFont ?? timeline.style.font),
          fontSize,
          fontWeight: 500,
          lineHeight: 1.35,
          textAlign: 'center',
        }}
      >
        {c.text}
      </div>
    </div>
  );
};
