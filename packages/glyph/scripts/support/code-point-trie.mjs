/**
 * Three-stage code-point tries for the generated Unicode tables.
 *
 * Unicode properties are blocky, so a fixed-size block of code points repeats heavily across the
 * plane. Deduplicating leaves, and then the blocks of leaf selectors, turns a 1.1 MB flat array
 * into a small root, a few middle blocks and a few hundred distinct leaves; lookup is three array
 * reads instead of a binary search over sorted ranges. The middle stage is what the two-stage
 * form lacked: the supplementary planes repeat their selectors as heavily as their leaves.
 *
 * Tries are larger raw than the sorted ranges they replace: raw costs a memcpy into linear
 * memory at instantiation, while the search cost is paid per character. See D-341.
 */

/** Unicode's scalar-value space; every generated plane covers exactly this many code points. */
export const CODE_POINT_COUNT = 0x11_0000;

/**
 * Expands sorted `[begin, end, value)` triples into a per-code-point plane.
 *
 * The caller is expected to have already proven the ranges tile the scalar-value space; this
 * throws if any code point is left unassigned rather than emitting a silently wrong trie.
 */
export function planeFromRanges(ranges, label) {
  const plane = new Array(CODE_POINT_COUNT).fill(undefined);
  for (const [begin, end, value] of ranges) {
    for (let codePoint = begin; codePoint < Math.min(end, CODE_POINT_COUNT); codePoint += 1) {
      plane[codePoint] = value;
    }
  }
  const gap = plane.indexOf(undefined);
  if (gap !== -1) {
    throw new Error(`${label} ranges leave U+${gap.toString(16).toUpperCase()} unassigned`);
  }
  return plane;
}

/** The narrowest Rust unsigned type that indexes `count` entries. */
function indexType(count) {
  if (count <= 0x100) return 'u8';
  if (count <= 0x1_0000) return 'u16';
  throw new Error(`${count} entries do not fit a u16 index`);
}

function deduplicate(blocks) {
  const seen = new Map();
  const selectors = [];
  const distinct = [];
  for (const block of blocks) {
    const key = block.join(',');
    let index = seen.get(key);
    if (index === undefined) {
      index = distinct.length;
      seen.set(key, index);
      distinct.push(block);
    }
    selectors.push(index);
  }
  return { selectors, distinct };
}

function chunks(values, size) {
  const result = [];
  for (let base = 0; base < values.length; base += size) result.push(values.slice(base, base + size));
  return result;
}

/**
 * Deduplicates `plane` into a three-stage trie: leaves of `1 << leafShift` value indices, middles
 * of `1 << middleShift` leaf selectors, and a root of middle selectors.
 *
 * The second level shares the selector blocks too: the supplementary planes are mostly one value,
 * so their stage-1 entries repeat as heavily as the leaves do. Each stage uses the narrowest index
 * type that fits.
 */
export function buildThreeStageTrie(plane, leafShift, middleShift) {
  if (plane.length !== CODE_POINT_COUNT) {
    throw new Error(`plane covers ${plane.length} code points, expected ${CODE_POINT_COUNT}`);
  }
  const leaves = deduplicate(chunks(plane, 1 << leafShift));
  const middles = deduplicate(chunks(leaves.selectors, 1 << middleShift));
  return {
    root: middles.selectors,
    middle: middles.distinct.flat(),
    leaves: leaves.distinct.flat(),
    rootType: indexType(middles.distinct.length),
    middleType: indexType(leaves.distinct.length),
    leafCount: leaves.distinct.length,
    middleCount: middles.distinct.length,
  };
}

/** Round-trips every code point through the three-stage trie the engine will read. */
export function assertThreeStageRoundTrip(label, plane, trie, leafShift, middleShift) {
  const leafMask = (1 << leafShift) - 1;
  const middleMask = (1 << middleShift) - 1;
  for (let codePoint = 0; codePoint < plane.length; codePoint += 1) {
    const middle = trie.root[codePoint >> (leafShift + middleShift)];
    const leaf = trie.middle[(middle << middleShift) | ((codePoint >> leafShift) & middleMask)];
    const decoded = trie.leaves[(leaf << leafShift) | (codePoint & leafMask)];
    if (decoded !== plane[codePoint]) {
      throw new Error(
        `${label} trie decodes U+${codePoint.toString(16).toUpperCase()} as index ${decoded}, ` +
          `expected ${plane[codePoint]}`,
      );
    }
  }
}

/**
 * Builds and verifies a three-stage trie over `valueAt`, then emits the Rust tables that back it,
 * read by `unicode::trie::lookup`.
 *
 * `valueAt(codePoint)` returns the raw value for that code point. Distinct values are collected
 * into a lookup table so the leaves stay one byte wide, unless `valueAt` already returns small
 * indices (`indexed: true`), in which case the leaves hold them directly and no table is emitted.
 */
export function emitThreeStageTrie({
  prefix,
  valueAt,
  leafShift,
  middleShift,
  valueType,
  valueLiteral,
  describe,
  indexed = false,
}) {
  const raw = new Array(CODE_POINT_COUNT);
  for (let codePoint = 0; codePoint < CODE_POINT_COUNT; codePoint += 1) {
    raw[codePoint] = valueAt(codePoint);
  }
  let plane = raw;
  let distinct;
  if (!indexed) {
    distinct = [...new Set(raw)].sort((left, right) =>
      typeof left === 'number' ? left - right : String(left).localeCompare(String(right)),
    );
    const index = new Map(distinct.map((value, position) => [value, position]));
    plane = raw.map((value) => index.get(value));
  }
  if (plane.some((value) => !Number.isInteger(value) || value < 0 || value > 0xff)) {
    throw new Error(`${prefix} leaves no longer fit u8`);
  }
  const trie = buildThreeStageTrie(plane, leafShift, middleShift);
  assertThreeStageRoundTrip(prefix, plane, trie, leafShift, middleShift);

  const literal = valueLiteral ?? ((value) => String(value));
  const values =
    distinct === undefined
      ? ''
      : `/// ${describe} Distinct values, indexed by \`${prefix}_LEAVES\`.
pub static ${prefix}_VALUES: &[${valueType}] = &[
${rustRows(distinct.map(literal))}
];

`;
  const leafContent = distinct === undefined ? '' : ` of \`${prefix}_VALUES\` indices`;
  return `${values}/// Stage 1: \`${prefix}_ROOT[code_point >> (LEAF_SHIFT + MIDDLE_SHIFT)]\` selects one of
/// ${trie.middleCount} middle blocks.
pub static ${prefix}_ROOT: &[${trie.rootType}] = &[
${rustRows(trie.root)}
];

/// Stage 2: ${trie.middleCount} distinct blocks of ${1 << middleShift} leaf selectors.
pub static ${prefix}_MIDDLE: &[${trie.middleType}] = &[
${rustRows(trie.middle)}
];

/// Stage 3: ${trie.leafCount} distinct ${1 << leafShift}-code-point leaves${leafContent}.
pub static ${prefix}_LEAVES: &[u8] = &[
${rustRows(trie.leaves)}
];

pub const ${prefix}_LEAF_SHIFT: u32 = ${leafShift};
pub const ${prefix}_MIDDLE_SHIFT: u32 = ${middleShift};`;
}

/** Sixteen per line keeps the generated file reviewable without making it enormous. */
export function rustRows(values) {
  const lines = [];
  for (let index = 0; index < values.length; index += 16) {
    lines.push(`    ${values.slice(index, index + 16).join(', ')},`);
  }
  return lines.join('\n');
}
