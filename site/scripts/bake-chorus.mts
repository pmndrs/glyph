import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { WORDS } from '../landing/src/chorus-words';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..');
const fixtures = resolve(site, '../apps/benchmarks/fixtures/fonts');
const noto = resolve(fixtures, 'noto-sans-v2026');

/**
 * Everything the chorus needs, in one run: fetch the faces if they are missing,
 * verify what is on disk, ask each face what it can actually draw, and bake it
 * to exactly that.
 *
 * Coverage is never declared. Add a word in `chorus-words.ts` and re-run — the
 * script works out which face should carry it, and fails loudly naming the code
 * points if none can.
 */
const COMMIT = '3a06b1c521155492df224d33464b3c7b2852d861';
const SOURCE = `https://raw.githubusercontent.com/notofonts/notofonts.github.io/${COMMIT}`;

/**
 * Fallback order. Noto Sans leads because it carries Latin, Greek and Cyrillic;
 * the scripted faces follow.
 */
const NOTO = [
  'NotoSans',
  'NotoSansHebrew',
  'NotoSansDevanagari',
  'NotoSansBengali',
  'NotoSansGurmukhi',
  'NotoSansGujarati',
  'NotoSansOriya',
  'NotoSansTamil',
  'NotoSansTelugu',
  'NotoSansKannada',
  'NotoSansMalayalam',
  'NotoSansSinhala',
  'NotoSansThai',
  'NotoSansLao',
  'NotoSansKhmer',
  'NotoSansGeorgian',
  'NotoSansArmenian',
  'NotoSansEthiopic',
] as const;

/**
 * CJK, from elsewhere and deliberately not Noto.
 *
 * Noto Sans CJK ships only CFF outlines, and the baker rasterises a CFF face to
 * nothing — no error, no warning, just a GLB with shaping data and an empty
 * raster, so the words lay out at full width and draw as holes. These three are
 * static TrueType, which rasterises correctly. Noto Sans JP/SC/KR are TrueType
 * but variable-only, which the baker rejects outright.
 */
const CJK = [
  { file: 'MPLUS1p-Regular.ttf', name: 'japanese', path: 'ofl/mplus1p/MPLUS1p-Regular.ttf' },
  { file: 'NanumGothic-Regular.ttf', name: 'korean', path: 'ofl/nanumgothic/NanumGothic-Regular.ttf' },
  {
    file: 'ZCOOLXiaoWei-Regular.ttf',
    name: 'chinese',
    path: 'ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf',
  },
] as const;

const GOOGLE_FONTS = 'https://raw.githubusercontent.com/google/fonts/main';

/**
 * Not in any word, but both are set.
 *
 * U+0020 because every line break needs one, and U+00B7 MIDDLE DOT because the
 * stream separates entries with it — without a mark between them a run of
 * unfamiliar scripts reads as one continuous string rather than as a list of
 * words in different languages.
 */
/**
 * Atlas texels per em, and the encoded distance range in atlas pixels.
 *
 * The chorus sets at roughly 28 css px, so the default of 64 texels per em is
 * more than twice what it can show. Atlas cost is area, so halving the em size
 * quarters the artifact.
 */
const EM_SIZE = 32;
const PIXEL_RANGE = 6;

const ALWAYS = [0x20, 0x00b7];

const check = process.argv.includes('--check');

await mkdir(noto, { recursive: true });
const present = new Set(await readdir(noto).catch(() => []));

const faces: { file: string; name: string }[] = [];

async function ensure(file: string, url: string): Promise<string> {
  const target = resolve(noto, file);
  if (present.has(file)) return target;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${file}: ${response.status} fetching ${url}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  console.log(`fetched ${file}`);
  return target;
}

for (const family of NOTO) {
  const file = `${family}-Regular.ttf`;
  faces.push({
    file: await ensure(file, `${SOURCE}/fonts/${family}/hinted/ttf/${file}`),
    name: family.replace(/^NotoSans/, '').toLowerCase() || 'latin',
  });
}

for (const face of CJK) {
  faces.push({
    file: await ensure(face.file, `${GOOGLE_FONTS}/${face.path}`),
    name: face.name,
  });
}

const wanted = new Set<number>(ALWAYS);
for (const word of WORDS) for (const character of word) wanted.add(character.codePointAt(0)!);

let claimed = new Set<number>();
const baked: { glyphs: number; name: string; points: number[] }[] = [];

for (const face of faces) {
  const bytes = await readFile(face.file);
  const covered = coverage(bytes, wanted);

  // Fallback order decides ownership, so no face ships a glyph an earlier one in
  // the stack would already have been asked for.
  const owned = [...covered].filter((point) => !claimed.has(point)).sort((a, b) => a - b);
  claimed = new Set([...claimed, ...covered]);
  if (owned.length === 0) continue;

  const output = resolve(site, `landing/assets/chorus-${face.name}.font.glb`);
  await run(
    'pnpm',
    [
      'exec',
      'glyph',
      'bake',
      '--input',
      face.file,
      '--output',
      output,
      '--unicodes',
      owned.map((point) => `U+${point.toString(16).toUpperCase().padStart(4, '0')}`).join(','),
      // The chorus sets at roughly 28 css px, so the default of 64 atlas texels
      // per em is more than twice what it can show. Atlas cost is area, so
      // halving the em size quarters the artifact: this face set went from
      // 4.64 MB to a fraction of it with no visible change.
      '--msdf',
      `em-size=${EM_SIZE},pixel-range=${PIXEL_RANGE}`,
      ...(check ? ['--check'] : []),
    ],
    { cwd: site },
  );
  baked.push({ glyphs: owned.length, name: face.name, points: owned });
  console.log(`${face.name}: ${owned.length} glyphs -> ${relative(site, output)}`);
}

