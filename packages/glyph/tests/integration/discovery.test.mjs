import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { discoverProjectFonts } from '../../dist/discovery.js';

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-discovery-'));
  await Promise.all([
    mkdir(join(root, 'src'), { recursive: true }),
    mkdir(join(root, 'public', 'fonts'), { recursive: true }),
    mkdir(join(root, 'node_modules', '@pmndrs', 'glyph', 'bakers'), { recursive: true }),
    mkdir(join(root, 'node_modules', '@fixture', 'raster'), { recursive: true }),
  ]);
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2022',
        jsx: 'preserve',
        allowJs: true,
        checkJs: true,
        strict: true,
      },
      include: ['src'],
    }),
  );
  await writeFile(
    join(root, 'node_modules', '@pmndrs', 'glyph', 'package.json'),
    JSON.stringify({
      name: '@pmndrs/glyph',
      type: 'module',
      exports: {
        '.': { types: './index.d.ts', import: './index.js' },
        './bakers/bitmap': { import: './bakers/bitmap.js' },
        './bakers/msdf': { import: './bakers/msdf.js' },
        './bakers/slug': { import: './bakers/slug.js' },
        './package.json': './package.json',
      },
      pmndrs: {
        glyph: { bitmap: './bakers/bitmap', msdf: './bakers/msdf', slug: './bakers/slug' },
      },
    }),
  );
  await Promise.all([
    writeFile(
      join(root, 'node_modules', '@pmndrs', 'glyph', 'index.d.ts'),
      'export declare const glyph: { fontFace(source: unknown, config?: unknown): unknown }\n',
    ),
    writeFile(join(root, 'node_modules', '@pmndrs', 'glyph', 'index.js'), 'export const glyph = {}\n'),
    ...['bitmap', 'msdf', 'slug'].map((kind) =>
      writeFile(join(root, 'node_modules', '@pmndrs', 'glyph', 'bakers', `${kind}.js`), 'export {}\n'),
    ),
  ]);
  await writeFile(
    join(root, 'node_modules', '@fixture', 'raster', 'package.json'),
    JSON.stringify({
      name: '@fixture/raster',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': { types: './index.d.ts', import: './index.js' },
        './bakers/bitmap': { types: './index.d.ts', import: './baker.js' },
        './package.json': './package.json',
      },
      pmndrs: { glyph: { bitmap: './bakers/bitmap' } },
    }),
  );
  await writeFile(
    join(root, 'node_modules', '@fixture', 'raster', 'index.d.ts'),
    'export declare function bitmap(options: { strikes: readonly number[] }): unknown\n',
  );
  await writeFile(join(root, 'node_modules', '@fixture', 'raster', 'index.js'), 'export const bitmap = (x) => x\n');
  await writeFile(join(root, 'node_modules', '@fixture', 'raster', 'baker.js'), 'export {}\n');
  return root;
}

test('an omitted format discovers the default Bitmap, MSDF, and Slug bake set', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'public', 'fonts', 'Defaults.ttf'), 'font');
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { glyph } from '@pmndrs/glyph'
      glyph.fontFace('/fonts/Defaults.ttf')
    `,
  );

  const report = await discoverProjectFonts({ projectRoot: root });

  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(
    report.fonts.map(({ raster }) => [raster.kind, raster.options]),
    [
      ['bitmap', { strikes: [8, 16] }],
      ['msdf', {}],
      ['slug', {}],
    ],
  );
});

test('discovers glyph.fontFace and immutable raster options through TypeScript symbols', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const fontPath = join(root, 'public', 'fonts', 'Inter Regular.ttf');
  await writeFile(fontPath, 'font');
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { glyph as text } from '@pmndrs/glyph'
      import { bitmap as makeBitmap } from '@fixture/raster'
      declare function assetOrigin(): string
      const origin = assetOrigin()
      const strikes = [16, 32] as const
      export const prose = text.fontFace(
        \`\${origin}/fonts/Inter%20Regular.ttf?v=4#ignored\`,
        { format: makeBitmap({ strikes }) },
      )
      // glyph.fontFace('/fonts/not-real.ttf') must not be discovered from text.
    `,
  );

  const report = await discoverProjectFonts({ projectRoot: root });

  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.fonts.length, 1);
  assert.equal(report.fonts[0].resolvedFile, await realpath(fontPath));
  assert.equal(report.fonts[0].publicPathname, '/fonts/Inter Regular.ttf');
  assert.deepEqual(report.fonts[0].raster, {
    packageName: '@fixture/raster',
    kind: 'bitmap',
    specifier: '@fixture/raster/bakers/bitmap',
    resolvedFile: await realpath(join(root, 'node_modules', '@fixture', 'raster', 'baker.js')),
    options: { strikes: [16, 32] },
  });
});

