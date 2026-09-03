export type ViewportTarget<Key> = Readonly<{
  key: Key;
  top: number;
  bottom: number;
  height: number;
}>;

export type RankedViewportTarget<Key> = Readonly<{
  key: Key;
  ratio: number;
  distance: number;
}>;

/** Keep intersecting targets nearest the viewport centre first, with visibility as the tie-breaker. */
export function rankViewportTargets<Key>(
  targets: readonly ViewportTarget<Key>[],
  viewportHeight: number,
): readonly RankedViewportTarget<Key>[] {
  const viewportCenter = viewportHeight / 2;
  return targets
    .map(({ key, top, bottom, height }) => {
      const visibleHeight = Math.max(0, Math.min(bottom, viewportHeight) - Math.max(top, 0));
      return {
        key,
        ratio: visibleHeight / Math.max(1, height),
        distance: Math.abs((top + bottom) / 2 - viewportCenter),
      };
    })
    .filter(({ ratio }) => ratio > 0)
    .sort((a, b) => a.distance - b.distance || b.ratio - a.ratio);
}
