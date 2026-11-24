import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { bitmap, glyph, GlyphInputError } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';
import { runCli } from '../../dist/node/cli.js';
import { prepareRasterSource } from '../../dist/internal/raster-source-preparation.js';

const sourceSerifPath = fileURLToPath(
  new URL('../../../../benches/fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf', import.meta.url),
);
const ascii = ['--unicodes', 'U+0020-007E'];

/** Bakes Source Serif 4 through the CLI with `argv`, loads it, and returns its report and a shaper. */
async function bakeSourceSerif(t, name, argv, transform = (bytes) => bytes) {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-layout-features-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, `${name}.font.glb`);
  const bake = captureIo();
  assert.equal(
    await runCli(
      ['bake', '--input', sourceSerifPath, '--output', output, '--bitmap', '16', '--json', ...argv],
      bake.io,
    ),
    0,
    bake.stderr(),
  );
  await glyph.init();
  const font = await loadFont(
    { baked: { bytes: transform(new Uint8Array(await readFile(output))) } },
    bitmap({ strikes: [16] }),
  );
  const handle = glyph.handle(
    `three:integration:layout-features:${name}`,
    defineThreeConfig({ capacity: { size: 256, policy: 'grow' } }),
  );
  t.after(() => {
    handle.dispose();
    font.dispose();
  });
  const create = (text, style = {}) => {
    const paragraph = handle.createText({ font, text, style: { fontSize: 16, ...style } });
    t.after(() => paragraph.dispose());
    return paragraph;
  };
  const glyphIds = (text, features = []) => Array.from(create(text, { features }).glyphs().glyphIds);
  return { output, report: JSON.parse(bake.stdout()), stderr: bake.stderr(), create, glyphIds };
}

function assertNotBaked(action, tag, path) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof GlyphInputError, String(error));
    assert.deepEqual(error.path, path);
    assert.equal(
      error.message,
      `feature '${tag}' was not baked into Source Serif 4; bake with --layout-features ${tag} (layoutFeatures: ['${tag}'])`,
    );
    return true;
  });
}

test('a default bake keeps the common features and refuses text that enables a dropped one', async (t) => {
  for (const [name, argv] of [
    ['full', []],
    ['ascii', ascii],
  ]) {
    const { report, create, glyphIds } = await bakeSourceSerif(t, `default-${name}`, argv);
    for (const tag of ['smcp', 'c2sc', 'onum', 'tnum', 'pnum', 'zero', 'ss01']) {
      assert.ok(report.preparation.droppedLayoutFeatures.includes(tag), `${name} drops ${tag}`);
    }
    assertNotBaked(() => create('glyph', { features: [{ tag: 'liga' }, { tag: 'smcp' }] }), 'smcp', [
      'style',
      'features',
      1,
    ]);
    // Turned off, or never in the source (Source Serif has no `swsh`): silent, as in HarfBuzz.
    assert.deepEqual(glyphIds('glyph', [{ tag: 'smcp', value: 0 }]), glyphIds('glyph'));
    assert.deepEqual(glyphIds('glyph', [{ tag: 'swsh' }]), glyphIds('glyph'));
    // The common set is kept: `fi` forms its default ligature.
    assert.equal(glyphIds('fi').length, 1, `${name} keeps liga`);
  }
});

test('a full bake and a subset bake record the same dropped features', async (t) => {
  const full = await bakeSourceSerif(t, 'same-full', []);
  const subset = await bakeSourceSerif(t, 'same-ascii', ascii);
  assert.deepEqual(full.report.preparation.droppedLayoutFeatures, subset.report.preparation.droppedLayoutFeatures);
});

test('added features shape, and features outside the selection still throw', async (t) => {
  const { glyphIds, create } = await bakeSourceSerif(t, 'added', [...ascii, '--layout-features', 'smcp,+onum']);
  const letters = glyphIds('glyph');
  const smallCaps = glyphIds('glyph', [{ tag: 'smcp' }]);
  assert.ok(
    smallCaps.every((id, index) => id !== letters[index]),
    'smcp selects small capitals',
  );
  assert.notDeepEqual(glyphIds('1170', [{ tag: 'onum' }]), glyphIds('1170'), 'onum selects old-style figures');
  assertNotBaked(() => create('1170', { features: [{ tag: 'pnum' }] }), 'pnum', ['style', 'features', 0]);
});

