// Generates src/hb/ucd_table.rs from upstream's src/hb/ucd_table_upstream.rs (kept verbatim).
//
// Upstream's packtab output stores every Unicode property's sub-arrays in two shared statics,
// `_hb_ucd_u8` and `_hb_ucd_u16`. A linker keeps a static whole, so the script property's region
// stays linked although nothing in an embedding that never guesses segment properties reads it.
// This rewrite gives each property its own `_hb_ucd_<property>_u8` / `_u16` statics holding exactly
// its region, and rebases that property's indices by the region's start. Values and lookup shape are
// unchanged; the generated test compares every property with upstream's at every code point.
//
// usage: node vendor/harfrust/tools/split-ucd-table.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const directory = new URL('../src/hb/', import.meta.url);
const upstream = readFileSync(new URL('ucd_table_upstream.rs', directory), 'utf8');
const shared = ['u8', 'u16'];
const staticAttribute = '#[allow(dead_code, non_upper_case_globals, clippy::allow_attributes_without_reason)]\n';

function sharedArray(type) {
  const pattern = new RegExp(
    String.raw`${escape(staticAttribute)}static _hb_ucd_${type}: \[${type}; (\d+)\]=\n\[\n(.*?)\n\];\n`,
    's',
  );
  const match = pattern.exec(upstream);
  if (!match) throw new Error(`_hb_ucd_${type} not found`);
  const values = match[2]
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (values.length !== Number(match[1])) throw new Error(`_hb_ucd_${type} length mismatch`);
  return { text: match[0], values };
}

function escape(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

const functionPattern = /pub\(crate\) fn _hb_ucd_(\w+) \(u: usize\) -> \w+\n\{\n(.*?)\n\}/gs;
const properties = [...upstream.matchAll(functionPattern)].map((match) => ({ name: match[1], body: match[2] }));

// Every index into a shared array is `_hb_ucd_<type>[<offset>usize+`, a bare `_hb_ucd_<type>[(`
// (offset 0), or the nibble read `_hb_ucd_b4(&_hb_ucd_u8[<offset>usize..]`.
const indexPattern = /_hb_ucd_(u8|u16)\[(?:(\d+)usize(\+|\.\.\])|(?=\())/g;
const offsets = (body, type) =>
  [...body.matchAll(indexPattern)].filter((match) => match[1] === type).map((match) => Number(match[2] ?? 0));

// Packtab lays the properties out one after another, so a property's region runs from its lowest
// offset to the next property's lowest offset in the same array.
const arrays = Object.fromEntries(shared.map((type) => [type, sharedArray(type)]));
const regions = new Map(properties.map((property) => [property.name, {}]));
for (const type of shared) {
  const starts = properties
    .map((property) => ({ name: property.name, offsets: offsets(property.body, type) }))
    .filter((entry) => entry.offsets.length > 0)
    .map((entry) => ({ name: entry.name, start: Math.min(...entry.offsets) }))
    .sort((left, right) => left.start - right.start);
  if (starts[0]?.start !== 0) throw new Error(`_hb_ucd_${type} does not start with a property region`);
  starts.forEach((entry, index) => {
    regions.get(entry.name)[type] = { start: entry.start, end: starts[index + 1]?.start ?? arrays[type].values.length };
  });
}

let output = upstream;
const statics = [];
for (const type of shared) {
  for (const { name } of properties) {
    const region = regions.get(name)[type];
    if (!region) continue;
    const values = arrays[type].values.slice(region.start, region.end);
    const rows = [];
    for (let index = 0; index < values.length; index += 16) {
      rows.push(
        `${values
          .slice(index, index + 16)
          .map((value) => value.padStart(5))
          .join(',')},`,
      );
    }
    statics.push(
      `${staticAttribute}static _hb_ucd_${name}_${type}: [${type}; ${values.length}]=\n[\n${rows.join('\n')}\n];\n`,
    );
  }
  output = output.replace(arrays[type].text, '');
}
const i16Static = `${staticAttribute}static _hb_ucd_i16`;
if (!output.includes(i16Static)) throw new Error('_hb_ucd_i16 not found');
output = output.replace(i16Static, `${statics.join('\n')}\n${i16Static}`);

for (const { name, body } of properties) {
  const rebased = body.replace(indexPattern, (match, type, offset, tail) => {
    const region = regions.get(name)[type];
    const at = Number(offset ?? 0) - region.start;
    if (at < 0 || at >= region.end - region.start) throw new Error(`${name}: ${match} is outside its region`);
    return `_hb_ucd_${name}_${type}[${at}usize${tail ?? '+'}`;
  });
  if (!output.includes(body)) throw new Error(`${name}: body not found`);
  output = output.replace(body, () => rebased);
}
if (/_hb_ucd_u(8|16)\b/.test(output)) throw new Error('a shared-array reference survived the split');

output = output.replace(
  '/* == Start of generated table == */\n',
  '/* == Start of generated table == */\n' +
    '/*\n * pmndrs/glyph fork: generated from ucd_table_upstream.rs by tools/split-ucd-table.mjs, which gives\n' +
    ' * each property its own arrays so an unused property is not linked. Do not edit; see GLYPH-FORK.md.\n */\n',
);
const checks = properties
  .map(
    ({ name }) =>
      `            assert_eq!(split::_hb_ucd_${name}(u), upstream::_hb_ucd_${name}(u), "${name} at U+{u:04X}");`,
  )
  .join('\n');
output +=
  '\n#[cfg(test)]\nmod tests {\n' +
  '    use super::ucd as split;\n' +
  '    use crate::hb::ucd_table_upstream::ucd as upstream;\n\n' +
  '    #[test]\n' +
  '    fn every_property_equals_upstream_at_every_code_point() {\n' +
  '        for u in 0..0x11_0000_usize {\n' +
  `${checks}\n` +
  '        }\n' +
  '    }\n' +
  '}\n';
writeFileSync(new URL('ucd_table.rs', directory), output);
