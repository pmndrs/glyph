export function sparklineSampleX(
  sampleIndex: number,
  sampleCount: number,
  capacity: number,
  width: number,
): number {
  const emptySlots = capacity - sampleCount
  return ((emptySlots + sampleIndex) / Math.max(1, capacity - 1)) * width
}

export interface SparklineCanvasMetrics {
  readonly backingHeight: number
  readonly backingWidth: number
  readonly cssHeight: number
  readonly cssWidth: number
  readonly pixelRatio: number
  readonly scaleX: number
  readonly scaleY: number
}

export function sparklineCanvasMetrics(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): SparklineCanvasMetrics {
  const normalizedWidth = positiveFinite(cssWidth)
  const normalizedHeight = positiveFinite(cssHeight)
  const normalizedPixelRatio = positiveFinite(pixelRatio)
  const backingWidth = Math.max(1, Math.round(normalizedWidth * normalizedPixelRatio))
  const backingHeight = Math.max(1, Math.round(normalizedHeight * normalizedPixelRatio))
  return {
    backingHeight,
    backingWidth,
    cssHeight: normalizedHeight,
    cssWidth: normalizedWidth,
    pixelRatio: normalizedPixelRatio,
    scaleX: backingWidth / normalizedWidth,
    scaleY: backingHeight / normalizedHeight,
  }
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}
