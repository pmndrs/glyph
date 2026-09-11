let graphemeSegmenter: Intl.Segmenter | undefined;

/** Whether this host can provide the native grapheme segmentation used by the micro text-engine lane. */
export function hasNativeGraphemeSegmenter(): boolean {
  return typeof globalThis.Intl?.Segmenter === 'function';
}

/**
 * Extended grapheme-cluster boundaries in UTF-16 code units, produced by the host's Unicode data.
 *
 * This intentionally does not replace the full engine's pinned segmenter. The micro engine accepts
 * host-versioned segmentation in exchange for a smaller bundle; callers select the full engine before
 * invoking this lane when `Intl.Segmenter` is unavailable.
 */
export function findNativeGraphemeBoundaries(text: string): Uint32Array {
  if (!text.isWellFormed()) throw new RangeError('paragraph text must be well-formed UTF-16');
  const segmenter = getGraphemeSegmenter();
  const boundaries = new Uint32Array(text.length + 1);
  let count = 0;
  for (const segment of segmenter.segment(text)) {
    boundaries[count] = segment.index;
    count += 1;
  }
  boundaries[count] = text.length;
  return boundaries.subarray(0, count + 1);
}

function getGraphemeSegmenter(): Intl.Segmenter {
  if (graphemeSegmenter !== undefined) return graphemeSegmenter;
  if (!hasNativeGraphemeSegmenter()) {
    throw new Error('the micro text engine requires Intl.Segmenter; use the full engine on this host');
  }
  graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return graphemeSegmenter;
}
