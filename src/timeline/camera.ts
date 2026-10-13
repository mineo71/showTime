import { clamp, easeInOutCubic, lerp } from './math';
import type { CameraKey, Rect } from './types';

export const ZOOM_LEAD_MS = 700;
export const CONNECT_GAP_MS = 1500;
export const MIN_ZOOM = 1.15;
const ZOOM_MARGIN_PX = 160;

export interface ZoomRegion {
  startMs: number;
  endMs: number;
  scale: number;
  cx: number;
  cy: number;
}

export function zoomDepth(target: Rect, stage: { width: number; height: number }, maxZoom: number): number {
  const fit = Math.min(stage.width / (target.width + ZOOM_MARGIN_PX), stage.height / (target.height + ZOOM_MARGIN_PX));
  return clamp(fit, 1, maxZoom);
}

/** Share of the content visible at scale 1, per axis: 1 unless the format crops the viewport. */
export interface Visible {
  x: number;
  y: number;
}

const FULL: Visible = { x: 1, y: 1 };

/** Keep the focus where the visible part stays inside the content. */
export function clampFocus(scale: number, cx: number, cy: number, visible: Visible = FULL): { cx: number; cy: number } {
  const hx = Math.min(0.5, visible.x / (2 * scale));
  const hy = Math.min(0.5, visible.y / (2 * scale));
  return { cx: clamp(cx, hx, 1 - hx), cy: clamp(cy, hy, 1 - hy) };
}

const rest = (tMs: number): CameraKey => ({ tMs, scale: 1, cx: 0.5, cy: 0.5 });

export interface CameraOptions {
  visible?: Visible;
  /** Between regions keep the last focus (at scale 1) instead of returning to the centre: the follow camera of cropped formats. */
  hold?: boolean;
}

export function buildCamera(regions: ZoomRegion[], opts: CameraOptions = {}): CameraKey[] {
  const visible = opts.visible ?? FULL;
  let last = { cx: 0.5, cy: 0.5 };
  const restAt = (tMs: number): CameraKey => (opts.hold ? { tMs, scale: 1, ...clampFocus(1, last.cx, last.cy, visible) } : rest(tMs));
  const rs = [...regions].sort((a, b) => a.startMs - b.startMs);
  const keys: CameraKey[] = [];
  rs.forEach((r, i) => {
    const prev = rs[i - 1];
    const next = rs[i + 1];
    const start = prev ? Math.max(r.startMs, prev.endMs) : r.startMs;
    const end = Math.max(start, r.endMs);
    const focus = clampFocus(r.scale, r.cx, r.cy, visible);
    if (!prev || start - prev.endMs > CONNECT_GAP_MS) {
      const lastT = keys.length ? keys[keys.length - 1].tMs : 0;
      keys.push(restAt(Math.max(lastT, start - ZOOM_LEAD_MS)));
    }
    keys.push({ tMs: start, scale: r.scale, ...focus });
    keys.push({ tMs: end, scale: r.scale, ...focus });
    last = focus;
    if (!next || next.startMs - end > CONNECT_GAP_MS) keys.push(restAt(end + ZOOM_LEAD_MS));
  });
  return keys;
}

export function cameraAt(keys: CameraKey[], tMs: number): CameraKey {
  if (!keys.length) return { ...rest(tMs) };
  if (tMs <= keys[0].tMs) return { ...keys[0], tMs };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (tMs > b.tMs) continue;
    const a = keys[i - 1];
    if (b.tMs === a.tMs) return { ...b, tMs };
    const e = easeInOutCubic((tMs - a.tMs) / (b.tMs - a.tMs));
    return { tMs, scale: lerp(a.scale, b.scale, e), cx: lerp(a.cx, b.cx, e), cy: lerp(a.cy, b.cy, e) };
  }
  return { ...keys[keys.length - 1], tMs };
}

/**
 * CSS transform (transform-origin 0 0) for content of `content` size that puts the focus point at
 * the centre of a width×height window (content defaults to the window's size).
 */
export function cameraTransform(cam: CameraKey, width: number, height: number, content = { width, height }): string {
  const tx = width / 2 - cam.cx * content.width * cam.scale;
  const ty = height / 2 - cam.cy * content.height * cam.scale;
  const r = (v: number) => Math.round(v * 100) / 100 + 0;
  return `translate(${r(tx)}px, ${r(ty)}px) scale(${r(cam.scale * 1000) / 1000})`;
}
