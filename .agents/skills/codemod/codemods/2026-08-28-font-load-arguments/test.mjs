import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCodemod } from '../../scripts/run-codemod.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'glyph-font-load-codemod-'));
try {
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }, include: ['app/**/*.ts'] }),
  );
  await writeFile(
    path.join(root, 'app/glyph.d.ts'),
    [
      "declare module '@pmndrs/glyph' {",
      '  export const bitmap: unknown;',
      '  export const msdf: unknown;',
      '  export type RasterTechniqueInput<T> = T | { technique: T; options?: unknown };',
      '  export function defineFont(input: unknown, raster: unknown): unknown;',
      '  export function loadFont(input: unknown, rasterOrOptions?: unknown, options?: unknown): Promise<unknown>;',
      '  export function createFontLibrary(): { loadFont(input: unknown, raster?: unknown, options?: unknown): Promise<unknown>; clear(input: unknown, raster?: unknown): void };',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'app/index.ts'),
    [
      "import { bitmap, createFontLibrary, defineFont, loadFont, msdf, type FontRequest } from '@pmndrs/glyph';",
      "const input = { baked: '/font.glb' };",
      'const raster = { technique: bitmap, options: { strikes: [16] } };',
      "const typedRaster: FontRequest<typeof bitmap>['raster'] = raster;",
      'const request = { input, raster };',
      'const library = createFontLibrary();',
      'loadFont({',
      '  input,',
      '  // Raster requirements remain attached to this argument.',
      '  raster,',
      '});',
      'loadFont({ input, rasters: [raster, { technique: msdf }] }, { signal: undefined });',
      'library.loadFont(request);',
      'library.clear(request);',
      'loadFont(defineFont(input, raster));',
      'const unrelated = {',
      '  loadFont(value: unknown) { return value; },',
      '  clear(value: unknown) { return value; },',
      '};',
      'unrelated.loadFont({ input, raster });',
      'unrelated.clear({ input, raster });',
      "const protocol = 'loadFont({ input, raster })';",
      '// loadFont({ input, raster }) migrates at the call, not in this comment.',
      'void [protocol, typedRaster];',
      '',
    ].join('\n'),
  );
  const source = path.join(root, 'app/index.ts');
  const before = await readFile(source, 'utf8');
  const recipe = path.resolve('.agents/skills/codemod/codemods/2026-08-28-font-load-arguments');
  const dry = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: false,
  });
  assert.deepEqual(dry.changedFiles, [source]);
  assert.equal(await readFile(source, 'utf8'), before);
  const applied = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.deepEqual(applied.changedFiles, [source]);
  const output = await readFile(source, 'utf8');
  assert.match(output, /loadFont\(input, \/\/ Raster requirements/);
  assert.match(output, /Raster requirements remain attached to this argument/);
  assert.match(output, /loadFont\(input, \[raster, \{ technique: msdf \}\], \{ signal: undefined \}\);/);
  assert.match(output, /library\.loadFont\(request\.input, request\.raster\);/);
  assert.match(output, /library\.clear\(request\.input, request\.raster\);/);
  assert.match(output, /unrelated\.loadFont\(\{ input, raster \}\);/);
  assert.match(output, /unrelated\.clear\(\{ input, raster \}\);/);
  assert.match(output, /RasterTechniqueInput<typeof bitmap>/);
  assert.doesNotMatch(output, /FontRequest/);
  assert.match(output, /loadFont\(defineFont\(input, raster\)\);/);
  assert.match(output, /'loadFont\(\{ input, raster \}\)'/);
  assert.match(output, /\/\/ loadFont\(\{ input, raster \}\) migrates/);
  const repeated = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.deepEqual(repeated.changedFiles, []);
} finally {
  await rm(root, { recursive: true, force: true });
}
