// Generates the dense Unicode kernel's unit classes as a property closure over the UCD.
//
// A UTF-16 unit is in the kernel closure only when every property the scalar analysis reads for it
// is one the kernel's rules implement:
//   - line breaking: its resolved UAX #14 class is in KERNEL_CLASSES below, it was not resolved from
//     SA (Thai, Lao, Khmer, Myanmar stay on the general path so a dictionary source can replace
//     them), and it is not U+25CC (LB28a reads that code point, not a class);
//   - graphemes: Grapheme_Cluster_Break is Other, Control, LF, LV or LVT and it has no
//     Indic_Conjunct_Break value, so two closure units always have a boundary between them;
//   - encoding: it is a BMP scalar (surrogates always take the scalar residue).
// Everything else is class 0, the residue. Membership is decided from properties only; no script
// or block is named here. The Rust tests prove the closure by exhaustive kernel-versus-scalar
// comparison over one representative of every distinct property tuple.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { EastAsianWidth } from '@cto.af/linebreak';
import { LineBreak, names } from '@cto.af/linebreak/lib/LineBreak.js';
import { resolve } from '@cto.af/linebreak/lib/state.js';

import { rustRows } from './support/code-point-trie.mjs';

const require = createRequire(import.meta.url);
const unicode = require('@unicode/unicode-17.0.0');
const propertyAliases = require('unicode-property-value-aliases');
const output = new URL('../rust/shaper/src/generated/kernel_data.rs', import.meta.url);
const check = process.argv.includes('--check');

/** Kernel class ids. Order is the Rust `unicode_kernel` contract; 0 is the residue. */
const KERNEL_CLASSES = [
  'XX',
  'AL',
  'HL',
  'NU',
  'SP',
  'BA',
  'HY',
  'HH',
  'EX',
  'IS',
  'SY',
  'OP',
  'CL',
  'CP',
  'QU',
  'PI',
  'PF',
  'PR',
  'PO',
  'GL',
  'B2',
  'HARD',
  'ID',
  'NS',
  'H23',
  'IN',
  'BB',
];
const EAST_ASIAN_BIT = 0x20;
/// Set on closure letters that a local edit may resynchronise between (see `unicode_resync.rs`).
const RESYNC_LETTER_BIT = 0x40;
const RESYNC_WORD_BREAK = new Set(['ALetter', 'Hebrew_Letter']);
const RESYNC_SENTENCE_BREAK = new Set(['Upper', 'Lower', 'OLetter']);
const SCRIPT_COMPLEX = 0xff;
const INERT_GRAPHEME = new Set(['Other', 'Control', 'LF', 'LV', 'LVT']);

const codePoints = (path) => require(`@unicode/unicode-17.0.0/${path}/code-points.js`);
const initial = new Set(codePoints('General_Category/Initial_Punctuation'));
const final = new Set(codePoints('General_Category/Final_Punctuation'));
const conjunct = new Set(codePoints('Binary_Property/InCB'));
const pictographic = new Set(codePoints('Binary_Property/Extended_Pictographic'));
const unassigned = new Set(codePoints('General_Category/Unassigned'));
const nameOfClass = Object.fromEntries(Object.entries(names).map(([name, value]) => [value, name]));

const graphemeBreak = new Map();
for (const value of unicode.Grapheme_Cluster_Break) {
  if (value === 'Other') continue;
  for (const codePoint of codePoints(`Grapheme_Cluster_Break/${value}`)) {
    graphemeBreak.set(codePoint, value);
  }
}

const scriptAliases = propertyAliases.get('Script');
const scriptOf = new Map();
const extensionsOf = new Map();
const tagOf = new Map();
for (const script of unicode.Script) {
  const alias = [...scriptAliases].find(([name, canonical]) => canonical === script && /^[A-Z][a-z]{3}$/.test(name))[0];
  tagOf.set(script, alias);
  for (const codePoint of codePoints(`Script/${script}`)) scriptOf.set(codePoint, alias);
  for (const codePoint of codePoints(`Script_Extensions/${script}`)) {
    if (!extensionsOf.has(codePoint)) extensionsOf.set(codePoint, []);
    extensionsOf.get(codePoint).push(alias);
  }
}
const NEUTRAL = new Set(['Zyyy', 'Zinh', 'Zzzz']);

