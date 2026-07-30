/** Technique-invariant visual inputs for comparative live text workloads. */
export const LIVE_TEXT_COLOR = 0xffffff;
export const LIVE_TEXT_LINE_HEIGHT = 1.25;
export const BENCHMARK_CONTENT_INSET = 24;
export const BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH = 720;

export type LiveTextAnchor = 'center' | 'measure-center' | 'top-start';

export function benchmarkContentWidth(
  viewportWidth: number,
  layoutWidthRatio: number,
  minimumViewportWidth = BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH,
  maximumLayoutWidthRatio = 1,
): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    throw new RangeError('benchmark viewport width must be positive');
  }
  if (
    !Number.isFinite(maximumLayoutWidthRatio) ||
    maximumLayoutWidthRatio <= 0 ||
    !Number.isFinite(layoutWidthRatio) ||
    layoutWidthRatio <= 0 ||
    layoutWidthRatio > maximumLayoutWidthRatio
  ) {
    throw new RangeError(`benchmark layout width ratio must be in (0, ${String(maximumLayoutWidthRatio)}]`);
  }
  if (!Number.isFinite(minimumViewportWidth) || minimumViewportWidth <= 0) {
    throw new RangeError('benchmark minimum viewport width must be positive');
  }
  const availableWidth = Math.max(1, viewportWidth - BENCHMARK_CONTENT_INSET * 2);
  return Math.max(minimumViewportWidth * layoutWidthRatio, availableWidth * layoutWidthRatio);
}

export function liveTextPosition(
  anchor: LiveTextAnchor,
  viewportWidth: number,
  viewportHeight: number,
  layoutWidth: number,
  layoutHeight: number,
): readonly [number, number] {
  if (anchor === 'top-start') {
    return [Math.max(12, (viewportWidth - layoutWidth) / 2), -48];
  }
  return [Math.max(12, (viewportWidth - layoutWidth) / 2), -Math.max(12, (viewportHeight - layoutHeight) / 2)];
}
