/* @workflow {
  "name": "hero:bake",
  "summary": "Bake every Glyph Hero font subset to Slug, or verify them with --check.",
  "requirements": "Built Glyph package (the glyph CLI) and the benchmark font fixtures.",
  "writes": "apps/hero/assets/*.font.glb"
} */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BODY,
  HEADLINE,
  KICKER,
  PULL_CREDIT,
  PULL_QUOTE,
  SIDEBAR_TITLE,
  SPECIMENS,
  STANDFIRST,
  TYPED_LINE,
} from '../src/page/content.ts';

const FIXTURES = '../../benches/fixtures/fonts';
const ASCII = Array.from({ length: 95 }, (_, index) => String.fromCodePoint(index + 0x20)).join('');
const specimen = (script: string) =>
  SPECIMENS.filter((entry) => entry.script === script)
    .map(({ text }) => text)
    .join('');

// The essay's serif carries outlines: its glyphs become rigid bodies, and one of them is drawn as curves.
run(
  'source-serif',
  `${FIXTURES}/source-serif-4.005/SourceSerif4-Regular.ttf`,
  // Latin-1 and general punctuation ride along so a visitor may type more than the essay uses.
  ASCII + range(0xa0, 0xff) + range(0x2010, 0x2026) + BODY + STANDFIRST + PULL_QUOTE + TYPED_LINE + specimen('latin'),
  ['--outlines'],
);
run('geist-black', 'fonts/geist-1.7.2/Geist-Black.ttf', ASCII + HEADLINE, ['--outlines']);
run(
  'geist-mono-bold',
  'fonts/geist-1.7.2/GeistMono-Bold.ttf',
  `${ASCII}·${KICKER}${PULL_CREDIT}${SIDEBAR_TITLE}${SPECIMENS.map(({ label }) => label).join('')}`,
);
// Only the specimens' own characters: a face's whole block, with every joining form and conjunct, is megabytes.
run(
  'amiri',
  `${FIXTURES}/amiri-1.002/Amiri-Regular.ttf`,
  // The Arabic word inside the Latin specimen is Amiri's too.
  ` ${specimen('arabic')}${specimen('latin').replaceAll(/\P{Script=Arabic}/gu, '')}`,
);
run('noto-devanagari', `${FIXTURES}/noto-sans-devanagari/NotoSansDevanagari.ttf`, ` ${specimen('devanagari')}`);
run('noto-thai', 'fonts/noto-sans-thai/NotoSansThai-Regular.ttf', ` ${specimen('thai')}`);
// The showcase subset, whole: `--unicodes` on a CID-keyed CFF face leaves the bake no outline table to convert.
run('noto-japanese', `${FIXTURES}/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf`, undefined);

function run(name: string, input: string, characters: string | undefined, extra: readonly string[] = []): void {
  const only = process.argv.find((argument) => argument.startsWith('--only='))?.slice('--only='.length);

  if (only !== undefined && only !== name) return;

  const codePoints = new Set(Array.from(characters ?? '', (character) => character.codePointAt(0)!));
  codePoints.delete(0x0a);
  const argumentsList = [
    'bake',
    '--input',
    input,
    ...(characters === undefined ? [] : ['--unicodes', unicodeSet(codePoints)]),
    '--output',
    `assets/${name}.font.glb`,
    '--slug',
    ...extra,
    '--yes',
  ];

  if (process.argv.includes('--check')) argumentsList.push('--check');

  console.log(`glyph ${argumentsList.join(' ')}`);
  execFileSync(fileURLToPath(new URL('../node_modules/.bin/glyph', import.meta.url)), argumentsList, {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
  });
}

function range(first: number, last: number): string {
  return Array.from({ length: last - first + 1 }, (_, index) => String.fromCodePoint(first + index)).join('');
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
