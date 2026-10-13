export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Height of the browser bar, in stage (viewport) pixels. */
export const BROWSER_BAR = 44;

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