test("'*' keeps every feature and '-tag' drops one from it", async (t) => {
  const every = await bakeSourceSerif(t, 'every', [...ascii, '--layout-features', '*']);
  assert.equal(every.report.preparation.droppedLayoutFeatures, undefined);
  const figures = every.glyphIds('1170');
  // Source Serif's default figures are tabular lining, so `pnum`, `onum` and `zero` each select alternates.
  for (const tag of ['pnum', 'onum', 'zero']) {
    assert.notDeepEqual(every.glyphIds('1170', [{ tag }]), figures, `${tag} selects alternate figures`);
  }

  const without = await bakeSourceSerif(t, 'every-but', [...ascii, '--layout-features', '*,-ss01,-ss02']);
  assert.deepEqual(without.report.preparation.droppedLayoutFeatures, ['ss01', 'ss02']);
  assert.notDeepEqual(without.glyphIds('glyph', [{ tag: 'smcp' }]), without.glyphIds('glyph'));
  assertNotBaked(() => without.create('glyph', { features: [{ tag: 'ss02' }] }), 'ss02', ['style', 'features', 0]);
});

test("'-liga' removes standard ligatures, and enabling liga then throws", async (t) => {
  const { glyphIds, create } = await bakeSourceSerif(t, 'no-liga', [...ascii, '--layout-features', '-liga']);
  assert.equal(glyphIds('fi').length, 2);
  assertNotBaked(() => create('fi', { features: [{ tag: 'liga' }] }), 'liga', ['style', 'features', 0]);
});

test('a span style and a later update are checked where they meet the font', async (t) => {
  const { create } = await bakeSourceSerif(t, 'span', ascii);
  assertNotBaked(
    () => create({ text: 'glyph', spans: [{ start: 0, end: 5, style: { features: [{ tag: 'smcp' }] } }] }),
    'smcp',
    ['text', 'spans', 0, 'style', 'features', 0],
  );
  const paragraph = create('glyph');
  const before = Array.from(paragraph.glyphs().glyphIds);
  assertNotBaked(() => paragraph.set({ style: { features: [{ tag: 'onum' }] } }), 'onum', ['style', 'features', 0]);
  assert.deepEqual(Array.from(paragraph.glyphs().glyphIds), before, 'the refused update left the text as it was');
});

test('an artifact that records no dropped features never throws', async (t) => {
  // Artifacts written before the record existed have no `layoutFeatures`; strip it to load one.
  const { glyphIds } = await bakeSourceSerif(t, 'old', ascii, withoutLayoutFeatures);
  assert.deepEqual(glyphIds('glyph', [{ tag: 'smcp' }]), glyphIds('glyph'));
});

test('a runtime raster rebuilds the prepared source from the original and the dropped list', async (t) => {
  const original = new Uint8Array(await readFile(sourceSerifPath));
  for (const [name, argv] of [
    ['default', []],
    ['every-but', ['--layout-features', '*,-ss01']],
    ['added', ['--layout-features', 'smcp,-liga']],
  ]) {
    const { report } = await bakeSourceSerif(t, `raster-source-${name}`, argv);
    const dropped = report.preparation.droppedLayoutFeatures ?? [];
    const prepared = await prepareRasterSource(original, 0, dropped, report.preparation.fingerprint);
    assert.ok(prepared !== undefined, `${name} reproduces the prepared source`);
  }
  assert.equal(await prepareRasterSource(original, 0, ['smcp'], '0'.repeat(32)), undefined);
});

test('the up-to-date check and --check compare the selection and the dropped list', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-layout-features-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'serif.font.glb');
  const argv = (...rest) => [
    'bake',
    '--input',
    sourceSerifPath,
    '--output',
    output,
    ...ascii,
    '--bitmap',
    '16',
    ...rest,
  ];
  assert.equal(await runCli(argv('--layout-features', '*'), captureIo().io), 0);
  const fresh = captureIo();
  assert.equal(await runCli(argv('--layout-features', '*'), fresh.io), 0);
  assert.match(fresh.stdout(), /is up to date/);
  assert.equal(await runCli(argv('--layout-features', '*', '--check'), captureIo().io), 0);

  // An ASCII subset never reaches Source Serif's Cyrillic `ss01`, so `*,-ss01` prepares the same bytes; only the
  // recorded dropped list differs, and that still makes the font stale.
  const stale = captureIo();
  assert.equal(await runCli(argv('--layout-features', '*,-ss01'), stale.io), 0);
  assert.doesNotMatch(stale.stdout(), /is up to date/);
  const check = captureIo();
  assert.equal(await runCli(argv('--layout-features', '*', '--check'), check.io), 1);
  assert.match(check.stderr(), /^STALE_OUTPUT:/);
});

