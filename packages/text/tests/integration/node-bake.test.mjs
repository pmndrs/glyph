import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { bakeFont, bakeProject, NodeBakeError } from '@pmndrs/text/bake';
import { bitmapBaker } from '@pmndrs/text/bakers/bitmap';
import { validateBitmapArtifact } from '@pmndrs/text/bakers/bitmap/validate';
import { bitmapDescriptor, bitmapRasterKey } from '@pmndrs/text/raster/bitmap';
import { validateFontArtifact } from '@pmndrs/text-font-baker/validate';

import { runCli } from '../../dist/node/cli.js';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const goldenUrl = new URL('../fixtures/inter-bitmap-v0.json', import.meta.url);

test('bakeFont writes exact combined embedded and external artifacts with complete reports', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-text-node-bake-'));
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
        packaging: { artifact: 'embedded', pages: 'embedded' },
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
        packaging: { artifact: 'external', pages: 'external' },
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
    external.execution.outputs.map(({ role, bytes, sha256 }) => ({ role, bytes, sha256 })),
    golden.composed.external.artifacts.map(({ role, bytes, sha256 }) => ({ role, bytes, sha256 })),
  );
  assert.equal(external.transport.filter(({ artifactId }) => artifactId.endsWith('.ktx2')).length, 1);
  assert.ok((await readdir(join(root, 'external'))).every((name) => !name.endsWith('.tmp')));
});

test('bakeFont preserves bounded raster options through the Node composition path', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-text-node-coverage-'));
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
        packaging: { artifact: 'embedded', pages: 'embedded' },
        options,
      },
    ],
  });
  const bytes = new Uint8Array(await readFile(output));
  const core = await validateFontArtifact(bytes);
  const descriptor = bitmapDescriptor(options);
  const validated = await validateBitmapArtifact(bytes, {
    rasterKey: await bitmapRasterKey(options),
    shapingHash: core.shapingHash,
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
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-text-node-rollback-'));
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
        packaging: { artifact: 'external', pages: 'external' },
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
    (error) => error instanceof NodeBakeError && error.code === 'OUTPUT_TARGET_TYPE',
  );
  for (const [file, bytes] of previous) assert.deepEqual(await readFile(file), bytes);
  assert.equal(
    await readFile(join(join(dirname(output), basename(failedTarget.file)), 'keep.txt'), 'utf8'),
    'previous directory',
  );
  assert.ok((await readdir(dirname(output))).every((name) => !name.endsWith('.tmp') && !name.endsWith('.bak')));
});

test('bakeProject groups static definitions, imports only the resolved baker, and mirrors outputs', async (t) => {
  const root = await projectFixture(32);
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
    ['font', 'raster'],
  );
  const outputBytes = await readFile(output);
  assert.equal(hash(outputBytes), report.fonts[0].execution.outputs[0].sha256);
  const validated = await validateFontArtifact(outputBytes);
  assert.deepEqual(
    validated.document.extensions.PMNDRS_font.rasters.map(({ source }) => source.type),
    ['embedded', 'external'],
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
      import { defineFont } from '@pmndrs/text'
      import { bitmap } from '@fixture/raster'
      export const ttf = defineFont('/fonts/Inter-Regular.ttf', bitmap({ strikes: [16] }))
      export const otf = defineFont('/fonts/Inter-Regular.otf', bitmap({ strikes: [16] }))
    `,
  );

  await assert.rejects(
    bakeProject({ projectRoot: root, outputRoot: join(root, 'generated') }),
    (error) => error instanceof NodeBakeError && error.code === 'OUTPUT_CONFLICT',
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

test('pre-cancellation and source/output overlap fail before filesystem mutation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-text-node-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'font.ttf');
  await writeFile(input, await readFile(fontUrl));
  await assert.rejects(
    bakeFont({ input, output: input, font: { fontFaceIndex: 0 } }),
    (error) => error instanceof NodeBakeError && error.code === 'OUTPUT_OVERLAPS_INPUT',
  );
  const aliasedOutput = join(root, 'font.font.glb');
  await link(input, aliasedOutput);
  await assert.rejects(
    bakeFont({ input, output: aliasedOutput, font: { fontFaceIndex: 0 } }),
    (error) => error instanceof NodeBakeError && error.code === 'OUTPUT_OVERLAPS_INPUT',
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

test('rejects unsafe package-owned artifact IDs before writing any output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-text-node-unsafe-artifact-'));
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

  await assert.rejects(
    bakeFont({
      input,
      output,
      font: { fontFaceIndex: 0 },
      rasters: [
        {
          baker: unsafeBaker,
          packaging: { artifact: 'external', pages: 'embedded' },
          options: { strikes: [16] },
        },
      ],
    }),
    (error) => error instanceof NodeBakeError && error.code === 'UNSAFE_ARTIFACT_ID',
  );
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, '..', 'escape.glb')), { code: 'ENOENT' });
});

test('rejects a lying plugin descriptor before calling its baker or publishing output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-text-node-invalid-descriptor-'));
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
          packaging: { artifact: 'embedded', pages: 'embedded' },
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
  assert.match(help.stdout(), /^Usage: pmndrs-text-bake/);
  assert.equal(help.stderr(), '');

  const malformed = captureIo();
  assert.equal(await runCli(['--output-root'], malformed.io), 2);
  assert.equal(malformed.stdout(), '');
  assert.match(malformed.stderr(), /^--output-root requires a value/);
  assert.match(malformed.stderr(), /Usage: pmndrs-text-bake/);
});

async function projectFixture(secondStrike = 16, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-text-project-bake-'));
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
        pmndrs: { text: { bitmap: './bakers/bitmap' } },
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
        import { defineFont } from '@pmndrs/text'
        import { bitmap } from '@fixture/raster'
        const strikes = [16] as const
        export const first = defineFont('/fonts/Inter-Regular.ttf', bitmap({ strikes }))
        export const duplicate = defineFont('/fonts/Inter-Regular.ttf', bitmap({ strikes: [${secondStrike}] }))
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
