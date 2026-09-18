/* @workflow {
  "name": "hero:bake",
  "summary": "Bake every Glyph Hero font subset to Slug, or verify them with --check.",
  "requirements": "Built Glyph package (the glyph CLI) and the benchmark font fixtures.",
  "writes": "apps/hero/assets/*.font.glb and apps/hero/assets/icons.map.json"
} */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BACKGROUND_WORDS,
  FEATURE_FIELD,
  FEATURE_LINE,
  HEADLINE,
  TITLE,
  type FaceId,
} from '../src/typography/content.ts';
import { ICON_CODE_POINTS } from '../src/field/content.ts';
import { STAR_SYMBOLS } from '../src/sequence/symbols.ts';
import { ORIGIN_STORY, ORIGIN_TITLE, TITLE_WORDS } from '../src/origin/content.ts';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const glyph = fileURLToPath(new URL('../node_modules/.bin/glyph', import.meta.url));
const fixtures = '../../benches/fixtures/fonts';
const BASIC_LATIN = { from: 0x20, to: 0x7e };
/** The origin column is set in this face. Its copy is scanned so punctuation outside Basic Latin gets baked too. */
const ORIGIN_STORY_FACE = 'geist-medium' as const;

interface FaceBake {
  readonly input: string;
  /** Extra rasters baked into the same asset, beyond Slug. */
  readonly rasters?: readonly string[];
  /** Faces people may type into or edit get all of Basic Latin. The rest bake only what content uses. */
  readonly basicLatin: boolean;
  /**
   * CFF sources bake whole: `--unicodes` subsetting in glyph's CLI currently drops the CFF outline table
   * ("font has no glyf, CFF, or CFF2 outline table to convert"). The CJK face uses the repository's hb-subset
   * showcase subset instead of the 16.5 MB source.
   */
  readonly subset?: false;
}

const FACES: Readonly<Record<FaceId, FaceBake>> = {
  // All of Basic Latin: subsetting to the current word silently drops letters the moment the copy changes.
  // MSDF alongside Slug: the distance field is what makes a soft per-letter shadow possible.
  'geist-black': { input: 'fonts/geist-1.7.2/Geist-Black.ttf', basicLatin: true, rasters: ['--msdf'] },
  // MSDF alongside Slug: the feature line needs an outline to stay legible over the icon field, and only the
  // distance field can carry one.
  'geist-medium': { input: 'fonts/geist-1.7.2/Geist-Medium.ttf', basicLatin: true },
  // The feature line is set in this face, so it carries the same configured MSDF field the app declares.
  'geist-mono-bold': {
    input: 'fonts/geist-1.7.2/GeistMono-Bold.ttf',
    basicLatin: true,
    rasters: ['--msdf', `em-size=${FEATURE_FIELD.emSize},pixel-range=${FEATURE_FIELD.pixelRange}`],
  },
  'geist-pixel-grid': { input: 'fonts/geist-1.7.2/GeistPixel-Grid.ttf', basicLatin: true },
  'source-serif': { input: `${fixtures}/source-serif-4.005/SourceSerif4-Regular.ttf`, basicLatin: true },
  'dancing-script': {
    input: `${fixtures}/dancing-script-3.000/DancingScript-Regular.otf`,
    basicLatin: true,
    subset: false,
  },
  dotgothic: { input: `${fixtures}/dot-gothic-16/DotGothic16-Regular.ttf`, basicLatin: true },
  amiri: { input: `${fixtures}/amiri-1.002/Amiri-Regular.ttf`, basicLatin: false },
  devanagari: { input: `${fixtures}/noto-sans-devanagari/NotoSansDevanagari.ttf`, basicLatin: false },
  cjk: { input: `${fixtures}/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf`, basicLatin: false, subset: false },
  // The origin scene's word faces, all bold and already cut by hb-subset to the exact characters it types. Baked
  // whole: they are kilobytes, and the CJK one cannot go through `--unicodes` at all (pmndrs/glyph#180).
  'noto-cjk-words': { input: 'fonts/word-faces/cjk-bold-words.otf', basicLatin: false, subset: false },
  'amiri-bold': { input: 'fonts/word-faces/amiri-bold-word.ttf', basicLatin: false, subset: false },
  'devanagari-bold': { input: 'fonts/word-faces/devanagari-bold-word.ttf', basicLatin: false, subset: false },
};

const check = process.argv.includes('--check');
const only = process.argv.find((argument) => argument.startsWith('--only='))?.slice('--only='.length);

for (const [face, bake] of Object.entries(FACES) as [FaceId, FaceBake][]) {
  if (only !== undefined && only !== face) continue;

  const source = ['--input', bake.input];

  if (bake.subset !== false) source.push('--unicodes', unicodeSet(codePointsFor(face, bake.basicLatin)));

  run(face, source, bake.rasters);
}

if (only === undefined || only === 'icons') {
  run('icons', [
    '--input',
    `${fixtures}/font-awesome-free-6.7.2/fa-solid-900.ttf`,
    '--unicodes',
    unicodeSet(new Set(Object.values(ICON_CODE_POINTS))),
    '--glyph-map',
    'assets/icons.map.json',
  ]);
}

if (only === undefined || only === 'stars') {
  run('stars', [
    '--input',
    'fonts/star-symbols/NotoSansSymbols2-Regular.ttf',
    '--unicodes',
    unicodeSet(new Set(STAR_SYMBOLS.map((symbol) => symbol.codePointAt(0)!))),
  ]);
}

function run(name: string, source: readonly string[], extra: readonly string[] = []): void {
  const argumentsList = ['bake', ...source, '--output', `assets/${name}.font.glb`, '--slug', ...extra, '--yes'];

  if (check) argumentsList.push('--check');

  console.log(`glyph ${argumentsList.join(' ')}`);
  execFileSync(glyph, argumentsList, { cwd: appRoot, stdio: 'inherit' });
}

function codePointsFor(face: FaceId, basicLatin: boolean): Set<number> {
  const codePoints = new Set<number>();

  if (basicLatin) for (let point = BASIC_LATIN.from; point <= BASIC_LATIN.to; point += 1) codePoints.add(point);

  const story = ORIGIN_STORY.map((text) => ({ text, face: ORIGIN_STORY_FACE }));
  const texts = [TITLE, HEADLINE, FEATURE_LINE, ORIGIN_TITLE, ...story, ...TITLE_WORDS, ...BACKGROUND_WORDS].filter(
    (entry) => entry.face === face,
  );

  for (const { text } of texts) for (const character of text ?? '') codePoints.add(character.codePointAt(0) ?? 0);

  codePoints.add(0x20);

  return codePoints;
}

/** Collapses code points into the CLI's `U+XXXX-YYYY,U+ZZZZ` set syntax. */
function unicodeSet(codePoints: ReadonlySet<number>): string {
  const sorted = [...codePoints].sort((left, right) => left - right);
  const ranges: string[] = [];

  for (let start = 0; start < sorted.length; ) {
    let end = start;

    while (end + 1 < sorted.length && sorted[end + 1] === (sorted[end] ?? 0) + 1) end += 1;

    const first = hex(sorted[start] ?? 0);
    ranges.push(end === start ? first : `${first}-${hex(sorted[end] ?? 0).slice(2)}`);
    start = end + 1;
  }

  return ranges.join(',');
}

function hex(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}
