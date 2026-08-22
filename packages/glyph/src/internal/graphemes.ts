import { graphemeSegments } from 'unicode-segmenter/grapheme';

/**
 * Extended grapheme cluster boundaries, in UTF-16 code units.
 *
 * The engine's own contract is one style per extended grapheme cluster (`cluster_state.rs`,
 * `build`), and the shaper segments UAX #29 in Rust through `unicode-segmentation`. These are two
 * implementations of one specification, pinned to the same Unicode version by the version contract,
 * not one authority and one copy. Callers that must agree with the engine's cluster grid before a
 * frame reaches it — span alignment above all — read their boundaries here rather than from
 * `Intl.Segmenter`, whose Unicode version follows the host ICU and can therefore place a boundary
 * this package's own tables do not.
 *
 * This lives apart from `unicode.ts` so a consumer that needs only cluster boundaries does not pull
 * in line breaking and the generated script tables with them.
 */
export function findGraphemeBoundaries(text: string): Uint32Array {
  assertWellFormed(text);
  // A grapheme is never shorter than one code unit, so the text length bounds the boundary count and the result is
  // sliced to what was written. Accumulating into a plain array and converting copied every boundary twice.
  let boundaries = new Uint32Array(text.length + 1);
  let count = 1;
  for (const segment of graphemeSegments(text)) {
    if (count === boundaries.length) {
      const grown = new Uint32Array(boundaries.length * 2);
      grown.set(boundaries);
      boundaries = grown;
    }
    boundaries[count] = segment.index + segment.segment.length;
    count += 1;
  }
  return boundaries.subarray(0, count);
}

export function assertWellFormed(text: string): void {
  if (!text.isWellFormed()) throw new RangeError('paragraph text must be well-formed UTF-16');
}

/** The two offsets any styled range carries, whatever else it states. */
export type ClusterAlignableRange = Readonly<{ start: number; end: number }>;

/**
 * Resolve every range boundary onto the cluster grid `clusterBoundaries` describes.
 *
 * Each boundary moves forward to the end of the cluster containing it, which states one rule: a
 * cluster takes the style of its BASE, and the marks that attach to that base follow it. Moving a
 * start forward excludes the cluster it fell inside; moving an end forward includes it; both
 * outcomes hand the cluster to whatever styles its first scalar.
 *
 * Forward is a policy, not an arithmetic necessity — moving both boundaries backward preserves
 * ordering and adjacency equally well. It is chosen because backward resolution takes style away
 * from a base the caller styled and never edited, handing the cluster to a mark that attached to
 * it, and because a mark typed at the tail of a styled cluster is far more often meant to join that
 * style than to end it. Both boundaries move the SAME direction so that two ranges meeting at one
 * offset still meet afterwards; mixing directions would manufacture an overlap out of an adjacency.
 *
 * A range whose text is entirely claimed by an earlier cluster collapses to an empty range at that
 * boundary and is KEPT. Dropping it would shift every later index — the indices `setSpan` and
 * `removeSpan` address — and would delete a caller's style with nothing left in the array to show
 * for it.
 *
 * Offsets outside `[0, textLength]` are left exactly as they are. Range validity is a separate
 * obligation with its own owner, and silently clamping an out-of-range offset would turn a caller's
 * arithmetic bug into a plausible-looking style.
 *
 * The input array is returned by identity when no boundary moves, so a caller can test whether
 * anything was resolved with `===`.
 */
export function alignRangesToClusters<Range extends ClusterAlignableRange>(
  ranges: readonly Range[],
  clusterBoundaries: Uint32Array,
): readonly Range[] {
  let aligned: Range[] | undefined;
  for (const [index, range] of ranges.entries()) {
    const start = clusterEndAtOrAfter(clusterBoundaries, range.start);
    const alignedEnd = clusterEndAtOrAfter(clusterBoundaries, range.end);
    // Clamping keeps a well-formed range from inverting when its start moves past its end. An
    // already-inverted range is a caller arithmetic error with its own owner, so it is left
    // inverted: clamping would turn it into an empty range that the empty-span filter discards,
    // which would hide the fault instead of reporting it.
    const end = range.start <= range.end ? Math.max(start, alignedEnd) : alignedEnd;
    if (start === range.start && end === range.end) {
      aligned?.push(range);
      continue;
    }
    aligned ??= ranges.slice(0, index);
    aligned.push({ ...range, start, end });
  }
  return aligned ?? ranges;
}

/**
 * The end of the cluster containing `offset`, or `offset` itself when it is already a boundary or
 * lies outside the text the boundaries describe.
 */
function clusterEndAtOrAfter(clusterBoundaries: Uint32Array, offset: number): number {
  const textLength = clusterBoundaries[clusterBoundaries.length - 1] ?? 0;
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= textLength) return offset;
  let low = 0;
  let high = clusterBoundaries.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (clusterBoundaries[middle]! < offset) low = middle + 1;
    else high = middle;
  }
  return clusterBoundaries[low] ?? offset;
}