const missing = [...wanted].filter((point) => !claimed.has(point));
if (missing.length > 0) {
  const list = missing.map((point) => `U+${point.toString(16).toUpperCase()}`).join(', ');
  throw new Error(`no face covers ${list}; add one to FAMILIES or drop the word that needs it`);
}

// Every code point the page needs and the face that ends up drawing it. The
// mapping is derived, so writing it down is the only way it can be reviewed —
// and a diff on this file is how an unintended coverage change gets noticed.
await writeFile(
  resolve(site, 'landing/assets/chorus-coverage.json'),
  `${JSON.stringify(
    {
      faces: baked.map(({ glyphs, name, points }) => ({
        chars: points.map((point) => String.fromCodePoint(point)).join(''),
        glyphs,
        name,
        points: points.map((point) => `U+${point.toString(16).toUpperCase().padStart(4, '0')}`),
      })),
      generated: 'site/scripts/bake-chorus.mts',
      totals: { faces: baked.length, points: [...claimed].length, words: WORDS.length },
    },
    null,
    2,
  )}\n`,
);

// The stack the app loads, in the order the engine should try the faces. Emitted
// rather than hand-maintained so adding a script is only ever a word-list edit.
await writeFile(
  resolve(site, 'landing/src/chorus-stack.ts'),
  [
    '// Generated by site/scripts/bake-chorus.mts. Do not edit.',
    ...baked.map(({ name }, index) => `import face${index} from '../assets/chorus-${name}.font.glb?url';`),
    '',
    '/** Fallback order: Latin first, CJK last, scripted faces in between. */',
    'export const CHORUS_URLS = [',
    ...baked.map((_, index) => `  face${index},`),
    '] as const;',
    '',
  ].join('\n'),
);

console.log(`\n${baked.length} faces, ${[...claimed].length} glyphs, ${WORDS.length} words`);

/** Every requested code point this font's character map can actually draw. */
function coverage(font: Buffer, requested: ReadonlySet<number>): Set<number> {
  const cmap = directory(font).get('cmap');
  if (cmap === undefined) throw new Error('font has no cmap');

  const found = new Set<number>();
  const count = font.readUInt16BE(cmap + 2);
  for (let index = 0; index < count; index += 1) {
    const record = cmap + 4 + index * 8;
    if (font.readUInt16BE(record) !== 3) continue;
    const encoding = font.readUInt16BE(record + 2);
    if (encoding !== 1 && encoding !== 10) continue;

    const subtable = cmap + font.readUInt32BE(record + 4);
    const format = font.readUInt16BE(subtable);
    if (format === 4) readFormat4(font, subtable, requested, found);
    else if (format === 12) readFormat12(font, subtable, requested, found);
  }
  return found;
}

function directory(font: Buffer): Map<string, number> {
  const tables = new Map<string, number>();
  const count = font.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const entry = 12 + index * 16;
    tables.set(font.toString('latin1', entry, entry + 4), font.readUInt32BE(entry + 8));
  }
  return tables;
}

function readFormat4(font: Buffer, subtable: number, requested: ReadonlySet<number>, found: Set<number>): void {
  const segments = font.readUInt16BE(subtable + 6) / 2;
  const ends = subtable + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;

  for (const point of requested) {
    if (point > 0xffff) continue;
    for (let segment = 0; segment < segments; segment += 1) {
      const end = font.readUInt16BE(ends + segment * 2);
      if (point > end) continue;
      const start = font.readUInt16BE(starts + segment * 2);
      if (point < start) break;

      const offset = font.readUInt16BE(ranges + segment * 2);
      let glyph: number;
      if (offset === 0) {
        glyph = (point + font.readInt16BE(deltas + segment * 2)) & 0xffff;
      } else {
        const at = ranges + segment * 2 + offset + (point - start) * 2;
        if (at + 1 >= font.length) break;
        glyph = font.readUInt16BE(at);
        if (glyph !== 0) glyph = (glyph + font.readInt16BE(deltas + segment * 2)) & 0xffff;
      }
      if (glyph !== 0) found.add(point);
      break;
    }
  }
}

function readFormat12(font: Buffer, subtable: number, requested: ReadonlySet<number>, found: Set<number>): void {
  const groups = font.readUInt32BE(subtable + 12);
  for (let group = 0; group < groups; group += 1) {
    const entry = subtable + 16 + group * 12;
    if (font.readUInt32BE(entry + 8) === 0) continue;
    const start = font.readUInt32BE(entry);
    const end = font.readUInt32BE(entry + 4);
    for (const point of requested) if (point >= start && point <= end) found.add(point);
  }
}

/* @workflow
{
  "name": "site:bake-chorus",
  "summary": "Fetch, verify and bake every chorus face to exactly the glyphs the word list needs.",
  "requirements": "A built @pmndrs/glyph; network access only when a fixture is missing.",
  "writes": "Noto fixtures, site/landing/assets/chorus-*.font.glb, and the generated stack."
}
*/