test('discovers plain JavaScript and JSX with the same symbol and constant semantics', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const fontPath = join(root, 'public', 'fonts', 'JavaScript.ttf');
  const jsxFontPath = join(root, 'public', 'fonts', 'JavaScriptJsx.ttf');
  await Promise.all([
    writeFile(fontPath, 'font'),
    writeFile(jsxFontPath, 'font'),
    writeFile(
      join(root, 'src', 'main.js'),
      `
        import { glyph } from '@pmndrs/glyph'
        import { bitmap as makeBitmap } from '@fixture/raster'
        const source = '/fonts/JavaScript.ttf'
        const strikes = [16, 32]
        export const prose = glyph.fontFace(source, { format: makeBitmap({ strikes }) })
      `,
    ),
    writeFile(
      join(root, 'src', 'view.jsx'),
      `
        import { glyph } from '@pmndrs/glyph'
        import { bitmap } from '@fixture/raster'
        export const label = glyph.fontFace('/fonts/JavaScriptJsx.ttf', { format: bitmap({ strikes: [16] }) })
        export const Label = () => <span>{label ? 'ready' : 'pending'}</span>
      `,
    ),
  ]);

  const report = await discoverProjectFonts({ projectRoot: root });

  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.fonts.length, 2);
  assert.deepEqual(
    report.fonts.map(({ publicPathname, raster }) => [publicPathname, raster.options]),
    [
      ['/fonts/JavaScript.ttf', { strikes: [16, 32] }],
      ['/fonts/JavaScriptJsx.ttf', { strikes: [16] }],
    ],
  );
});

test('resolves new URL inputs relative to the declaring module', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src', 'fonts'), { recursive: true });
  const fontPath = join(root, 'src', 'fonts', 'Local.otf');
  await writeFile(fontPath, 'font');
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import * as text from '@pmndrs/glyph'
      import { bitmap } from '@fixture/raster'
      text.glyph.fontFace(new URL('./fonts/Local.otf', import.meta.url), { format: bitmap({ strikes: [16] }) })
    `,
  );

  const report = await discoverProjectFonts({ projectRoot: root, assetRoots: [join(root, 'src')] });

  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.fonts[0].resolvedFile, await realpath(fontPath));
  assert.equal(report.fonts[0].publicPathname, '/fonts/Local.otf');
});

test('follows imported constants and resolves literal, concatenated, and absolute URL sources', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const assetRoot = join(root, 'assets');
  await mkdir(join(assetRoot, 'fonts'), { recursive: true });
  await Promise.all([
    writeFile(join(assetRoot, 'fonts', 'Literal.ttf'), 'literal'),
    writeFile(join(assetRoot, 'fonts', 'Combined.ttf'), 'combined'),
    writeFile(join(assetRoot, 'fonts', 'Remote.ttf'), 'remote'),
  ]);
  await writeFile(join(root, 'src', 'paths.ts'), "export const moduleFont = '/fonts/Literal.ttf' as const\n");
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { glyph } from '@pmndrs/glyph'
      import { bitmap } from '@fixture/raster'
      import { moduleFont } from './paths.js'
      const directory = '/fonts/'
      const name = 'Combined'
      glyph.fontFace(moduleFont, { format: bitmap({ strikes: [16] }) })
      glyph.fontFace(directory + name + '.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace(new URL('https://cdn.example/fonts/Remote.ttf?v=4#ignored'), { format: bitmap({ strikes: [16] }) })
    `,
  );

  const report = await discoverProjectFonts({ projectRoot: root, assetRoots: [assetRoot] });

  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(report.fonts.map(({ publicPathname }) => publicPathname).sort(), [
    '/fonts/Combined.ttf',
    '/fonts/Literal.ttf',
    '/fonts/Remote.ttf',
  ]);
});

test('discovers single and array format requests and skips baked GLB inputs', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(join(root, 'public', 'fonts', 'Core.ttf'), 'core'),
    writeFile(join(root, 'public', 'fonts', 'Override.ttf'), 'override'),
  ]);
  await writeFile(
    join(root, 'src', 'main.tsx'),
    `
      import { glyph } from '@pmndrs/glyph'
      import { bitmap } from '@fixture/raster'
      glyph.fontFace('/fonts/Core.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace('/fonts/Override.ttf', { format: [bitmap({ strikes: [16, 32] })] })
      glyph.fontFace('/fonts/Already.font.glb', { format: bitmap({ strikes: [16] }) })
    `,
  );

  const report = await discoverProjectFonts({ projectRoot: root });

  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(report.fonts.map(({ publicPathname }) => publicPathname).sort(), [
    '/fonts/Core.ttf',
    '/fonts/Override.ttf',
  ]);
});

