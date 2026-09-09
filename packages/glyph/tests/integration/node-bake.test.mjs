import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { bakeFont, bakeProject, NodeBakeError } from '@pmndrs/glyph/bake';
import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { validateBitmapArtifact } from '../../dist/bakers/bitmap-validator.js';
import { bitmapDescriptor, bitmapRasterKey } from '@pmndrs/glyph/raster/bitmap';
import { validateFontArtifact } from '@pmndrs/glyph/bake';

import { runCli } from '../../dist/node/cli.js';
import { fingerprint128, fingerprintDomain } from '../../dist/internal/fingerprint.js';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const iconFontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf',
  import.meta.url,
);
const goldenUrl = new URL('../fixtures/inter-bitmap-v0.json', import.meta.url);

test('bakeFont writes exact combined embedded and external artifacts with complete reports', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-node-bake-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const [source, goldenBytes] = await Promise.all([readFile(fontUrl), readFile(goldenUrl)]);
  const golden = JSON.parse(goldenBytes);
  const input = join(root, 'Inter-Regular.ttf');
  await writeFile(input, source);

  const embeddedOutput = join(root, 'embedded', 'Inter-Regular.font.glb');
  const embedded = await bakeFont({
    input,
    output: embeddedOutput,
    font: { fontFaceIndex: 0 },
    rasters: [
      {
        baker: bitmapBaker,
        packaging: { artifact: 'embedded' },
        options: { strikes: [16] },
      },
    ],
  });
  assert.equal(hash(await readFile(embeddedOutput)), golden.composed.embedded.artifacts[0].sha256);
  assert.deepEqual(
    embedded.containers.map(({ totalBytes }) => totalBytes),
    golden.composed.embedded.report.containers.map(({ totalBytes }) => totalBytes),
  );
  assert.ok(embedded.transport.some(({ format }) => format === 'gzip'));
  assert.ok(embedded.transport.some(({ format }) => format === 'brotli'));
  assert.ok(embedded.execution.timingsMs.total >= 0);
  assert.ok(
    Object.entries(embedded.execution.timingsMs)
      .filter(([phase]) => phase !== 'total')
      .reduce((total, [, duration]) => total + duration, 0) <= embedded.execution.timingsMs.total,
  );
  assert.ok(embedded.execution.memory.processMaxRssBytes > 0);

  const externalOutput = join(root, 'external', 'Inter-Regular.font.glb');
  const external = await bakeFont({
    input,
    output: externalOutput,
    font: { fontFaceIndex: 0 },
    rasters: [
      {
        baker: bitmapBaker,
        packaging: { artifact: 'external' },
        options: { strikes: [16] },
      },
    ],
  });
  for (const expected of golden.composed.external.artifacts) {
    const file = expected.role === 'font' ? externalOutput : join(root, 'external', expected.id);
    const bytes = await readFile(file);
    assert.equal(bytes.byteLength, expected.bytes);
    assert.equal(hash(bytes), expected.sha256);
  }
  assert.deepEqual(
    external.execution.outputs.map(({ role, bytes, fingerprint }) => ({ role, bytes, fingerprint })),
    golden.composed.external.artifacts.map(({ role, bytes, fingerprint }) => ({ role, bytes, fingerprint })),
  );
  // A split bake writes the core and one companion; no page is ever its own file.
  assert.equal(external.transport.filter(({ artifactId }) => artifactId.endsWith('.ktx2')).length, 0);
  assert.ok((await readdir(join(root, 'external'))).every((name) => !name.endsWith('.tmp')));
});

