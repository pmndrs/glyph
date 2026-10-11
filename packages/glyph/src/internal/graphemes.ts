import { graphemeSegments } from 'unicode-segmenter/grapheme';
import type { TextStyle } from '../text-properties.js';

const clusterAlignedTextByRanges = new WeakMap<object, { text: string; validatedSpanStyles: boolean }>();
const clusterAlignedRangesBrand: unique symbol = Symbol('pmndrs.glyph.cluster-aligned-ranges');

interface ClusterAlignedRangesBrand {
  readonly [clusterAlignedRangesBrand]?: true;
}

/** Extended grapheme cluster boundaries (UTF-16 units), pinned to the same Unicode version as the Rust shaper's `cluster_state.rs` segmenter. Use this, not `Intl.Segmenter`, wherever boundaries must agree with the engine's grid — host ICU versions drift. */
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
export type ClusterAlignableRange = Readonly<{ start: number; end: number; style?: TextStyle }>;

/** Moves boundaries forward to their cluster's end (the base takes the style); both ends move the
 *  same direction so adjacent ranges stay adjacent. A collapsed-to-empty range is KEPT — dropping it would delete a caller's style and shift later indices. */
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
    aligned.push(Object.freeze({ ...range, start, end }));
  }
  return aligned ?? ranges;
}

/** Segments `text` once and resolves every range boundary onto its cluster grid — the D-265 rule every span-boundary caller (`compose`, `flattenText`, `alignSpansToClusters`) shares rather than restates. Resolving the whole array together is what makes nesting correct; malformed UTF-16 has no grid and ranges pass through untouched. */
export function resolveRangesToClusters<Range extends ClusterAlignableRange>(
  text: string,
  ranges: readonly Range[],
): readonly Range[] {
  if (ranges.length === 0 || !text.isWellFormed()) return ranges;
  return alignRangesToClusters(ranges, findGraphemeBoundaries(text));
}

/** Resolves, freezes, and records package-owned ranges so adapters can prove that the exact array is already on this
 *  text's cluster grid. This takes ownership of a fresh package-local array and freezes both it and its records. The text
 *  association matters: reusing an array with different content must fall back to normal Unicode alignment. A producer
 *  replacing only style data can supply its unchanged-boundary alignment source without another segmentation pass. */
export function ownClusterAlignedRanges<Range extends ClusterAlignableRange>(
  text: string,
  ranges: readonly Range[],
  validateSpanStyles?: (aligned: readonly Range[]) => void,
  alignmentSource: readonly ClusterAlignableRange[] = ranges,
): readonly Range[] {
  freezeRanges(ranges);
  const alignmentKnown = areOwnedRangesClusterAligned(text, alignmentSource);
  const aligned = alignmentKnown ? ranges : resolveRangesToClusters(text, ranges);
  validateSpanStyles?.(aligned);
  if (!alignmentKnown && !text.isWellFormed()) return Object.freeze(aligned);
  return markOwnedRangesClusterAligned(text, aligned, validateSpanStyles !== undefined);
}

/** Transfers alignment across unchanged bounds; changed styles lose their scope authority without losing alignment.
 *  Unproven sources and changed bounds follow the same complete alignment producer. */
export function inheritClusterAlignedRanges<Range extends ClusterAlignableRange>(
  text: string,
  source: readonly ClusterAlignableRange[],
  ranges: readonly Range[],
): readonly Range[] {
  if (!areOwnedRangesClusterAligned(text, source) || source.length !== ranges.length) {
    return ownClusterAlignedRanges(text, ranges);
  }
  let stylesUnchanged = true;
  for (let index = 0; index < source.length; index++) {
    const prior = source[index]!;
    const next = ranges[index]!;
    if (prior.start !== next.start || prior.end !== next.end) return ownClusterAlignedRanges(text, ranges);
    if (prior.style !== next.style) stylesUnchanged = false;
  }
  return markOwnedRangesClusterAligned(
    text,
    ranges,
    stylesUnchanged && (clusterAlignedTextByRanges.get(source)?.validatedSpanStyles ?? false),
  );
}

/** True only for an exact package-owned range array normalized against the same text. */
export function areOwnedRangesClusterAligned(
  text: string,
  ranges: readonly ClusterAlignableRange[],
  requireValidatedSpanStyles = false,
): boolean {
  const ownership = clusterAlignedTextByRanges.get(ranges);
  return (
    (ranges as readonly ClusterAlignableRange[] & ClusterAlignedRangesBrand)[clusterAlignedRangesBrand] === true &&
    ownership?.text === text &&
    (!requireValidatedSpanStyles || ownership.validatedSpanStyles)
  );
}

function markOwnedRangesClusterAligned<Range extends ClusterAlignableRange>(
  text: string,
  ranges: readonly Range[],
  validatedSpanStyles: boolean,
): readonly Range[] {
  const owned = Object.isExtensible(ranges) ? ranges : [...ranges];
  freezeRanges(owned);
  Object.defineProperty(owned, clusterAlignedRangesBrand, { value: true });
  Object.freeze(owned);
  clusterAlignedTextByRanges.set(owned, { text, validatedSpanStyles });
  return owned;
}

function freezeRanges(ranges: readonly ClusterAlignableRange[]): void {
  for (const range of ranges) Object.freeze(range);
}

/** End of the cluster containing `offset`, or `offset` itself when it is already a boundary or lies outside the text's range. */
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