test('orders fonts and diagnostics by lexical source position despite concurrent analysis', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(join(root, 'public', 'fonts', 'Zeta.ttf'), 'font'),
    writeFile(join(root, 'public', 'fonts', 'Alpha.ttf'), 'font'),
    writeFile(join(root, 'public', 'fonts', 'Repeat.ttf'), 'font'),
  ]);
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { glyph } from '@pmndrs/glyph'
      import { bitmap } from '@fixture/raster'
      declare function dynamic(): string
      glyph.fontFace('/fonts/Zeta.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace('/fonts/Alpha.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace('/fonts/Repeat.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace('/fonts/Repeat.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace(dynamic(), { format: bitmap({ strikes: [16] }) })
      glyph.fontFace('/fonts/Missing.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace(dynamic(), { format: bitmap({ strikes: [16] }) })
    `,
  );

  const report = await discoverProjectFonts({ projectRoot: root });

  assert.deepEqual(
    report.fonts.map(({ publicPathname }) => publicPathname),
    ['/fonts/Zeta.ttf', '/fonts/Alpha.ttf', '/fonts/Repeat.ttf', '/fonts/Repeat.ttf'],
  );
  assert.deepEqual(
    report.diagnostics.map(({ code }) => code),
    ['dynamic-font-source', 'missing-font-source', 'dynamic-font-source'],
  );
});

test('reports ambiguity, unsafe paths, missing files, dynamic options, and dynamic sources', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const secondRoot = join(root, 'assets');
  await mkdir(join(secondRoot, 'fonts'), { recursive: true });
  await writeFile(join(root, 'public', 'fonts', 'Shared.ttf'), 'one');
  await writeFile(join(root, 'public', 'fonts', 'Unique.ttf'), 'unique');
  await writeFile(join(secondRoot, 'fonts', 'Shared.ttf'), 'two');
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { glyph } from '@pmndrs/glyph'
      import { bitmap } from '@fixture/raster'
      declare function source(): string
      declare function strikes(): number[]
      glyph.fontFace('/fonts/Shared.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace('/fonts/%2e%2e/secret.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace('/fonts/Missing.ttf', { format: bitmap({ strikes: [16] }) })
      glyph.fontFace('/fonts/Unique.ttf', { format: bitmap({ strikes: strikes() }) })
      glyph.fontFace(source(), { format: bitmap({ strikes: [16] }) })
    `,
  );

  const report = await discoverProjectFonts({
    projectRoot: root,
    assetRoots: [join(root, 'public'), secondRoot],
  });

  assert.deepEqual(report.diagnostics.map(({ code }) => code).sort(), [
    'ambiguous-font-source',
    'dynamic-font-source',
    'invalid-font-source',
    'invalid-raster-options',
    'missing-font-source',
  ]);
  assert.equal(report.fonts.length, 0);
});

test('rejects CommonJS and package-escaping raster baker manifests', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const commonjsRoot = join(root, 'node_modules', '@fixture', 'commonjs');
  const escapeRoot = join(root, 'node_modules', '@fixture', 'escape');
  await Promise.all([
    mkdir(commonjsRoot, { recursive: true }),
    mkdir(escapeRoot, { recursive: true }),
    writeFile(join(root, 'public', 'fonts', 'Valid.ttf'), 'font'),
  ]);
  await Promise.all([
    writeFile(
      join(commonjsRoot, 'package.json'),
      JSON.stringify({
        name: '@fixture/commonjs',
        exports: {
          '.': './index.cjs',
          './bakers/bitmap': { import: './baker.cjs' },
          './package.json': './package.json',
        },
        pmndrs: { glyph: { bitmap: './bakers/bitmap' } },
      }),
    ),
    writeFile(join(commonjsRoot, 'index.cjs'), 'exports.bitmap = (x) => x\n'),
    writeFile(join(commonjsRoot, 'baker.cjs'), 'module.exports = {}\n'),
    writeFile(
      join(escapeRoot, 'package.json'),
      JSON.stringify({
        name: '@fixture/escape',
        type: 'module',
        exports: {
          '.': './index.js',
          './bakers/bitmap': { import: '../outside.mjs' },
          './package.json': './package.json',
        },
        pmndrs: { glyph: { bitmap: './bakers/bitmap' } },
      }),
    ),
    writeFile(join(escapeRoot, 'index.js'), 'export const bitmap = (x) => x\n'),
    writeFile(join(root, 'node_modules', '@fixture', 'outside.mjs'), 'export {}\n'),
  ]);
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { glyph } from '@pmndrs/glyph'
      import { bitmap as commonjs } from '@fixture/commonjs'
      import { bitmap as escaping } from '@fixture/escape'
      glyph.fontFace('/fonts/Valid.ttf', { format: commonjs({ strikes: [16] }) })
      glyph.fontFace('/fonts/Valid.ttf', { format: escaping({ strikes: [16] }) })
    `,
  );

  const report = await discoverProjectFonts({ projectRoot: root });

  assert.equal(report.fonts.length, 0);
  assert.deepEqual(
    report.diagnostics.map(({ code }) => code),
    ['invalid-raster-manifest', 'invalid-raster-manifest'],
  );
  assert.match(report.diagnostics[0].message, /exported ESM subpath|outside its package/);
  assert.match(report.diagnostics[1].message, /exported ESM subpath|outside its package/);
});
