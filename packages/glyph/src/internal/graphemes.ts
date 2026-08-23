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
 * boundary and is KEPT. Dropping it would delete a caller's style with nothing left in the array to
 * show for it, and would shift every later index out from under a caller reading `Text.spans` back
 * to compare it against what it authored. An empty range states nothing and is not compiled into an
 * engine style.
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
 * Resolve every boundary in `ranges` onto the cluster grid of `text`, segmenting it once.
 *
 * This is the single implementation of D-265 — a cluster takes the style of its BASE — and every
 * caller in the package reaches the rule through here rather than restating it:
 *
 * - `compose` (`txt`/`span`) and `flattenText` (React `<Text>`) are two implementations of ONE
 *   compiler. The document a caller authors is a tree with no offsets in it; each compiler derives
 *   a span boundary at a concatenation JOIN, taking `start` from the length before a fragment's
 *   text is appended and `end` from the length after. Concatenation can fuse the tail of one
 *   fragment with the head of the next into a single extended grapheme cluster — `txt` + a
 *   fragment opening with a combining mark is the one-character case — and the join then names an
 *   offset that is not a boundary of the text the compiler just produced. Resolving here, over the
 *   finished text, moves each such join forward onto the cluster the earlier fragment's base owns,
 *   so a tree can no longer compile to a paragraph the engine refuses.
 * - `alignSpansToClusters` is the public backstop for the untyped `spans` array, where the offsets
 *   are the caller's own arithmetic rather than anything the package derived.
 *
 * Resolving the WHOLE compiled array, once, is what makes nesting correct: a fragment composed on
 * its own carries boundaries resolved against its own cluster grid, and embedding it shifts that
 * grid at both edges. Two regional indicators are the case neither `left` nor `right` can settle
 * alone — the combined grid holds a boundary interior to neither fragment.
 *
 * Text that is not well-formed UTF-16 has no cluster grid and is the engine's to reject; its
 * ranges are returned untouched so the presence of a range cannot decide whether a lone surrogate
 * is accepted. The argument array is returned by identity when no boundary moves.
 */
export function resolveRangesToClusters<Range extends ClusterAlignableRange>(
  text: string,
  ranges: readonly Range[],
): readonly Range[] {
  if (ranges.length === 0 || !text.isWellFormed()) return ranges;
  return alignRangesToClusters(ranges, findGraphemeBoundaries(text));
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
