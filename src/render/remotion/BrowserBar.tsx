import type { FC } from 'react';

type Props = { width: number; height: number; address: string; dark: boolean; font: string };

const THEMES = {
  light: { bar: 'linear-gradient(180deg, #f6f7f8, #eceef1)', edge: 'rgba(15, 23, 42, 0.09)', pill: '#ffffff', pillEdge: 'rgba(15, 23, 42, 0.07)', text: '#475569' },
  dark: { bar: 'linear-gradient(180deg, #2b2c31, #232428)', edge: 'rgba(255, 255, 255, 0.06)', pill: '#18191c', pillEdge: 'rgba(255, 255, 255, 0.07)', text: '#c4c7cf' },
};
const LIGHTS = ['#ff5f57', '#febc2e', '#28c840'];

/** macOS-style browser bar: traffic lights and a centred address pill. Sizes follow the bar height. */
export const BrowserBar: FC<Props> = ({ width, height: h, address, dark, font }) => {
  const c = dark ? THEMES.dark : THEMES.light;
  const dot = h * 0.27;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height: h,
        background: c.bar,
        borderBottom: `1px solid ${c.edge}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: font,
      }}
    >
      <div style={{ position: 'absolute', left: h * 0.45, top: (h - dot) / 2, display: 'flex', gap: h * 0.19 }}>
        {LIGHTS.map((color) => (
          <div key={color} style={{ width: dot, height: dot, borderRadius: '50%', background: color, boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.12)' }} />
        ))}
      </div>
      <div
        style={{
          width: Math.min(width * 0.44, h * 14),
          height: h * 0.62,
          borderRadius: h * 0.18,
          background: c.pill,
          boxShadow: `0 0 0 1px ${c.pillEdge}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: h * 0.14,
          color: c.text,
          fontSize: h * 0.31,
          fontWeight: 500,
          letterSpacing: 0.1,
        }}
      >
        <svg width={h * 0.27} height={h * 0.27} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{address}</span>
      </div>
    </div>
  );
};
