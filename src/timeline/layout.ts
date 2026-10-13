export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the recorded viewport ("window") sits inside the output frame. */
export function windowLayout(
  output: { width: number; height: number },
  stage: { width: number; height: number },
  padding: number,
): Box {
  const availW = output.width * (1 - 2 * padding);
  const availH = output.height * (1 - 2 * padding);
  const k = Math.min(availW / stage.width, availH / stage.height);
  const width = Math.round(stage.width * k);
  const height = Math.round(stage.height * k);
  return { x: Math.round((output.width - width) / 2), y: Math.round((output.height - height) / 2), width, height };
}
