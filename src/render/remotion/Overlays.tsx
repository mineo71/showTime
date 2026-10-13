import type { CSSProperties, FC } from 'react';
import { ripplesAt } from '../../timeline/cursor';
import { CAPTION_FADE_MS, SPOTLIGHT_FADE_MS } from '../../timeline/fades';
import { clamp, easeOutCubic } from '../../timeline/math';
import type { Timeline } from '../../timeline/types';

type LayerProps = { timeline: Timeline; srcMs: number };

/** 0 → 1 → 0 over [start, end] with `ms` ramps. */
const envelope = (t: number, start: number, end: number, ms: number) => clamp(Math.min((t - start) / ms, (end - t) / ms), 0, 1);

export const Spotlights: FC<LayerProps> = ({ timeline, srcMs }) => (
  <>
    {timeline.spotlights
      .filter((s) => srcMs >= s.startMs && srcMs <= s.endMs)
      .map((s) => (
        <div
          key={s.startMs}
          style={{
            position: 'absolute',
            left: s.rect.x,
            top: s.rect.y,
            width: s.rect.width,
            height: s.rect.height,
            borderRadius: 12,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.55)',
            outline: `3px solid ${timeline.style.accent}`,
            outlineOffset: 2,
            opacity: envelope(srcMs, s.startMs, s.endMs, SPOTLIGHT_FADE_MS),
          }}
        />
      ))}
  </>
);

export const Ripples: FC<LayerProps> = ({ timeline, srcMs }) => (
  <>
    {ripplesAt(timeline.clicks, srcMs).map((r) => {
      const radius = 6 + 42 * easeOutCubic(r.progress);
      return (
        <div
          key={r.tMs}
          style={{
            position: 'absolute',
            left: r.x - radius,
            top: r.y - radius,
            width: radius * 2,
            height: radius * 2,
            borderRadius: '50%',
            border: `3px solid ${timeline.style.accent}`,
            opacity: 1 - r.progress,
          }}
        />
      );
    })}
  </>
);

/** Where an overlay row sits: an inset from the top or bottom, or a band (top + height / top + bottom). */
type Place = Pick<CSSProperties, 'top' | 'bottom' | 'height' | 'alignItems'>;

const row = (place: Place): CSSProperties => ({ position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center', ...place });

/** The active caption, placed at `top` or `bottom` by its position. */
export const Captions: FC<LayerProps & { top: Place; bottom: Place; fontSize: number }> = ({ timeline, srcMs, top, bottom, fontSize }) => {
  const active = timeline.captions.filter((c) => srcMs >= c.startMs && srcMs <= c.endMs);
  const c = active[active.length - 1];
  if (!c) return null;
  const o = envelope(srcMs, c.startMs, c.endMs, CAPTION_FADE_MS);
  return (
    <div style={row(c.position === 'top' ? top : bottom)}>
      <div
        style={{
          maxWidth: '70%',
          padding: '18px 34px',
          borderRadius: 22,
          background: 'rgba(15, 23, 42, 0.9)',
          color: '#fff',
          fontFamily: timeline.style.font,
          fontSize,
          fontWeight: 600,
          lineHeight: 1.25,
          textAlign: 'center',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
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
          fontFamily: timeline.style.font,
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
