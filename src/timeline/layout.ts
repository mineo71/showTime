import type { Aspect, CameraKey, Rect } from './types';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Height of the browser bar, in stage (viewport) pixels. */
export const BROWSER_BAR = 44;

export const OUTPUT_SIZES: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

/** In 9:16 the window (bar included) is this many times taller than wide. */
const PORTRAIT_WINDOW = 1.3;

/** The window on screen, and the size the viewport is drawn at inside it (larger when cropped). */
export interface View extends Box {
  bar: number;
  content: { width: number; height: number };
}

/**
 * Where the recorded viewport sits inside the output frame. `bar` (stage px) reserves room for a
 * browser bar above it; the returned box is the viewport, `bar` the bar height in output px.
 */
export function windowLayout(
  output: { width: number; height: number },
  stage: { width: number; height: number },
  padding: number,
  bar = 0,
): Box & { bar: number } {
  const availW = output.width * (1 - 2 * padding);
  const availH = output.height * (1 - 2 * padding);
  const k = Math.min(availW / stage.width, availH / (stage.height + bar));
  const width = Math.round(stage.width * k);
  const height = Math.round(stage.height * k);
  const barPx = Math.round(bar * k);
  const top = Math.round((output.height - height - barPx) / 2);
  return { x: Math.round((output.width - width) / 2), y: top + barPx, width, height, bar: barPx };
}

/**
 * The window for an aspect ratio. 16:9 fits the whole viewport (the 0.3 layout). 1:1 fills the
 * padded square and 9:16 uses a tall window in the middle; in both the viewport covers the window,
 * so it is cropped and the camera decides what shows.
 */
export function viewLayout(
  output: { width: number; height: number },
  stage: { width: number; height: number },
  padding: number,
  bar = 0,
  aspect: Aspect = '16:9',
  /** px kept free under the window (a subtitle band); 9:16 ignores it */
  reserveBottom = 0,
): View {
  const reserve = aspect === '9:16' ? 0 : reserveBottom;
  if (aspect === '16:9') {
    const w = windowLayout({ width: output.width, height: output.height - reserve }, stage, padding, bar);
    return { ...w, content: { width: w.width, height: w.height } };
  }
  const width = Math.round(output.width * (1 - 2 * padding));
  const total = aspect === '9:16' ? Math.round(width * PORTRAIT_WINDOW) : Math.round(output.height * (1 - 2 * padding) - reserve);
  const k = Math.max(width / stage.width, total / (stage.height + bar));
  const barPx = Math.round(bar * k);
  const top = Math.round((output.height - reserve - total) / 2);
  return {
    x: Math.round((output.width - width) / 2),
    y: top + barPx,
    width,
    height: total - barPx,
    bar: barPx,
    content: { width: Math.round(stage.width * k), height: Math.round(stage.height * k) },
  };
}

/** How much of the content shows at camera scale 1, per axis (1 = all of it). */
export const visibleFraction = (v: View) => ({ x: Math.min(1, v.width / v.content.width), y: Math.min(1, v.height / v.content.height) });

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Where a stage rect (CSS px) lands in the output: through the camera, inside the window viewport. */
export function projectRect(
  r: Rect,
  cam: Pick<CameraKey, 'scale' | 'cx' | 'cy'>,
  stage: { width: number; height: number },
  win: Box & { content?: { width: number; height: number } },
): Rect {
  const w = (win.content?.width ?? win.width) * cam.scale;
  const h = (win.content?.height ?? win.height) * cam.scale;
  return {
    x: r2(win.x + win.width / 2 + (r.x / stage.width - cam.cx) * w),
    y: r2(win.y + win.height / 2 + (r.y / stage.height - cam.cy) * h),
    width: r2((r.width / stage.width) * w),
    height: r2((r.height / stage.height) * h),
  };
}
