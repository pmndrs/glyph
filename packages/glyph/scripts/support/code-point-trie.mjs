/**
 * Two-stage code-point tries for the generated Unicode tables.
 *
 * Unicode properties are blocky, so a fixed-size block of code points repeats heavily across the
 * plane. Deduplicating blocks turns a 1.1 MB flat array into a small stage-1 index plus a handful
 * of distinct blocks, and lookup becomes two array reads instead of a binary search over sorted
 * ranges. This is the shape ICU calls `UTrie2`.
 *
 * The tables are deliberately larger in raw bytes than the sorted ranges they replace: raw costs a
 * memcpy into linear memory at instantiation, while the search cost is paid per character. See
 * D-341.
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

/**
 * Deduplicates `plane` into a two-stage trie.
 *
 * `plane` holds one value index per code point. Returns the stage-1 block selectors and the
 * concatenated distinct blocks, both as plain arrays of small integers.
 */
export function buildCodePointTrie(plane, shift) {
  if (plane.length !== CODE_POINT_COUNT) {
    throw new Error(`plane covers ${plane.length} code points, expected ${CODE_POINT_COUNT}`);
  }
  const blockSize = 1 << shift;
  const seen = new Map();
  const stage1 = [];
  const blocks = [];
  for (let base = 0; base < plane.length; base += blockSize) {
    const block = plane.slice(base, base + blockSize);
    const key = block.join(',');
    let index = seen.get(key);
    if (index === undefined) {
      index = blocks.length;
      seen.set(key, index);
      blocks.push(block);
    }
    stage1.push(index);
  }
  if (blocks.length > 0xff) {
    throw new Error(`shift ${shift} needs ${blocks.length} blocks, which no longer fits u8`);
  }
  return { stage1, stage2: blocks.flat(), blockCount: blocks.length };
}

/**
 * Round-trips every scalar value through the trie.
 *
 * A partition check would only prove the source ranges tile the plane. This proves the structure
 * the engine will actually read returns the value the Unicode data assigned, for all 1,114,112
 * code points, before anything is written.
 */
export function assertTrieRoundTrip(label, plane, trie, shift) {
  const mask = (1 << shift) - 1;
  for (let codePoint = 0; codePoint < plane.length; codePoint += 1) {
    const block = trie.stage1[codePoint >> shift];
    const decoded = trie.stage2[(block << shift) | (codePoint & mask)];
    if (decoded !== plane[codePoint]) {
      throw new Error(
        `${label} trie decodes U+${codePoint.toString(16).toUpperCase()} as index ${decoded}, ` +
          `expected ${plane[codePoint]}`,
      );
    }
  }
}

/** Sixteen per line keeps the generated file reviewable without making it enormous. */
export function rustRows(values) {
  const lines = [];
  for (let index = 0; index < values.length; index += 16) {
    lines.push(`    ${values.slice(index, index + 16).join(', ')},`);
  }
  return lines.join('\n');
}

/**
 * Builds and verifies a trie over `valueAt`, then emits the three Rust tables that back it.
 *
 * `valueAt(codePoint)` returns the raw value for that code point. Distinct values are collected
 * into a lookup table so stage 2 can stay one byte wide per entry.
 */
export function emitCodePointTrie({ prefix, valueAt, shift, valueType, valueLiteral, describe }) {
  const raw = new Array(CODE_POINT_COUNT);
  for (let codePoint = 0; codePoint < CODE_POINT_COUNT; codePoint += 1) {
    raw[codePoint] = valueAt(codePoint);
  }
  const distinct = [...new Set(raw)].sort((left, right) =>
    typeof left === 'number' ? left - right : String(left).localeCompare(String(right)),
  );
  if (distinct.length > 0xff) {
    throw new Error(`${prefix} has ${distinct.length} distinct values, which no longer fits u8`);
  }
  const index = new Map(distinct.map((value, position) => [value, position]));
  const plane = raw.map((value) => index.get(value));
  const trie = buildCodePointTrie(plane, shift);
  assertTrieRoundTrip(prefix, plane, trie, shift);

  const literal = valueLiteral ?? ((value) => String(value));
  return `/// ${describe} Distinct values, indexed by \`${prefix}_STAGE2\`.
pub static ${prefix}_VALUES: &[${valueType}] = &[
${rustRows(distinct.map(literal))}
];

/// Stage 1: \`${prefix}_STAGE1[code_point >> ${prefix}_BLOCK_SHIFT]\` selects a block.
pub static ${prefix}_STAGE1: &[u8] = &[
${rustRows(trie.stage1)}
];

/// Stage 2: ${trie.blockCount} distinct ${1 << shift}-code-point blocks of \`${prefix}_VALUES\` indices.
pub static ${prefix}_STAGE2: &[u8] = &[
${rustRows(trie.stage2)}
];

/// \`code_point >> ${prefix}_BLOCK_SHIFT\` indexes stage 1; the low bits index inside the block.
pub const ${prefix}_BLOCK_SHIFT: usize = ${shift};`;
}
