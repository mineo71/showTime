import type { FC } from 'react';
import { ripplesAt } from '../../timeline/cursor';
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
            opacity: envelope(srcMs, s.startMs, s.endMs, 250),
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

/** `top` is where a top caption's box starts (output px); bottom captions sit at a fixed inset. */
export const Captions: FC<LayerProps & { top: number }> = ({ timeline, srcMs, top }) => {
  const active = timeline.captions.filter((c) => srcMs >= c.startMs && srcMs <= c.endMs);
  const c = active[active.length - 1];
  if (!c) return null;
  const o = envelope(srcMs, c.startMs, c.endMs, 220);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        ...(c.position === 'top' ? { top } : { bottom: Math.round(timeline.output.height * 0.075) }),
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '18px 34px',
          borderRadius: 22,
          background: 'rgba(15, 23, 42, 0.9)',
          color: '#fff',
          fontFamily: timeline.style.font,
          fontSize: 36,
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
export const Subtitles: FC<{ timeline: Timeline; videoMs: number; bottom: number }> = ({ timeline, videoMs, bottom }) => {
  if (!timeline.subtitlesBurned) return null;
  const c = timeline.subtitles.find((s) => videoMs >= s.startMs && videoMs < s.endMs);
  if (!c) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom, display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          maxWidth: '80%',
          padding: '10px 24px',
          borderRadius: 12,
          background: 'rgba(0, 0, 0, 0.72)',
          color: '#fff',
          fontFamily: timeline.style.font,
          fontSize: 34,
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
