import type { FC } from 'react';
import { cursorAt } from '../../timeline/cursor';
import type { Timeline } from '../../timeline/types';

const SIZE = 30;
const ARROW = 'M5 2 L5 24 L10.6 18.9 L14.3 26.7 L18.1 25.1 L14.4 17.4 L21.7 17.4 Z';
const IBEAM = 'M10 4.5 H13 Q14 4.5 14 5.5 Q14 4.5 15 4.5 H18 M14 5.5 V22.5 M10 23.5 H13 Q14 23.5 14 22.5 Q14 23.5 15 23.5 H18';
const HOTSPOT = { arrow: { x: 5, y: 2 }, text: { x: 14, y: 14 } } as const;

export const Cursor: FC<{ timeline: Timeline; srcMs: number }> = ({ timeline, srcMs }) => {
  const c = cursorAt(timeline.moves, timeline.clicks, srcMs);
  if (!c.visible) return null;
  const shape = c.kind === 'text' ? 'text' : 'arrow';
  const hs = HOTSPOT[shape];
  const scale = (SIZE / 28) * c.press;
  return (
    <div
      style={{
        position: 'absolute',
        left: c.x,
        top: c.y,
        opacity: c.opacity,
        transformOrigin: '0 0',
        transform: `scale(${scale}) translate(${-hs.x}px, ${-hs.y}px)`,
        filter: 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35))',
      }}
    >
      <svg width={28} height={28} viewBox="0 0 28 28">
        {shape === 'arrow' ? (
          <path d={ARROW} fill="#0b0b0f" stroke="#fff" strokeWidth={1.8} strokeLinejoin="round" />
        ) : (
          <g fill="none" strokeLinecap="round">
            <path d={IBEAM} stroke="#fff" strokeWidth={4.5} />
            <path d={IBEAM} stroke="#0b0b0f" strokeWidth={2} />
          </g>
        )}
      </svg>
    </div>
  );
};