function kernelClass(codePoint) {
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return 0;
  if (codePoint === 0x25cc) return 0;
  const original = nameOfClass[LineBreak.get(codePoint)];
  if (original === 'SA') return 0;
  if (!INERT_GRAPHEME.has(graphemeBreak.get(codePoint) ?? 'Other')) return 0;
  if (conjunct.has(codePoint)) return 0;
  const resolved = nameOfClass[resolve(LineBreak.get(codePoint), String.fromCodePoint(codePoint))];
  let name;
  switch (resolved) {
    case 'BK':
    case 'LF':
    case 'NL':
      name = 'HARD';
      break;
    case 'H2':
    case 'H3':
      name = 'H23';
      break;
    case 'QU':
      name = initial.has(codePoint) ? 'PI' : final.has(codePoint) ? 'PF' : 'QU';
      break;
    default:
      name = resolved;
  }
  const id = KERNEL_CLASSES.indexOf(name);
  if (id <= 0) return 0;
  // The kernel's LB30 term assumes no East Asian CP; a future UCD that adds one must fail here.
  if (name === 'CP' && EastAsianWidth.get(codePoint)) {
    throw new Error(`East Asian CP U+${codePoint.toString(16)} is outside the kernel's rules`);
  }
  return id | (EastAsianWidth.get(codePoint) ? EAST_ASIAN_BIT : 0);
}

/**
 * Script byte: 0 neutral with no candidates, 1.. an explicit single script, SCRIPT_SET_BASE.. a
 * neutral unit whose Script_Extensions name candidate scripts (index into the set table), and
 * 0xff the scalar path.
 */
const SCRIPT_SET_BASE = 0x80;
const scriptIds = new Map();
const scriptTags = ['Zyyy'];
let scriptSetIds = new Map();
let scriptSets = [];
let setPopulation = new Map();
/** When set, only these candidate sets get an id; the rest take the scalar path. */
let allowedSets;
function scriptByte(codePoint) {
  const script = scriptOf.get(codePoint) ?? 'Zzzz';
  const extensions = extensionsOf.get(codePoint) ?? [script];
  if (NEUTRAL.has(script)) {
    const candidates = extensions.filter((tag) => !NEUTRAL.has(tag)).sort();
    if (candidates.length === 0) return 0;
    const key = candidates.join(',');
    if (allowedSets !== undefined && !allowedSets.has(key)) return SCRIPT_COMPLEX;
    let id = scriptSetIds.get(key);
    if (id === undefined) {
      id = SCRIPT_SET_BASE + scriptSets.length;
      if (id >= SCRIPT_COMPLEX) return SCRIPT_COMPLEX;
      scriptSetIds.set(key, id);
      scriptSets.push(candidates);
      setPopulation.set(key, 0);
    }
    setPopulation.set(key, setPopulation.get(key) + 1);
    return id;
  }
  if (extensions.length !== 1 || extensions[0] !== script) return SCRIPT_COMPLEX;
  let id = scriptIds.get(script);
  if (id === undefined) {
    id = scriptTags.length;
    if (id >= SCRIPT_SET_BASE) throw new Error('explicit script ids no longer fit below the sets');
    scriptIds.set(script, id);
    scriptTags.push(script);
  }
  return id;
}

const sentenceBreak = new Map();
for (const value of unicode.Sentence_Break) {
  if (value === 'Other') continue;
  for (const codePoint of codePoints(`Sentence_Break/${value}`)) sentenceBreak.set(codePoint, value);
}
const wordBreak = new Map();
for (const value of unicode.Word_Break) {
  if (value === 'Other') continue;
  for (const codePoint of codePoints(`Word_Break/${value}`)) wordBreak.set(codePoint, value);
}

/**
 * The resync letter property: line-break class AL or HL, an explicit single script, and a word
 * and sentence class that is a plain letter, so a single space between two of them restarts the
 * line-break, grapheme, word and sentence lanes.
 */
function isResyncLetter(codePoint, kernel, script) {
  const name = KERNEL_CLASSES[kernel & 0x1f];
  return (
    (name === 'AL' || name === 'HL') &&
    (kernel & EAST_ASIAN_BIT) === 0 &&
    script !== 0 &&
    script < SCRIPT_SET_BASE &&
    RESYNC_WORD_BREAK.has(wordBreak.get(codePoint) ?? 'Other') &&
    RESYNC_SENTENCE_BREAK.has(sentenceBreak.get(codePoint) ?? 'Other')
  );
}