test('--layout-features names the added tags the font does not have', async (t) => {
  const { report, stderr } = await bakeSourceSerif(t, 'missing', [...ascii, '--layout-features', 'swsh,smcp,zzzz']);
  assert.deepEqual(report.preparation.missingLayoutFeatures, ['swsh', 'zzzz']);
  assert.match(stderr, /does not have, ignored: swsh, zzzz/);
});

test('a default bake of a face too large to prepare keeps it as it is and says so', async (t) => {
  // Skera 0.5.1 cannot serialize the GSUB of Noto Sans CJK's whole BMP.
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-layout-features-cjk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = fileURLToPath(
    new URL('../../../../benches/fixtures/fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf', import.meta.url),
  );
  const report = await bakeFont({ input, output: join(root, 'cjk.font.glb'), font: { fontFaceIndex: 0 } });
  assert.equal(report.preparation, undefined);
  assert.deepEqual(
    report.warnings.map(({ code }) => code),
    ['LAYOUT_FEATURES_KEPT'],
  );
  // Asking for a selection is a request the bake cannot satisfy, so it fails instead.
  await assert.rejects(
    bakeFont({ input, output: join(root, 'cjk-star.font.glb'), font: { fontFaceIndex: 0 }, layoutFeatures: ['*'] }),
    { name: 'FontBakeError', reason: 'SUBSETTING_FAILED' },
  );
});

test('malformed, contradictory and shaping-floor selections are input errors', async (t) => {
  for (const [value, message] of [
    ['smcpx', /--layout-features token 0 must be '\*', or a four-character OpenType tag/],
    ['', /--layout-features token 0 must be/],
    ['smcp,', /--layout-features token 1 must be/],
    ['smcp,*', /--layout-features token 1: '\*' must be the first token/],
    ['smcp,-smcp', /--layout-features adds and removes 'smcp'/],
  ]) {
    const io = captureIo();
    assert.equal(
      await runCli(['bake', '--input', sourceSerifPath, '--layout-features', value, '--bitmap', '16'], io.io),
      2,
      value,
    );
    assert.match(io.stderr(), message);
  }
  const repeated = captureIo();
  assert.equal(
    await runCli(
      ['bake', '--input', sourceSerifPath, '--layout-features', 'smcp', '--layout-features', 'tnum', '--bitmap', '16'],
      repeated.io,
    ),
    2,
  );
  assert.match(repeated.stderr(), /may be provided only once/);

  await assert.rejects(
    bakeFont({
      input: sourceSerifPath,
      output: '/nonexistent/x.font.glb',
      font: { fontFaceIndex: 0 },
      layoutFeatures: ['smcp1'],
    }),
    { name: 'TypeError', message: /layoutFeatures token 0 must be/ },
  );
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-layout-features-floor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const floor = captureIo();
  assert.equal(
    await runCli(
      [
        'bake',
        '--input',
        sourceSerifPath,
        '--output',
        join(root, 'x.font.glb'),
        '--layout-features',
        '-mark',
        '--bitmap',
        '16',
      ],
      floor.io,
    ),
    1,
  );
  assert.match(floor.stderr(), /layout feature 'mark' is required for correct script shaping and cannot be removed/);
});

/** Rewrites a GLB's JSON chunk without `PMNDRS_font.layoutFeatures`, as an artifact from before the record. */
function withoutLayoutFeatures(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  assert.ok(document.extensions.PMNDRS_font.layoutFeatures !== undefined, 'the bake recorded dropped features');
  delete document.extensions.PMNDRS_font.layoutFeatures;
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedJson = Math.ceil(json.length / 4) * 4;
  const binary = bytes.subarray(20 + jsonLength);
  const output = new Uint8Array(20 + paddedJson + binary.length);
  const out = new DataView(output.buffer);
  output.set(bytes.subarray(0, 12));
  out.setUint32(8, output.length, true);
  out.setUint32(12, paddedJson, true);
  out.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + paddedJson);
  output.set(json, 20);
  output.set(binary, 20 + paddedJson);
  return output;
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
