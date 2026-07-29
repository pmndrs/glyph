export function sparklineSampleX(sampleIndex: number, sampleCount: number, capacity: number, width: number): number {
  const emptySlots = capacity - sampleCount;
  return ((emptySlots + sampleIndex) / Math.max(1, capacity - 1)) * width;
}

export function sparklineMotionProgress(elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  const progress = Math.min(1, elapsedMs / durationMs);
  return progress * progress * (3 - 2 * progress);
}

export function sparklineAnimatedSampleX(
  sampleIndex: number,
  sampleCount: number,
  capacity: number,
  width: number,
  progress: number,
): number {
  const target = sparklineSampleX(sampleIndex, sampleCount, capacity, width);
  const slotWidth = width / Math.max(1, capacity - 1);
  return target + (1 - Math.min(1, Math.max(0, progress))) * slotWidth;
}

export function sparklineSampleY(value: number, maximum: number, height: number): number {
  const drawableHeight = Math.max(0, height - 4);
  const ratio = maximum > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / maximum)) : 0;
  return height - ratio * drawableHeight - 2;
}

export interface SparklineCanvasMetrics {
  readonly backingHeight: number;
  readonly backingWidth: number;
  readonly cssHeight: number;
  readonly cssWidth: number;
  readonly pixelRatio: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export function sparklineCanvasMetrics(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): SparklineCanvasMetrics {
  const normalizedWidth = positiveFinite(cssWidth);
  const normalizedHeight = positiveFinite(cssHeight);
  const normalizedPixelRatio = positiveFinite(pixelRatio);
  const backingWidth = Math.max(1, Math.round(normalizedWidth * normalizedPixelRatio));
  const backingHeight = Math.max(1, Math.round(normalizedHeight * normalizedPixelRatio));
  return {
    backingHeight,
    backingWidth,
    cssHeight: normalizedHeight,
    cssWidth: normalizedWidth,
    pixelRatio: normalizedPixelRatio,
    scaleX: backingWidth / normalizedWidth,
    scaleY: backingHeight / normalizedHeight,
  };
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