const UNIT_COUNT = 0x1_0000;
const values = new Array(UNIT_COUNT);
let summary;
function classifyUnits() {
  scriptSetIds = new Map();
  scriptSets = [];
  setPopulation = new Map();
  summary = new Map();
  for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
    const base = kernelClass(unit);
    const script = base === 0 ? SCRIPT_COMPLEX : scriptByte(unit);
    const kernel = base | (isResyncLetter(unit, base, script) ? RESYNC_LETTER_BIT : 0);
    values[unit] = kernel | (script << 8);
    const name =
      KERNEL_CLASSES[kernel & 0x1f] +
      (kernel & EAST_ASIAN_BIT ? '+EastAsian' : '') +
      (kernel & RESYNC_LETTER_BIT ? '+ResyncLetter' : '');
    const entry = summary.get(name) ?? { count: 0, first: unit };
    entry.count += 1;
    summary.set(name, entry);
  }
  return new Set(values).size;
}
// The leaves index a value table with one byte, so at most 256 distinct class and script pairs
// fit. Candidate sets are admitted most-populous first until the table is full; a set left out
// costs only speed, since its units take the scalar script routine.
if (classifyUnits() > 0x100) {
  const ranked = [...setPopulation].sort(
    ([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey),
  );
  let admitted = ranked.length;
  do {
    admitted -= 1;
    allowedSets = new Set(ranked.slice(0, admitted).map(([key]) => key));
  } while (classifyUnits() > 0x100);
}

// Three-stage table over the BMP: 16-unit leaves, 16-leaf middles. Leaves and middles are
// deduplicated; the value table keeps stage 3 one byte wide.
const distinct = [...new Set(values)].sort((left, right) => left - right);
if (distinct.length > 0x100) throw new Error(`${distinct.length} kernel values no longer fit u8`);
const valueIndex = new Map(distinct.map((value, index) => [value, index]));
function dedupe(items, size, limit, label) {
  const seen = new Map();
  const selectors = [];
  const blocks = [];
  for (let base = 0; base < items.length; base += size) {
    const block = items.slice(base, base + size);
    const key = block.join(',');
    let index = seen.get(key);
    if (index === undefined) {
      index = blocks.length;
      seen.set(key, index);
      blocks.push(block);
    }
    selectors.push(index);
  }
  if (blocks.length > limit) throw new Error(`${label} needs ${blocks.length} blocks`);
  return { selectors, flat: blocks.flat() };
}
const leaves = dedupe(
  values.map((value) => valueIndex.get(value)),
  16,
  0x1_0000,
  'kernel leaves',
);
const middles = dedupe(leaves.selectors, 16, 0x100, 'kernel middles');
for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
  const middle = middles.selectors[unit >> 8];
  const leaf = middles.flat[(middle << 4) | ((unit >> 4) & 15)];
  if (distinct[leaves.flat[(leaf << 4) | (unit & 15)]] !== values[unit]) {
    throw new Error(`kernel table decodes U+${unit.toString(16)} wrongly`);
  }
}
const leafType = Math.max(...middles.flat) > 0xff ? 'u16' : 'u8';

// One representative per distinct tuple of every property the scalar analysis reads, so the
// exhaustive closure tests cover each behaviour the tables can produce, not one sample per class.
const representatives = new Map();
function lineTuple(codePoint) {
  const resolved = resolve(LineBreak.get(codePoint), String.fromCodePoint(codePoint));
  return [
    resolved,
    initial.has(codePoint),
    final.has(codePoint),
    Boolean(EastAsianWidth.get(codePoint)),
    pictographic.has(codePoint) && unassigned.has(codePoint),
    codePoint === 0x25cc,
  ].join('/');
}
for (let codePoint = 0; codePoint < 0x11_0000; codePoint += 1) {
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
  const kernel = codePoint < UNIT_COUNT ? values[codePoint] & 0xff : 0;
  const key = [
    kernel,
    lineTuple(codePoint),
    graphemeBreak.get(codePoint) ?? 'Other',
    conjunct.has(codePoint),
    pictographic.has(codePoint),
    codePoint < UNIT_COUNT,
  ].join('|');
  if (!representatives.has(key)) representatives.set(key, codePoint);
}
const segmentationRepresentatives = new Map();
for (let codePoint = 0; codePoint < 0x11_0000; codePoint += 1) {
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
  const key = [
    wordBreak.get(codePoint) ?? 'Other',
    sentenceBreak.get(codePoint) ?? 'Other',
    graphemeBreak.get(codePoint) ?? 'Other',
    pictographic.has(codePoint),
    codePoint < UNIT_COUNT ? values[codePoint] & 0x5f : 0,
  ].join('|');
  if (!segmentationRepresentatives.has(key)) segmentationRepresentatives.set(key, codePoint);
}

const hex = (value) => `0x${value.toString(16)}`;
const tagValue = (tag) =>
  tag.charCodeAt(0) * 0x1_000000 + tag.charCodeAt(1) * 0x1_0000 + tag.charCodeAt(2) * 0x100 + tag.charCodeAt(3);
