/* @workflow {
  "name": "cameo:bake",
  "summary": "Bake the cameo's face and icon font subsets to Slug, or verify them with --check.",
  "requirements": "Built Glyph package (the glyph CLI) and the benchmark font fixtures.",
  "writes": "apps/cameo/assets/*.font.glb and apps/cameo/assets/icons.map.json"
} */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ICON_CODE_POINTS } from '../src/icon-field/content.ts';
import { CARDS } from '../src/robot/content.ts';

run('geist-pixel-grid', [
  '--input',
  'fonts/geist-1.7.2/GeistPixel-Grid.ttf',
  '--unicodes',
  unicodeSet(new Set(CARDS.flatMap((card) => Array.from(card.text, (character) => character.codePointAt(0)!)))),
]);
run('icons', [
  '--input',
  '../../benches/fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf',
  '--unicodes',
  unicodeSet(new Set(Object.values(ICON_CODE_POINTS))),
  '--glyph-map',
  'assets/icons.map.json',
]);

function run(name: string, source: readonly string[]): void {
  const argumentsList = ['bake', ...source, '--output', `assets/${name}.font.glb`, '--slug', '--yes'];

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
