import type { FC } from 'react';
import { Img } from 'remotion';
import type { Timeline } from '../../timeline/types';

/** `style.watermark` in a corner of every frame, cards included. */
export const Watermark: FC<{ timeline: Timeline }> = ({ timeline: t }) => {
  const w = t.watermark;
  if (!w) return null;
  const margin = Math.round(t.output.height * 0.03);
  const [v, h] = w.position.split('-') as ['top' | 'bottom', 'left' | 'right'];
  return (
    <div
      style={{
        position: 'absolute',
        [v]: margin,
        [h]: margin,
        display: 'flex',
        alignItems: 'center',
        gap: Math.round(w.size * 0.4),
        opacity: w.opacity,
        color: '#fff',
        fontFamily: t.style.captionFont ?? t.style.font,
        fontSize: w.size,
        fontWeight: 600,
        textShadow: '0 2px 10px rgba(0, 0, 0, 0.45)',
        pointerEvents: 'none',
      }}
    >
      {w.image ? <Img src={w.image} style={{ height: w.size, width: 'auto', display: 'block' }} /> : null}
      {w.text ? <span>{w.text}</span> : null}
    </div>
  );
};
