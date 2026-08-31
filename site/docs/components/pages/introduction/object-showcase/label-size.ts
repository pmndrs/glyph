const MIN_BOX_EXTENT = 0.62;
const MAX_BOX_EXTENT = 1.32;
const MIN_LABEL_FONT_SIZE = 0.5;
const MAX_LABEL_FONT_SIZE = 0.66;

/** Keep dense labels readable while reflecting their box's authored scale. */
export function generatedLabelFontSize(size: readonly [number, number, number]): number {
  const extent = Math.max(...size);
  const amount = clamp((extent - MIN_BOX_EXTENT) / (MAX_BOX_EXTENT - MIN_BOX_EXTENT));
  return MIN_LABEL_FONT_SIZE + amount * (MAX_LABEL_FONT_SIZE - MIN_LABEL_FONT_SIZE);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
