// Generates the shaper's BCP 47 to OpenType language-tag tables from the vendored HarfRust
// `tag_table.rs`, which HarfBuzz's gen-tag-table.py writes.
//
// HarfRust resolves a language in two stages: `tags_from_complex_language`, an ordered chain of
// subtag tests compiled as code, then a binary search over `OPEN_TYPE_LANGUAGES`. The shaper
// resolves languages itself and hands HarfRust the tags (the fork's `language-tags` feature is off),
// so both stages become data here: every rule in evaluation order and every table row in sorted
// order. `rust/shaper/src/language_tags.rs` interprets them, and its differential test proves the
// result equal to HarfRust's own resolution.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { rustRows } from './support/code-point-trie.mjs';

const input = new URL('../../../vendor/harfrust/src/hb/tag_table.rs', import.meta.url);
const output = new URL('../rust/shaper/src/generated/language_tag_data.rs', import.meta.url);
const check = process.argv.includes('--check');
const source = await readFile(input, 'utf8');

/** Distinct tags; index 0 is the null tag a table row uses for "no language system". */
const tags = [[0, 0, 0, 0]];
const tagIndex = new Map([['\0\0\0\0', 0]]);
function internTag(text) {
  if (!/^[A-Z0-9]{2,4} *$/.test(text) || text.length !== 4) throw new Error(`unexpected tag ${JSON.stringify(text)}`);
  if (!tagIndex.has(text)) {
    tagIndex.set(text, tags.length);
    tags.push([...text].map((character) => character.charCodeAt(0)));
  }
  return tagIndex.get(text);
}

