import type { FC } from 'react';
import { Img } from 'remotion';

/** The brand logo on the intro and outro cards; nothing when there is none. */
export const Logo: FC<{ src: string | null; height?: number }> = ({ src, height = 120 }) =>
  src ? <Img src={src} style={{ height, width: 'auto', display: 'block', margin: '0 auto 36px' }} /> : null;