test('bakeFont preserves bounded raster options through the Node composition path', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-node-coverage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'Inter-Regular.ttf');
  const output = join(root, 'Inter-Regular.font.glb');
  await writeFile(input, await readFile(fontUrl));
  const options = { strikes: [16], coverage: { glyphIds: [43, 44] } };
  await bakeFont({
    input,
    output,
    font: { fontFaceIndex: 0 },
    rasters: [
      {
        baker: bitmapBaker,
        packaging: { artifact: 'embedded' },
        options,
      },
    ],
  });
  const bytes = new Uint8Array(await readFile(output));
  const core = await validateFontArtifact(bytes);
  const descriptor = bitmapDescriptor(options);
  const validated = await validateBitmapArtifact(bytes, {
    rasterKey: bitmapRasterKey(options),
    sourceFingerprint: core.sourceFingerprint,
    shapingFingerprint: core.shapingFingerprint,
    glyphCount: core.glyphCount,
    glyphIdWidth: 16,
    descriptor,
  });
  assert.equal(
    validated.coverage.reduce((count, byte) => count + byte.toString(2).replaceAll('0', '').length, 0),
    2,
  );
});

test('rolls back every earlier artifact when a later publication fails', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-node-rollback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'Inter-Regular.ttf');
  await writeFile(input, await readFile(fontUrl));
  const referenceOutput = join(root, 'reference', 'Inter-Regular.font.glb');
  const bakeOptions = {
    input,
    font: { fontFaceIndex: 0 },
    rasters: [
      {
        baker: bitmapBaker,
        packaging: { artifact: 'external' },
        options: { strikes: [16] },
      },
    ],
  };
  const reference = await bakeFont({ ...bakeOptions, output: referenceOutput });
  const output = join(root, 'rollback', 'Inter-Regular.font.glb');
  const previous = new Map();
  const failedTarget = reference.execution.outputs.at(-1);
  assert.ok(failedTarget);

  for (const entry of reference.execution.outputs) {
    const file = entry.role === 'font' ? output : join(dirname(output), basename(entry.file));
    if (entry === failedTarget) {
      await mkdir(file, { recursive: true });
      await writeFile(join(file, 'keep.txt'), 'previous directory');
    } else {
      const bytes = Buffer.from(`previous ${entry.role}`);
      previous.set(file, bytes);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
  }

  await assert.rejects(
    bakeFont({ ...bakeOptions, output }),
    (error) => error instanceof NodeBakeError && error.reason === 'OUTPUT_TARGET_TYPE',
  );
  for (const [file, bytes] of previous) assert.deepEqual(await readFile(file), bytes);
  assert.equal(
    await readFile(join(join(dirname(output), basename(failedTarget.file)), 'keep.txt'), 'utf8'),
    'previous directory',
  );
  assert.ok((await readdir(dirname(output))).every((name) => !name.endsWith('.tmp') && !name.endsWith('.bak')));
});

test('bakeProject rejects one font declaring the same technique twice', async (t) => {
  const root = await projectFixture(32);
  t.after(() => rm(root, { recursive: true, force: true }));
  // Two strike sets belong to one raster's options, not to two rasters of one technique.
  await assert.rejects(
    bakeProject({ projectRoot: root, outputRoot: join(root, 'generated') }),
    (error) => error instanceof NodeBakeError && error.reason === 'RASTER_EXTENSION_DUPLICATE',
  );
});

test('bakeProject groups static definitions, imports only the resolved baker, and mirrors outputs', async (t) => {
  const root = await projectFixture(16);
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRoot = join(root, 'generated');
  const report = await bakeProject({ projectRoot: root, outputRoot });
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.fonts.length, 1);
  assert.equal(report.mappings.length, 2);
  const output = join(outputRoot, 'fonts', 'Inter-Regular.font.glb');
  assert.ok(report.mappings.every(({ outputFile }) => outputFile === output));
  assert.deepEqual(
    report.fonts[0].execution.outputs.map(({ role }) => role),
    ['font'],
  );
  const outputBytes = await readFile(output);
  assert.equal(
    report.fonts[0].execution.outputs[0].fingerprint,
    fingerprint128(outputBytes, fingerprintDomain.artifact),
  );
  const validated = await validateFontArtifact(outputBytes);
  // Two declarations of one font with identical options resolve to a single embedded raster.
  assert.deepEqual(
    validated.document.extensions.PMNDRS_font.rasters.map(({ source }) => source.type),
    ['embedded'],
  );

  const repeated = await bakeProject({ projectRoot: root, outputRoot });
  assert.deepEqual(await readFile(output), outputBytes);
  assert.deepEqual(repeated.mappings, report.mappings);
  assert.deepEqual(repeated.diagnostics, report.diagnostics);
  assert.deepEqual(repeated.fonts[0].execution.outputs, report.fonts[0].execution.outputs);
});