// Stage 2: `OPEN_TYPE_LANGUAGES`. Commented-out rows are not part of the table.
const rows = [
  ...source.matchAll(
    /^ {4}LangTag \{ language: lang\(b"([a-z]{2,3})"\),\s*tag: Tag::new\((?:b"([^"]{4})"|&\[0; 4\])\) \},/gm,
  ),
];
const declared = source.match(/^ {4}LangTag \{/gm).length;
if (rows.length !== declared) throw new Error(`parsed ${rows.length} of ${declared} OPEN_TYPE_LANGUAGES rows`);
/** A key of up to three lowercase letters in base 27 (a = 1 … z = 26, absent = 0): byte order. */
const keyValue = (key) =>
  [0, 1, 2].reduce((value, index) => value * 27 + (index < key.length ? key.charCodeAt(index) - 96 : 0), 0);
const keys = rows.map(([, key]) => keyValue(key));
for (let index = 1; index < keys.length; index += 1) {
  if (keys[index - 1] > keys[index]) throw new Error('OPEN_TYPE_LANGUAGES is not sorted');
}
for (const [, , tag] of rows) if (tag !== undefined) internTag(tag);

// Stage 1: `tags_from_complex_language`, one rule per `if`, in evaluation order. The `match` on the
// first byte only partitions the rules, so a rule keeps that byte and the arms flatten into one list.
const body = source.slice(source.indexOf('pub fn tags_from_complex_language'));
const RULE = { subtag: 0, exact: 1, language: 2, prefixAndSubtag: 3 };
const rules = [];
const text = [];
function internText(value) {
  const start = text.length;
  text.push(...[...value].map((character) => character.charCodeAt(0)));
  if (start > 0xffff || value.length > 0xff) throw new Error('rule text overflow');
  return { start, length: value.length };
}
let arm = 0;
let pending;
for (const line of body.split('\n').slice(1)) {
  const trimmed = line.trim();
  let match;
  if ((match = /^b'([a-z])' => \{$/.exec(trimmed))) {
    arm = match[1].charCodeAt(0);
  } else if ((match = /^if (.*) \{$/.exec(trimmed))) {
    if (pending !== undefined) throw new Error(`rule without tags before ${trimmed}`);
    const condition = match[1];
    let parsed;
    if ((parsed = /^subtag_matches\(language, "([^"]+)"\)$/.exec(condition))) {
      if (arm !== 0) throw new Error('subtag rule inside an arm');
      pending = { kind: RULE.subtag, first: 0, text: internText(parsed[1]), subtag: { start: 0, length: 0 } };
    } else if ((parsed = /^&language\[1\.\.\] == "([^"]+)"$/.exec(condition))) {
      pending = { kind: RULE.exact, first: arm, text: internText(parsed[1]), subtag: { start: 0, length: 0 } };
    } else if ((parsed = /^lang_matches\(&language\[1\.\.\], "([^"]+)"\)$/.exec(condition))) {
      pending = { kind: RULE.language, first: arm, text: internText(parsed[1]), subtag: { start: 0, length: 0 } };
    } else if (
      (parsed = /^strncmp\(&language\[1\.\.\], "([^"]+)", (\d+)\) && subtag_matches\(language, "([^"]+)"\)$/.exec(
        condition,
      ))
    ) {
      // `strncmp(s, p, n)` with `n == p.len()` is `s.starts_with(p)`; any other `n` needs its own rule kind.
      if (Number(parsed[2]) !== parsed[1].length) throw new Error(`strncmp length differs from prefix: ${condition}`);
      pending = { kind: RULE.prefixAndSubtag, first: arm, text: internText(parsed[1]), subtag: internText(parsed[3]) };
    } else {
      throw new Error(`unrecognized rule condition: ${condition}`);
    }
    if (pending.kind !== RULE.subtag && arm === 0) throw new Error('arm rule outside an arm');
    pending.tags = [];
  } else if ((match = /Tag::new\(b"([^"]{4})"\)/.exec(trimmed))) {
    if (pending === undefined) throw new Error(`tag outside a rule: ${trimmed}`);
    pending.tags.push(internTag(match[1]));
  } else if (trimmed === 'return true;') {
    if (pending === undefined || pending.tags.length === 0 || pending.tags.length > 2)
      throw new Error('rule tag count');
    rules.push(pending);
    pending = undefined;
  } else if (trimmed === 'return false;' || trimmed === 'false') {
    break;
  } else if (
    !/^(\/\/.*|\}|_ => \{\}|match language\.as_bytes\(\)\[0\] \{|let possible_tags = &\[|\];|tags\.extend_from_slice\(possible_tags\);|tags\.push\(.*\);.*)?$/.test(
      trimmed,
    )
  ) {
    throw new Error(`unrecognized line in tags_from_complex_language: ${trimmed}`);
  }
}
const declaredRules = (body.slice(0, body.indexOf('\n}\n')).match(/^\s+if /gm) ?? []).length;
if (pending !== undefined || rules.length !== declaredRules)
  throw new Error(`parsed ${rules.length} of ${declaredRules} rules`);
if (tags.length > 0xffff) throw new Error('too many tags');

// Rows are one byte stream: per row the key's increase over the previous row and the row's tag
// index, each a little-endian base-128 varint. Tags are numbered by how many rows use them, so most
// indices take one byte. A block index every ROWS_PER_BLOCK rows keeps lookup to a binary search
// and one short scan.
const ROWS_PER_BLOCK = 64;
const rowTagText = rows.map(([, , tag]) => tag ?? '\0\0\0\0');
const frequency = new Map();
for (const tag of rowTagText) frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
for (const tag of tags.map((bytes) => String.fromCharCode(...bytes))) if (!frequency.has(tag)) frequency.set(tag, 0);
const ordered = [
  '\0\0\0\0',
  ...[...frequency.keys()]
    .filter((tag) => tag !== '\0\0\0\0')
    .sort((a, b) => frequency.get(b) - frequency.get(a) || (a < b ? -1 : 1)),
];
const order = new Map(ordered.map((tag, index) => [tag, index]));
const varint = (value) => {
  const bytes = [];
  do {
    bytes.push((value & 0x7f) | (value > 0x7f ? 0x80 : 0));
    value >>>= 7;
  } while (value > 0);
  return bytes;
};
const stream = [];
const blocks = [];
let previousKey = 0;
rows.forEach((_, index) => {
  if (index % ROWS_PER_BLOCK === 0) blocks.push([previousKey, stream.length]);
  stream.push(...varint(keys[index] - previousKey), ...varint(order.get(rowTagText[index])));
  previousKey = keys[index];
});
if (stream.length > 0xffff) throw new Error('row stream overflow');

// Rules are one byte stream in evaluation order: a header (kind | (tag count - 1) << 2), the arm's
// first byte, the text length, the subtag length for a prefix-and-subtag rule, the text, the
// subtag, then each tag as four bytes.
const ruleStream = [];
for (const rule of rules) {
  ruleStream.push(rule.kind | ((rule.tags.length - 1) << 2), rule.first, rule.text.length);
  if (rule.kind === RULE.prefixAndSubtag) ruleStream.push(rule.subtag.length);
  ruleStream.push(...text.slice(rule.text.start, rule.text.start + rule.text.length));
  ruleStream.push(...text.slice(rule.subtag.start, rule.subtag.start + rule.subtag.length));
  for (const tag of rule.tags) ruleStream.push(...tags[tag]);
}

const tagValue = (tag) =>
  `0x${[...tag].map((character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
const byteString = (bytes) =>
  bytes
    .map((byte) =>
      byte >= 0x20 && byte < 0x7f && byte !== 0x22 && byte !== 0x5c
        ? String.fromCharCode(byte)
        : `\\x${byte.toString(16).padStart(2, '0')}`,
    )
    .join('');
const generated = `// Generated by scripts/generate-language-tag-data.mjs from
// vendor/harfrust/src/hb/tag_table.rs (HarfBuzz gen-tag-table.py). Do not edit by hand.

/// OpenType language tags as big-endian \`u32\`s, most used first; index 0 is the null tag.
pub static LANGUAGE_TAGS: &[u32] = &[
${rustRows(ordered.map(tagValue))}
];

/// \`OPEN_TYPE_LANGUAGES\` rows.
pub const LANGUAGE_ROW_COUNT: usize = ${rows.length};
pub const ROWS_PER_BLOCK: usize = ${ROWS_PER_BLOCK};

/// Per row, in table order: the key's increase over the previous row's key, then the row's
/// \`LANGUAGE_TAGS\` index, each a little-endian base-128 varint. A key is up to three lowercase
/// letters in base 27 (\`a\` = 1 … \`z\` = 26, absent = 0), which sorts as the keys' bytes do.
pub static LANGUAGE_ROWS: &[u8] = &[
${rustRows(stream)}
];

/// Per block of \`ROWS_PER_BLOCK\` rows: the key of the row before it (0 for the first block) and
/// the block's offset in \`LANGUAGE_ROWS\`.
pub static LANGUAGE_ROW_BLOCKS: &[(u16, u16)] = &[
${rustRows(blocks.map(([key, offset]) => `(${key}, ${offset})`))}
];

/// \`tags_from_complex_language\`, ${rules.length} rules in evaluation order. Per rule: a header
/// (kind | (tag count - 1) << 2), the first byte, the text length, the subtag length (prefix and
/// subtag rules only), the text, the subtag, and each tag as four big-endian bytes.
pub static LANGUAGE_RULES: &[u8] = b"${byteString(ruleStream)}";
`;

if (check) {
  let existing;
  try {
    existing = await readFile(output, 'utf8');
  } catch {
    existing = undefined;
  }
  if (existing !== generated) {
    console.error('generated language tag data is stale; run pnpm run unicode generate-data');
    process.exitCode = 1;
  }
} else {
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, generated);
  console.log(`language tags: ${rows.length} table rows, ${rules.length} rules, ${tags.length} distinct tags`);
}
