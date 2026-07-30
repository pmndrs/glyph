export function sparklineTimestampX(timestampMs: number, nowMs: number, windowMs: number, width: number): number {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) return Number.NaN;
  const normalizedWindow = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 1;
  return ((timestampMs - (nowMs - normalizedWindow)) / normalizedWindow) * width;
}

export function sparklinePresentationTimestamp(timestampMs: number, delayMs: number): number {
  if (!Number.isFinite(timestampMs)) return Number.NaN;
  const normalizedDelay = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
  return timestampMs - normalizedDelay;
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
