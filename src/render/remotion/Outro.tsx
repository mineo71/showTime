import type { FC } from 'react';
import { AbsoluteFill, Easing, interpolate } from 'remotion';
import type { Timeline } from '../../timeline/types';
import { cssFamily } from './css';
import { Logo } from './Logo';

/** Closing card: logo, title, subtitle and the URL in an accent pill. `frame` counts from the outro start. */
export const Outro: FC<{ timeline: Timeline; frame: number }> = ({ timeline: t, frame }) => {
  const enter = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const o = t.outro;
  return (
    <AbsoluteFill
      style={{ background: t.style.background, fontFamily: cssFamily(t.style.titleFont ?? t.style.font), alignItems: 'center', justifyContent: 'center', color: '#fff', textAlign: 'center' }}
    >
      <div style={{ maxWidth: '86%', opacity: enter, transform: `translateY(${(1 - enter) * 24}px)` }}>
        <Logo src={t.logo} />
        <div style={{ fontSize: 80, fontWeight: 800, letterSpacing: -1.5 }}>{o?.title}</div>
        {o?.subtitle ? <div style={{ marginTop: 18, fontSize: 34, opacity: 0.75 }}>{o.subtitle}</div> : null}
        {o?.url ? (
          <div
            style={{
              display: 'inline-block',
              marginTop: 40,
              padding: '14px 34px',
              borderRadius: 999,
              border: `2px solid ${t.style.accent}`,
              background: 'rgba(255, 255, 255, 0.08)',
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: 0.2,
            }}
          >
            {o.url}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
