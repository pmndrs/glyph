/* @workflow {
  "name": "hero:bake",
  "summary": "Bake every Glyph Hero font subset to Slug, or verify them with --check.",
  "requirements": "Built Glyph package (the glyph CLI) and the benchmark font fixtures.",
  "writes": "apps/hero/assets/*.font.glb and apps/hero/assets/icons.map.json"
} */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { FEATURE_FIELD, FEATURE_LINE } from '../src/typography/utils/content.ts';
import { ICON_CODE_POINTS } from '../src/icon-field/utils/content.ts';
import { STAR_SYMBOLS } from '../src/black-hole/utils.ts';

run('geist-black', ['--input', 'fonts/geist-1.7.2/Geist-Black.ttf', '--unicodes', 'U+0020-007E'], ['--msdf']);
run(
  'geist-mono-bold',
  [
    '--input',
    'fonts/geist-1.7.2/GeistMono-Bold.ttf',
    '--unicodes',
    unicodeSet(
      new Set([
        ...Array.from({ length: 95 }, (_, index) => index + 0x20),
        ...Array.from(FEATURE_LINE, (character) => character.codePointAt(0)!),
      ]),
    ),
  ],
  ['--msdf', `em-size=${FEATURE_FIELD.emSize},pixel-range=${FEATURE_FIELD.pixelRange}`],
);
run('geist-pixel-grid', ['--input', 'fonts/geist-1.7.2/GeistPixel-Grid.ttf', '--unicodes', 'U+0020-007E']);
run('icons', [
  '--input',
  '../../benches/fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf',
  '--unicodes',
  unicodeSet(new Set(Object.values(ICON_CODE_POINTS))),
  '--glyph-map',
  'assets/icons.map.json',
]);
run('stars', [
  '--input',
  'fonts/star-symbols/NotoSansSymbols2-Regular.ttf',
  '--unicodes',
  unicodeSet(new Set(STAR_SYMBOLS.map((symbol) => symbol.codePointAt(0)!))),
]);

function run(name: string, source: readonly string[], extra: readonly string[] = []): void {
  const only = process.argv.find((argument) => argument.startsWith('--only='))?.slice('--only='.length);

  if (only !== undefined && only !== name) return;

  const argumentsList = ['bake', ...source, '--output', `assets/${name}.font.glb`, '--slug', ...extra, '--yes'];

  if (process.argv.includes('--check')) argumentsList.push('--check');

  console.log(`glyph ${argumentsList.join(' ')}`);
  execFileSync(fileURLToPath(new URL('../node_modules/.bin/glyph', import.meta.url)), argumentsList, {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
  });
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