const setOffsets = [0];
for (const set of scriptSets) setOffsets.push(setOffsets.at(-1) + set.length);
const closure = [...summary]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(
    ([name, entry]) =>
      `//   ${name.padEnd(16)} ${String(entry.count).padStart(6)} units, first U+${entry.first
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')}`,
  )
  .join('\n');
const classConstants = KERNEL_CLASSES.map((name, id) => `pub const K_${name}: u8 = ${id};`).join('\n');

const source = `// Generated by scripts/generate-unicode-kernel-data.mjs from
// @cto.af/linebreak@4.0.3 and @unicode/unicode-17.0.0@1.6.17. Do not edit by hand.
//
// Kernel closure by class (BMP UTF-16 units; XX is the scalar residue):
${closure}
//
// Explicit single-script units carry one of ${scriptTags.length - 1} script ids, neutral units with
// Script_Extensions candidates one of ${scriptSets.length} set ids; an explicit script with other
// extensions and everything outside the closure carry SCRIPT_COMPLEX.

${classConstants}
pub const KERNEL_CLASS_MASK: u8 = 0x1f;
pub const KERNEL_EAST_ASIAN: u8 = ${hex(EAST_ASIAN_BIT)};
pub const KERNEL_RESYNC_LETTER: u8 = ${hex(RESYNC_LETTER_BIT)};
pub const KERNEL_SCRIPT_COMPLEX: u8 = ${hex(SCRIPT_COMPLEX)};

/// Script tags indexed by the script byte; index 0 is Common (a neutral unit).
pub static KERNEL_SCRIPT_TAGS: &[u32] = &[
${rustRows(scriptTags.map(tagValue))}
];

/// Candidate script sets of neutral units: set \`i\` (script byte \`KERNEL_SCRIPT_SET_BASE + i\`)
/// is \`KERNEL_SCRIPT_SET_TAGS[KERNEL_SCRIPT_SET_OFFSETS[i]..KERNEL_SCRIPT_SET_OFFSETS[i + 1]]\`.
pub const KERNEL_SCRIPT_SET_BASE: u8 = ${hex(SCRIPT_SET_BASE)};
pub static KERNEL_SCRIPT_SET_OFFSETS: &[u16] = &[
${rustRows(setOffsets)}
];
pub static KERNEL_SCRIPT_SET_TAGS: &[u32] = &[
${rustRows(scriptSets.flat().map(tagValue))}
];

/// \`class | script << 8\` for units below 0x80, read without the staged lookup.
pub static KERNEL_ASCII: [u16; 128] = [
${rustRows(values.slice(0, 128).map(hex))}
];

/// Distinct \`class | script << 8\` values, indexed by \`KERNEL_LEAVES\`.
pub static KERNEL_VALUES: &[u16] = &[
${rustRows(distinct.map(hex))}
];

/// Stage 1: \`KERNEL_ROOT[unit >> 8]\` selects a 16-entry middle block.
pub static KERNEL_ROOT: &[u8] = &[
${rustRows(middles.selectors)}
];

/// Stage 2: \`KERNEL_MIDDLE[root << 4 | (unit >> 4 & 15)]\` selects a 16-unit leaf.
pub static KERNEL_MIDDLE: &[${leafType}] = &[
${rustRows(middles.flat)}
];

/// Stage 3: \`KERNEL_LEAVES[leaf << 4 | (unit & 15)]\` indexes \`KERNEL_VALUES\`.
pub static KERNEL_LEAVES: &[u8] = &[
${rustRows(leaves.flat)}
];

/// One code point per distinct (kernel class, line-break properties, grapheme break, conjunct
/// break, pictographic, plane) tuple.
#[allow(dead_code)]
pub static KERNEL_TEST_REPRESENTATIVES: &[u32] = &[
${rustRows([...representatives.values()].map(hex))}
];

/// One code point per distinct (word break, sentence break, grapheme break, pictographic, kernel
/// class) tuple.
#[allow(dead_code)]
pub static SEGMENTATION_TEST_REPRESENTATIVES: &[u32] = &[
${rustRows([...segmentationRepresentatives.values()].map(hex))}
];
`;

if (check) {
  let existing;
  try {
    existing = await readFile(output, 'utf8');
  } catch {
    existing = undefined;
  }
  if (existing !== source) {
    console.error('generated Unicode kernel data is stale; run pnpm run unicode generate-data');
    process.exitCode = 1;
  }
} else {
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, source);
  console.log(
    `kernel table: ${distinct.length} values, ${middles.flat.length / 16} middles, ` +
      `${leaves.flat.length / 16} leaves, ${representatives.size} representatives, ` +
      `${segmentationRepresentatives.size} segmentation representatives`,
  );
}
