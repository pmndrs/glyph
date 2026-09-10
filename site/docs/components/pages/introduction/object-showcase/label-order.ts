/** Stable far-to-near paragraph order so the closest transparent label draws last. */
export function farToNearLabelOrder(distancesSquared: readonly number[]): readonly number[] {
  return distancesSquared
    .map((distance, index) => ({ distance, index }))
    .sort((left, right) => right.distance - left.distance || left.index - right.index)
    .map(({ index }) => index);
}
