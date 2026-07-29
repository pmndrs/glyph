/** Technique-invariant visual inputs for comparative live text workloads. */
export const LIVE_TEXT_COLOR = 0xffffff;
export const LIVE_TEXT_LINE_HEIGHT = 1.25;

export type LiveTextAnchor = 'center' | 'measure-center' | 'top-start';

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
