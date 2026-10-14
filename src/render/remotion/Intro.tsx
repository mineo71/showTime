import type { FC } from 'react';
import { AbsoluteFill, Easing, interpolate } from 'remotion';
import { introFrames } from '../../timeline/frames';
import type { Timeline } from '../../timeline/types';
import { cssFamily } from './css';
import { Logo } from './Logo';

export const Intro: FC<{ timeline: Timeline; frame: number }> = ({ timeline: t, frame }) => {
  const total = introFrames(t);
  const clampBoth = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const enter = interpolate(frame, [0, 18], [0, 1], { ...clampBoth, easing: Easing.out(Easing.cubic) });
  const exit = interpolate(frame, [Math.max(1, total - 10), Math.max(2, total)], [1, 0], clampBoth);
  return (
    <AbsoluteFill
      style={{
        background: t.style.background,
        fontFamily: cssFamily(t.style.titleFont ?? t.style.font),
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '86%', opacity: Math.min(enter, exit), transform: `scale(${0.94 + 0.06 * enter})` }}>
        <Logo src={t.logo} />
        <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: -1.5 }}>{t.intro?.title}</div>
        {t.intro?.subtitle ? <div style={{ marginTop: 18, fontSize: 36, opacity: 0.75 }}>{t.intro.subtitle}</div> : null}
        <div style={{ margin: '28px auto 0', width: 72, height: 6, borderRadius: 3, background: t.style.accent }} />
      </div>
    </AbsoluteFill>
  );
};