test('bakeProject resolves each plugin descriptor once before ordering and baking', async (t) => {
  const root = await projectFixture(16, { rejectRepeatedDescriptor: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const report = await bakeProject({ projectRoot: root, outputRoot: join(root, 'generated') });
  assert.equal(report.fonts.length, 1);
  assert.deepEqual(report.diagnostics, []);
});

test('bakeProject rejects distinct sources that resolve to one output before baking', async (t) => {
  const root = await projectFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const fonts = join(root, 'public', 'fonts');
  await writeFile(join(fonts, 'Inter-Regular.otf'), await readFile(fontUrl));
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { glyph } from '@pmndrs/glyph'
      import { bitmap } from '@fixture/raster'
      export const ttf = glyph.fontFace('/fonts/Inter-Regular.ttf', { format: bitmap({ strikes: [16] }) })
      export const otf = glyph.fontFace('/fonts/Inter-Regular.otf', { format: bitmap({ strikes: [16] }) })
    `,
  );

  await assert.rejects(
    bakeProject({ projectRoot: root, outputRoot: join(root, 'generated') }),
    (error) => error instanceof NodeBakeError && error.reason === 'OUTPUT_CONFLICT',
  );
  await assert.rejects(readFile(join(root, 'generated', 'fonts', 'Inter-Regular.font.glb')), {
    code: 'ENOENT',
  });
});

test('the installed CLI is a thin JSON-reporting layer over bakeProject', async (t) => {
  const root = await projectFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = new URL('../../dist/node/cli.js', import.meta.url);
  const result = await run(process.execPath, [
    cli.pathname,
    'bake',
    '--project-root',
    root,
    '--output-root',
    join(root, 'cli-output'),
    '--json',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.fonts.length, 1);
  assert.equal(report.mappings.length, 2);
  assert.deepEqual(report.diagnostics, []);
});

test('the CLI directly bakes and checks one known font from arguments', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-direct-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'Inter-Regular.ttf');
  const output = join(root, 'Inter.font.glb');
  const source = await readFile(fontUrl);
  await writeFile(input, source);

  const bake = captureIo();
  assert.equal(
    await runCli(['bake', '--input', input, '--output', output, '--bitmap', '16', '--json'], bake.io),
    0,
    bake.stderr(),
  );
  const report = JSON.parse(bake.stdout());
  assert.equal(report.rasters.length, 1);
  assert.equal((await validateFontArtifact(await readFile(output))).document.extensions.PMNDRS_font.rasters.length, 1);

  const check = captureIo();
  assert.equal(
    await runCli(['bake', '--input', input, '--output', output, '--bitmap', '16', '--check'], check.io),
    0,
    check.stderr(),
  );

  const subsetOutput = join(root, 'Inter-latin.font.glb');
  const subset = captureIo();
  assert.equal(
    await runCli(
      [
        'bake',
        '--input',
        input,
        '--output',
        subsetOutput,
        '--unicodes',
        'U+0061-007A,U+0020,U+0041-005A,U+0041',
        '--json',
      ],
      subset.io,
    ),
    0,
    subset.stderr(),
  );
  const subsetReport = JSON.parse(subset.stdout());
  assert.equal(subsetReport.preparation.sourceBytes, source.byteLength);
  assert.ok(subsetReport.preparation.preparedBytes < subsetReport.preparation.sourceBytes);
  assert.ok(subsetReport.preparation.glyphCount < (await validateFontArtifact(await readFile(output))).glyphCount);
  assert.equal(
    (await validateFontArtifact(await readFile(subsetOutput))).glyphCount,
    subsetReport.preparation.glyphCount,
  );
});

test('direct bake writes and checks a glyph-name lookup for its selected Unicode set', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-map-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'fa-solid-900.ttf');
  const output = join(root, 'icons.font.glb');
  const glyphMap = join(root, 'icons.json');
  await writeFile(input, await readFile(iconFontUrl));

  const bake = captureIo();
  assert.equal(
    await runCli(
      ['bake', '--input', input, '--output', output, '--unicodes', 'U+F0AC,U+F57D', '--glyph-map', glyphMap, '--json'],
      bake.io,
    ),
    0,
    bake.stderr(),
  );
  assert.deepEqual(JSON.parse(await readFile(glyphMap, 'utf8')), {
    'earth-americas': 0xf57d,
    globe: 0xf0ac,
  });
  assert.equal(JSON.parse(bake.stdout()).execution.outputs[0].file, output);

  const check = captureIo();
  assert.equal(
    await runCli(
      ['bake', '--input', input, '--output', output, '--unicodes', 'U+F0AC,U+F57D', '--glyph-map', glyphMap, '--check'],
      check.io,
    ),
    0,
    check.stderr(),
  );

  await writeFile(glyphMap, '{}\n');
  const stale = captureIo();
  assert.equal(
    await runCli(
      ['bake', '--input', input, '--output', output, '--unicodes', 'U+F0AC,U+F57D', '--glyph-map', glyphMap, '--check'],
      stale.io,
    ),
    1,
  );
  assert.match(stale.stderr(), /^STALE_GLYPH_MAP:/);
  assert.equal(await readFile(glyphMap, 'utf8'), '{}\n');
});

test('glyph-map aliases fail before either direct bake output is published', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-map-alias-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'fa-solid-900.ttf');
  const output = join(root, 'icons.font.glb');
  const glyphMap = join(root, 'icons.json');
  await writeFile(input, await readFile(iconFontUrl));

  const ambiguous = captureIo();
  assert.equal(
    await runCli(
      ['bake', '--input', input, '--output', output, '--unicodes', 'U+F0AC,U+1F310', '--glyph-map', glyphMap],
      ambiguous.io,
    ),
    1,
  );
  assert.match(ambiguous.stderr(), /^AMBIGUOUS_GLYPH_NAME:/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  await assert.rejects(readFile(glyphMap), { code: 'ENOENT' });
});

test('pre-cancellation and source/output overlap fail before filesystem mutation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-node-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'font.ttf');
  await writeFile(input, await readFile(fontUrl));
  await assert.rejects(
    bakeFont({ input, output: input, font: { fontFaceIndex: 0 } }),
    (error) => error instanceof NodeBakeError && error.reason === 'OUTPUT_OVERLAPS_INPUT',
  );
  const aliasedOutput = join(root, 'font.font.glb');
  await link(input, aliasedOutput);
  await assert.rejects(
    bakeFont({ input, output: aliasedOutput, font: { fontFaceIndex: 0 } }),
    (error) => error instanceof NodeBakeError && error.reason === 'OUTPUT_OVERLAPS_INPUT',
  );

  const controller = new AbortController();
  controller.abort(new Error('fixture cancellation'));
  const output = join(root, 'never.font.glb');
  await assert.rejects(
    bakeFont({ input, output, font: { fontFaceIndex: 0 }, signal: controller.signal }),
    /fixture cancellation/,
  );
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('a companion is named from its core font, so a package-owned ID never reaches disk', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-node-unsafe-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'font.ttf');
  const output = join(root, 'font.glb');
  await writeFile(input, await readFile(fontUrl));
  const unsafeBaker = {
    ...bitmapBaker,
    async bake(request) {
      const result = await bitmapBaker.bake(request);
      return {
        ...result,
        artifacts: result.artifacts.map((artifact) =>
          artifact.role === 'raster' ? { ...artifact, id: '../escape.glb' } : artifact,
        ),
      };
    },
  };

  // The package no longer names the file, so its ID is ignored rather than sanitized.
  await bakeFont({
    input,
    output,
    font: { fontFaceIndex: 0 },
    rasters: [{ baker: unsafeBaker, packaging: { artifact: 'external' }, options: { strikes: [16] } }],
  });
  await readFile(join(root, 'font.bitmap.glb'));
  await assert.rejects(readFile(join(root, '..', 'escape.glb')), { code: 'ENOENT' });
});

test('rejects a lying plugin descriptor before calling its baker or publishing output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-node-invalid-descriptor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'font.glb');
  let bakeCalled = false;
  const invalidBaker = {
    ...bitmapBaker,
    descriptor: () => new Date(0),
    async bake(request) {
      bakeCalled = true;
      return bitmapBaker.bake(request);
    },
  };

  await assert.rejects(
    bakeFont({
      input: fontUrl,
      output,
      font: { fontFaceIndex: 0 },
      rasters: [
        {
          baker: invalidBaker,
          packaging: { artifact: 'embedded' },
          options: { strikes: [16] },
        },
      ],
    }),
    /plain JSON objects/,
  );
  assert.equal(bakeCalled, false);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('CLI help and malformed arguments are deterministic and side-effect free', async () => {
  const help = captureIo();
  assert.equal(await runCli(['--help'], help.io), 0);
  assert.match(help.stdout(), /^Usage: glyph <command>/);
  assert.match(help.stdout(), /glyph <command> --help/);
  assert.equal(help.stderr(), '');

  const bakeHelp = captureIo();
  assert.equal(await runCli(['bake', '--help'], bakeHelp.io), 0);
  assert.match(bakeHelp.stdout(), /^Usage:\n  glyph bake/);
  assert.match(bakeHelp.stdout(), /U\+0020-007E,U\+00A0-00FF,U\+4E00-9FFF/);
  assert.match(bakeHelp.stdout(), /Selects code points, not raw glyph IDs/);
  assert.doesNotMatch(bakeHelp.stdout(), /HarfBuzz|hb-subset/);

  const glyphHelp = captureIo();
  assert.equal(await runCli(['glyphs', '--help'], glyphHelp.io), 0);
  assert.match(glyphHelp.stdout(), /^Usage: glyph glyphs <font>/);
  assert.match(glyphHelp.stdout(), /glyph names retained in its post or/);

  const version = captureIo();
  assert.equal(await runCli(['--version'], version.io), 0);
  assert.match(version.stdout(), /^@pmndrs\/glyph \d+\.\d+\.\d+\n$/);

  const malformed = captureIo();
  assert.equal(await runCli(['bake', '--output-root'], malformed.io), 2);
  assert.equal(malformed.stdout(), '');
  assert.match(malformed.stderr(), /^--output-root requires a value/);
  assert.match(malformed.stderr(), /Usage:\n  glyph bake/);

  const unknown = captureIo();
  assert.equal(await runCli(['inspect'], unknown.io), 2);
  assert.equal(unknown.stdout(), '');
  assert.match(unknown.stderr(), /^Unknown command: inspect/);
  assert.match(unknown.stderr(), /Usage: glyph <command>/);
});

test('the CLI surfaces font-provided icon names as JSON and reusable Unicode sets', async () => {
  const json = captureIo();
  assert.equal(await runCli(['glyphs', fileURLToPath(iconFontUrl), '--name', 'globe', '--json'], json.io), 0);
  assert.deepEqual(JSON.parse(json.stdout()).glyphs, [
    { unicode: 'U+F0AC', codePoint: 0xf0ac, glyphId: 537, name: 'globe' },
    { unicode: 'U+1F310', codePoint: 0x1f310, glyphId: 537, name: 'globe' },
  ]);

  const unicodeSet = captureIo();
  assert.equal(
    await runCli(
      ['glyphs', fileURLToPath(iconFontUrl), '--name', 'globe', '--name', 'earth-americas', '--unicode-set'],
      unicodeSet.io,
    ),
    0,
  );
  assert.equal(unicodeSet.stdout(), 'U+F0AC,U+F57D,U+1F30E,U+1F310\n');
});

async function projectFixture(secondStrike = 16, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-project-bake-'));
  const packageRoot = join(root, 'node_modules', '@fixture', 'raster');
  await Promise.all([
    mkdir(join(root, 'src'), { recursive: true }),
    mkdir(join(root, 'public', 'fonts'), { recursive: true }),
    mkdir(packageRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, 'public', 'fonts', 'Inter-Regular.ttf'), await readFile(fontUrl)),
    writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          target: 'es2022',
          strict: true,
        },
        include: ['src'],
      }),
    ),
    writeFile(
      join(packageRoot, 'package.json'),
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
    ),
    writeFile(
      join(packageRoot, 'index.d.ts'),
      'export declare function bitmap(options: { strikes: readonly number[] }): unknown\n',
    ),
    writeFile(join(packageRoot, 'index.js'), 'export const bitmap = (options) => options\n'),
    writeFile(
      join(packageRoot, 'baker.js'),
      options.rejectRepeatedDescriptor
        ? `
          import bitmapBaker from ${JSON.stringify(pathToFileURL(await realpath(new URL('../../dist/bakers/bitmap.js', import.meta.url))).href)}
          let descriptorCalls = 0
          export default {
            ...bitmapBaker,
            descriptor(value) {
              descriptorCalls += 1
              if (descriptorCalls > 1) throw new Error('descriptor evaluated more than once')
              return bitmapBaker.descriptor(value)
            },
          }
        `
        : `export { default } from ${JSON.stringify(pathToFileURL(await realpath(new URL('../../dist/bakers/bitmap.js', import.meta.url))).href)}\n`,
    ),
    writeFile(
      join(root, 'src', 'main.ts'),
      `
        import { glyph } from '@pmndrs/glyph'
        import { bitmap } from '@fixture/raster'
        const strikes = [16] as const
        export const first = glyph.fontFace('/fonts/Inter-Regular.ttf', { format: bitmap({ strikes }) })
        export const duplicate = glyph.fontFace('/fonts/Inter-Regular.ttf', { format: bitmap({ strikes: [${secondStrike}] }) })
      `,
    ),
  ]);
  return root;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function captureIo() {
  const output = [];
  const errors = [];
  return {
    io: {
      stdout: { write: (value) => output.push(value) },
      stderr: { write: (value) => errors.push(value) },
    },
    stdout: () => output.join(''),
    stderr: () => errors.join(''),
  };
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

test('a bake is skipped only when the artifact on disk is the whole result the request asks for', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-freshness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'Inter-Regular.ttf');
  await writeFile(input, await readFile(fontUrl));
  const output = join(root, 'Inter.font.glb');
  const rasterCount = async () =>
    (await validateFontArtifact(await readFile(output))).document.extensions.PMNDRS_font.rasters.length;
  const bake = async (argv) => {
    const io = captureIo();
    assert.equal(await runCli(['bake', '--input', input, '--output', output, ...argv], io.io), 0, io.stderr());
    return io.stdout();
  };

  await bake(['--bitmap', '16']);
  assert.match(await bake(['--bitmap', '16']), /is up to date/);

  // Packaging decides which files a bake writes, so a split request is not satisfied by a packed
  // font even though every raster in it is compatible.
  assert.doesNotMatch(await bake(['--bitmap', '16', '--split']), /is up to date/);
  assert.equal(
    (await validateFontArtifact(await readFile(output))).document.extensions.PMNDRS_font.rasters[0].source.type,
    'external',
  );
  await readFile(join(root, 'Inter.bitmap.glb'));

  // A bake publishes the whole font, so an extra raster on disk means the request would remove it.
  // Comparing the requested rasters as a subset would make a font impossible to shrink.
  await bake(['--bitmap', '16', '--msdf', '--force']);
  assert.equal(await rasterCount(), 2);
  assert.doesNotMatch(await bake(['--bitmap', '16']), /is up to date/);
  assert.equal(await rasterCount(), 1);
});
