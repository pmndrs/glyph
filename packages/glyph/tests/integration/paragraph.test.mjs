import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import { createParagraph, loadFont, txt } from '@pmndrs/glyph';
import { techniqueProgram } from '@pmndrs/glyph/config/codec-program';
import { defineRasterFormat, defineRasterResourceId } from '@pmndrs/glyph/config/raster-format';
import { registerRasterPlanProgram } from '@pmndrs/glyph/config/raster';
import { defineTechniqueSchema } from '@pmndrs/glyph/config/schema';
import { bitmap } from '@pmndrs/glyph/three/bitmap';

import {
  createImmutableFontLease,
  createImmutableFontVariant,
  immutableFontVariantIdentity,
} from '../../dist/loaded-font.js';
import { paragraphMeasurementServiceReport } from '../../dist/paragraph.js';
import { createThreeTestHandle } from '../support/three-handle.mjs';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

const TEXT = 'The quick brown fox jumps over the lazy dog';
const PORTABLE_RESOURCE = defineRasterResourceId('test.paragraph.portable-resource');
const portableTechnique = defineRasterFormat({
  id: 'test.paragraph.portable-technique',
  kind: 'test',
  extension: 'TEST_paragraph_portable',
  version: 0,
  textEffects: [],
  descriptor: () => ({}),
  async decode() {
    return {};
  },
  dispose() {},
});
const portableSchema = defineTechniqueSchema({
  technique: portableTechnique.id,
  scope: 'glyph',
  binding: {},
  buffers: {},
  resources: { payload: { kind: 'buffer' } },
  render: { resource: 'payload', geometry: { kind: 'synthetic-quad' } },
});
let portableCompileCalls = 0;
registerRasterPlanProgram({
  raster: portableTechnique,
  schema: portableSchema,
  codecBody(system) {
    const program = techniqueProgram(portableSchema, { system });
    return program.compile({});
  },
  compileFont(compiler) {
    portableCompileCalls += 1;
    compiler.retain('payload', PORTABLE_RESOURCE, {
      kind: 'buffer',
      bytes: new Uint8Array([1, 2, 3, 4]),
      stride: 4,
    });
    return compiler.compile({ strikes: [0], resource: () => PORTABLE_RESOURCE });
  },
});

async function bootstrap() {
  const font = await loadFont(
    { baked: { bytes: await readFile(fontUrl) } },
    { raster: bitmap, options: { strikes: [16] } },
  );
  return {
    font,
    async [Symbol.asyncDispose]() {
      font.dispose();
    },
  };
}

const CONSTRAINTS = [
  undefined,
  { width: { mode: 'at-most', size: 360 }, height: { mode: 'at-most', size: 90 } },
  { width: { mode: 'exact', size: 420.001 } },
  { width: { mode: 'at-most', size: 120 } },
];

/**
 * Differential oracle: every value the framework-neutral Paragraph publishes must be
 * byte-identical to the same value obtained through the Three.js Text scene-graph commit,
 * which was the only measurement route before this API existed.
 */
test('Paragraph.measure agrees byte-for-byte with the Three.js Text measurement route', async (t) => {
  const three = await createThreeTestHandle(t);
  await using boot = await bootstrap();
  const scene = new THREE.Scene();
  const text = three.createText({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  scene.add(text);
  try {
    const paragraph = await createParagraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
    for (const constraints of CONSTRAINTS) {
      const result = paragraph.measure(constraints);
      text.constraints = constraints ?? {};
      scene.updateMatrixWorld(true);
      if (text.error !== undefined) throw text.error;
      const expected = text.measure();
      assert.ok(expected !== undefined, 'the Text route must publish a committed measurement');
      assert.deepEqual(projectMeasurement(result), projectMeasurement(expected));
    }
    paragraph.dispose();
  } finally {
    text.dispose();
  }
});

test('glyphs() positioned columns agree byte-for-byte with the Three.js Text inspection route', async (t) => {
  const three = await createThreeTestHandle(t);
  await using boot = await bootstrap();
  const scene = new THREE.Scene();
  const box = { width: { mode: 'exact', size: 300 }, height: { mode: 'at-most', size: 200 } };
  const text = three.createText({ font: boot.font, text: TEXT, style: { fontSize: 16 }, constraints: box });
  scene.add(text);
  try {
    const paragraph = await createParagraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
    const result = paragraph.glyphs(box);
    scene.updateMatrixWorld(true);
    if (text.error !== undefined) throw text.error;
    const expected = text.glyphs();
    assert.ok(expected !== undefined, 'the Text route must publish a committed layout inspection');
    assert.deepEqual(projectLayout(result), projectLayout(expected), 'positioned output must be identical');
    paragraph.dispose();
  } finally {
    text.dispose();
  }
});

test('unconstrained alignment resolves against intrinsic line width', async () => {
  await using boot = await bootstrap();
  const text = 'short\nvery very long';
  const start = await createParagraph({
    font: boot.font,
    text,
    style: { fontSize: 16 },
    layout: { align: 'start', wrap: 'none' },
  });
  const center = await createParagraph({
    font: boot.font,
    text,
    style: { fontSize: 16 },
    layout: { align: 'center', wrap: 'none' },
  });
  const end = await createParagraph({
    font: boot.font,
    text,
    style: { fontSize: 16 },
    layout: { align: 'end', wrap: 'none' },
  });
  try {
    const startLayout = start.glyphs();
    const centerLayout = center.glyphs();
    const endLayout = end.glyphs();
    const firstGlyph = startLayout.lineGlyphStarts[0];
    const firstLineAdvance = startLayout.lineAdvances[0];
    const intrinsicWidth = startLayout.contentWidth;
    assert.equal(startLayout.lineCount, 2);
    assert.ok(firstGlyph !== undefined && firstLineAdvance !== undefined);
    assert.equal(centerLayout.x[firstGlyph], (intrinsicWidth - firstLineAdvance) / 2);
    assert.equal(endLayout.x[firstGlyph], intrinsicWidth - firstLineAdvance);
    assert.ok(Array.from(centerLayout.x).every((value) => value >= 0 && value <= intrinsicWidth));
    assert.ok(Array.from(endLayout.x).every((value) => value >= 0 && value <= intrinsicWidth));
  } finally {
    start.dispose();
    center.dispose();
    end.dispose();
  }
});

test('Paragraphs share one service host and compile a third-party font binding once', async () => {
  await using boot = await bootstrap();
  const bitmapVariant = immutableFontVariantIdentity(boot.font);
  const font = createImmutableFontLease(
    createImmutableFontVariant({
      backing: bitmapVariant.backing,
      format: portableTechnique,
      raster: { dispose() {} },
      data: {},
    }),
  );
  const callsBefore = portableCompileCalls;
  await assert.rejects(
    createParagraph({
      font,
      text: 'unsupported effect',
      style: { outline: { color: '#ffffff', width: 1 } },
    }),
    /test\.paragraph\.portable-technique.*outline/,
  );
  const first = await createParagraph({ font, text: 'portable', style: { fontSize: 16 } });
  const second = await createParagraph({ font, text: 'shared resources', style: { fontSize: 16 } });
  try {
    assert.ok(first.measure().glyphCount > 0);
    assert.ok(second.measure().glyphCount > 0);
    assert.equal(portableCompileCalls, callsBefore + 1);
  } finally {
    first.dispose();
    second.dispose();
    font.dispose();
  }
});

test('intrinsic widths ride one measurement and match independent content oracles', async () => {
  await using boot = await bootstrap();
  const paragraph = await createParagraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    const metrics = paragraph.measure({ width: { mode: 'exact', size: 500 } });
    assert.ok(metrics.minContentWidth > 0);
    assert.ok(metrics.minContentWidth <= metrics.maxContentWidth);

    // Oracle for minimum content: the widest word shaped standalone. The engine derives
    // it from one cluster-arena scan mirroring the breaker's wrap decisions, so the two
    // agree within flow-rounding tolerance rather than bit-exactly.
    let widestWord = 0;
    for (const word of TEXT.split(' ')) {
      const probe = await createParagraph({ font: boot.font, text: word, style: { fontSize: 16 } });
      const probeResult = probe.measure();
      widestWord = Math.max(widestWord, probeResult.contentWidth);
      probe.dispose();
    }
    assert.ok(
      Math.abs(metrics.minContentWidth - widestWord) < 0.1,
      `${metrics.minContentWidth} should equal the widest standalone word ${widestWord}`,
    );

    // Oracle for maximum content: the unconstrained single-line extent.
    const whole = await createParagraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
    const wholeResult = whole.measure();
    assert.ok(
      Math.abs(metrics.maxContentWidth - wholeResult.contentWidth) < 0.5,
      `${metrics.maxContentWidth} should equal the unconstrained extent ${wholeResult.contentWidth}`,
    );
    whole.dispose();
  } finally {
    paragraph.dispose();
  }
});

test('multi-line paragraph baseline metrics decompose around the first baseline', async () => {
  await using boot = await bootstrap();
  const paragraph = await createParagraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    const metrics = paragraph.measure({ width: { mode: 'exact', size: 120 } });
    assert.ok(metrics.lineCount > 1, 'the fixture must wrap to distinguish first and last baselines');
    assert.equal(metrics.ascent, metrics.firstBaseline);
    assert.ok(Math.abs(metrics.ascent + metrics.descent - metrics.lineHeight) < 1e-6);
    assert.equal(metrics.lineHeight, metrics.contentHeight);
    assert.ok(metrics.lastBaseline > metrics.firstBaseline);
  } finally {
    paragraph.dispose();
  }
});

test('repeated probes answer from cache and leave authored state untouched', async () => {
  await using boot = await bootstrap();
  const paragraph = await createParagraph({
    font: boot.font,
    text: TEXT,
    style: { fontSize: 16 },
    layout: { overflow: 'clip' },
  });
  try {
    const first = paragraph.measure({ width: { mode: 'at-most', size: 360 } });
    const repeat = paragraph.measure({ width: { mode: 'at-most', size: 360 } });
    assert.equal(repeat, first, 'equal inputs must answer with the identical cached object');
    assert.equal(paragraph.text, TEXT);
    assert.deepEqual(paragraph.layout, { overflow: 'clip' });

    const other = paragraph.measure({ width: { mode: 'exact', size: 200 } });
    assert.ok(other.lineCount > first.lineCount, 'a narrower probe wraps into more lines');

    // Authored state survives every probe; a fresh query at the original constraints still
    // answers identically to before the narrower one ran.
    const afterProbe = paragraph.measure({ width: { mode: 'at-most', size: 360 } });
    assert.deepEqual(projectMeasurement(afterProbe), projectMeasurement(first));
  } finally {
    paragraph.dispose();
  }
});

test('constraint caches retain only the three normal layout negotiation modes', async () => {
  await using boot = await bootstrap();
  const paragraph = await createParagraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    const firstConstraints = { width: { mode: 'exact', size: 180 } };
    const first = paragraph.measure(firstConstraints);
    paragraph.measure({ width: { mode: 'at-most', size: 240 } });
    paragraph.measure({ width: { mode: 'exact', size: 300 } });
    paragraph.measure();
    const recomputed = paragraph.measure(firstConstraints);
    assert.notEqual(recomputed, first, 'a fourth distinct constraint evicts the least-recently-used answer');
    assert.deepEqual(projectMeasurement(recomputed), projectMeasurement(first));
  } finally {
    paragraph.dispose();
  }
});

test('layoutRevision advances exactly when positioned output differs', async () => {
  await using boot = await bootstrap();
  const paragraph = await createParagraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    assert.equal(paragraph.layoutRevision, 0, 'nothing queried yet');

    // The measurement lane is paragraph-scoped and synchronous: a flexbox host probing
    // widths dozens of times per layout pass must never move the revision.
    const probe = paragraph.measure({ width: { mode: 'at-most', size: 600 } });
    assert.ok(probe.contentWidth > 0);
    assert.equal(paragraph.layoutRevision, 0, 'reading sizes must not produce positioned output');

    // Asking for the columns is the second query, and the revision moves with it.
    const wide = paragraph.glyphs({ width: { mode: 'at-most', size: 600 } });
    assert.equal(paragraph.layoutRevision, 1, 'materializing the columns advances from zero');
    const wideProjection = projectLayout(wide);

    // Asking again at the same constraints is the cached object, so nothing moves.
    assert.deepEqual(projectLayout(paragraph.glyphs({ width: { mode: 'at-most', size: 600 } })), wideProjection);
    assert.equal(paragraph.layoutRevision, 1, 'a cached answer must not advance the revision');

    // A wider at-most box that fits the same lines produces identical positioned output.
    const wider = paragraph.glyphs({ width: { mode: 'at-most', size: 900 } });
    assert.deepEqual(projectLayout(wider), wideProjection);
    assert.equal(paragraph.layoutRevision, 1, 'equal positioned output must not advance the revision');

    // Narrowing until the text wraps changes the positioned output.
    const narrow = paragraph.glyphs({ width: { mode: 'exact', size: 140 } });
    assert.equal(paragraph.layoutRevision, 2, 'changed positioned output advances by exactly one');
    assert.ok(narrow.lineCount > wide.lineCount, 'a narrower box wraps into more lines');

    // Returning to a previously cached answer is still a positioned-output transition.
    assert.deepEqual(projectLayout(paragraph.glyphs({ width: { mode: 'at-most', size: 600 } })), wideProjection);
    assert.equal(paragraph.layoutRevision, 3, 'switching back to cached output advances the revision');
  } finally {
    paragraph.dispose();
  }
});

test('update invalidates cached measurements, and meaningless input throws where it was written', async () => {
  await using boot = await bootstrap();
  const paragraph = await createParagraph({ font: boot.font, text: 'Hello', style: { fontSize: 16 } });
  try {
    const before = paragraph.measure({ width: { mode: 'exact', size: 400 } });
    paragraph.update({ text: `${TEXT}, now much longer than before` });
    const after = paragraph.measure({ width: { mode: 'exact', size: 400 } });
    assert.notDeepEqual(projectMeasurement(after), projectMeasurement(before));
    assert.ok(after.glyphCount > before.glyphCount);

    // Boundary violations are caller arithmetic errors: they throw from the call site
    // rather than resolving as a failed measurement outcome.
    assert.throws(() => paragraph.measure({ width: { mode: 'exact', size: -1 } }), RangeError);
    assert.throws(() => paragraph.measure({ width: { mode: 'at-most', size: Number.NaN } }), RangeError);
    assert.throws(() => paragraph.update({ style: { fontSize: 0 } }), /fontSize must be positive/);
    assert.equal(
      paragraph.text,
      `${TEXT}, now much longer than before`,
      'a rejected style update preserves desired state',
    );

    // Disposed paragraphs stop answering entirely.
    paragraph.dispose();
    assert.throws(() => paragraph.measure(), /disposed/);
  } finally {
    paragraph.dispose();
  }
});

test('exact justified columns remain exact for sub-unit renderer-local font sizes', async () => {
  await using boot = await bootstrap();
  const text = `${TEXT}. ${TEXT}. ${TEXT}. ${TEXT}.`;
  const width = 6.317474909879962;
  const constraints = { width: { mode: 'exact', size: width } };
  const paragraph = await createParagraph({
    font: boot.font,
    text,
    layout: { align: 'justify', wrap: 'word' },
    style: { fontSize: 0.15625, lineHeight: 1.2 },
  });
  try {
    paragraph.glyphs(constraints);
    paragraph.update({ style: { fontSize: 0.1731052166223526, lineHeight: 1.2 } });
    const layout = paragraph.glyphs(constraints);

    assert.ok(layout.lineCount > 1, 'the fixture must exercise justified non-final lines');
    for (const line of layout.lines.slice(0, -1)) {
      assert.ok(
        line.inkBounds !== undefined && line.inkBounds.width <= width + 1 / 4_096,
        `justified ink ${line.inkBounds?.width} must fit exact width ${width}`,
      );
      assert.ok(Math.abs(line.advance - width) <= 1 / 4_096, 'the justified advance must fill the exact column');
    }
  } finally {
    paragraph.dispose();
  }
});

test('positioned arrays are caller-owned and cannot corrupt the cached answer', async () => {
  await using boot = await bootstrap();
  const paragraph = await createParagraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    const first = paragraph.glyphs({ width: { mode: 'exact', size: 300 } });
    const expected = projectLayout(first);
    first.x.fill(-12345);
    first.glyphIds.fill(0);
    const second = paragraph.glyphs({ width: { mode: 'exact', size: 300 } });
    assert.notEqual(second, first);
    assert.deepEqual(projectLayout(second), expected);
  } finally {
    paragraph.dispose();
  }
});

test('formatted paragraph text is the only authority for its spans', async () => {
  await using boot = await bootstrap();
  const formatted = txt`formatted`;
  await assert.rejects(
    createParagraph({ font: boot.font, text: formatted, spans: [] }),
    /cannot declare raw spans; compose formatted text with txt and span/,
  );
  const paragraph = await createParagraph({ font: boot.font, text: 'plain' });
  try {
    assert.throws(
      () => paragraph.update({ text: formatted, spans: [] }),
      /cannot declare raw spans; compose formatted text with txt and span/,
    );
    assert.equal(paragraph.text, 'plain', 'a rejected update leaves desired state unchanged');
  } finally {
    paragraph.dispose();
  }
});

test('shared Paragraph stacks retain disposed font bindings until their final lease ends', async () => {
  await using boot = await bootstrap();
  const first = await createParagraph({ font: boot.font, text: 'first paragraph' });
  const second = await createParagraph({ font: boot.font, text: 'second paragraph' });
  first.measure();
  second.measure();
  assert.deepEqual(paragraphMeasurementServiceReport(), { active: true, paragraphs: 2 });

  const warn = console.warn;
  console.warn = () => undefined;
  try {
    boot.font.dispose();
  } finally {
    console.warn = warn;
  }
  assert.ok(first.measure().glyphCount > 0, 'live paragraphs keep the disposed Font backing valid');
  first.dispose();
  assert.deepEqual(paragraphMeasurementServiceReport(), { active: true, paragraphs: 1 });
  assert.ok(second.measure().glyphCount > 0);
  second.dispose();
  assert.deepEqual(paragraphMeasurementServiceReport(), { active: false, paragraphs: 0 });
});

function projectMeasurement(measurement) {
  return {
    width: measurement.width,
    height: measurement.height,
    contentWidth: measurement.contentWidth,
    contentHeight: measurement.contentHeight,
    firstBaseline: measurement.firstBaseline,
    lastBaseline: measurement.lastBaseline,
    ascent: measurement.ascent,
    descent: measurement.descent,
    lineHeight: measurement.lineHeight,
    minContentWidth: measurement.minContentWidth,
    maxContentWidth: measurement.maxContentWidth,
    overflowed: measurement.overflowed,
    glyphCount: measurement.glyphCount,
    lineCount: measurement.lineCount,
    missingGlyphCount: measurement.missingGlyphCount,
  };
}

test('authored nested state is snapshotted, so later caller mutation cannot change shaping input', async () => {
  await using boot = await bootstrap();
  const features = [{ tag: 'liga', value: 1 }];
  const paragraph = await createParagraph({
    font: boot.font,
    text: TEXT,
    style: { fontSize: 16, features },
    policy: { justify: { threshold: 0.5 } },
  });
  try {
    const before = projectMeasurement(paragraph.measure({}));
    // The caller still owns the array it passed in and may legitimately reuse it. Mutating it must
    // not reach the shaping input this paragraph was keyed on; a one-level freeze shared the array
    // and its records, so this edit changed the engine input while the cache kept answering stale.
    features[0].value = 0;
    features.push({ tag: 'kern', value: 0 });
    const after = projectMeasurement(paragraph.measure({}));
    assert.deepEqual(after, before);
  } finally {
    paragraph.dispose();
  }
});

function projectLayout(layout) {
  return {
    ...projectMeasurement(layout),
    glyphStableIds: Array.from(layout.glyphStableIds),
    glyphFontSlots: Array.from(layout.glyphFontSlots),
    glyphIds: Array.from(layout.glyphIds),
    clusters: Array.from(layout.clusters),
    glyphBidiLevels: Array.from(layout.glyphBidiLevels),
    glyphFontSizes: Array.from(layout.glyphFontSizes),
    x: Array.from(layout.x),
    y: Array.from(layout.y),
    glyphAdvances: Array.from(layout.glyphAdvances),
    glyphInkX: Array.from(layout.glyphInkX),
    glyphInkY: Array.from(layout.glyphInkY),
    glyphInkWidths: Array.from(layout.glyphInkWidths),
    glyphInkHeights: Array.from(layout.glyphInkHeights),
    glyphFlags: Array.from(layout.glyphFlags),
    lineTextStarts: Array.from(layout.lineTextStarts),
    lineTextEnds: Array.from(layout.lineTextEnds),
    lineGlyphStarts: Array.from(layout.lineGlyphStarts),
    lineGlyphCounts: Array.from(layout.lineGlyphCounts),
    lineBaselines: Array.from(layout.lineBaselines),
    lineAdvances: Array.from(layout.lineAdvances),
    fontHandles: Array.from(layout.fontHandles),
  };
}

test('measurement is complete and available before anything is rendered', async () => {
  // The question this answers: can a host place text correctly on the FIRST frame? That needs the
  // full metric set with no scene, no renderer, no world matrix, and no committed frame -- because
  // at that point none of those exist yet.
  await using boot = await bootstrap();
  const paragraph = await createParagraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    const m = paragraph.measure({ width: { mode: 'at-most', size: 420 } });

    // Everything alignment and centring need, in one synchronous call.
    for (const field of [
      'width',
      'height',
      'contentWidth',
      'contentHeight',
      'firstBaseline',
      'lastBaseline',
      'ascent',
      'descent',
      'lineHeight',
      'minContentWidth',
      'maxContentWidth',
    ]) {
      assert.equal(typeof m[field], 'number', `${field} must be measured before render`);
      assert.ok(Number.isFinite(m[field]), `${field} must be finite`);
    }

    // Ink bounds are the visual extent, distinct from the advance extent: centring on
    // contentWidth centres the pen, centring on inkBounds centres what you see. Ink is a
    // positioned quantity, so it comes from the second, positioned query.
    const inspection = paragraph.glyphs({ width: { mode: 'at-most', size: 420 } });
    assert.ok(inspection.inkBounds !== undefined, 'ink bounds must be measured before render');
    assert.ok(Number.isFinite(inspection.inkBounds.x) && Number.isFinite(inspection.inkBounds.width));
    assert.notEqual(inspection.inkBounds.width, m.contentWidth, 'ink and advance extents are different numbers');

    // The baseline is measured from the box top edge, which is what a flexbox baseline
    // alignment and a first-line cap alignment both need.
    assert.ok(m.firstBaseline > 0 && m.firstBaseline <= m.height);
    assert.ok(Math.abs(m.height - m.contentHeight) < 1e-6 || m.height >= m.contentHeight);

    // Centring a paragraph in a box is arithmetic on these numbers alone -- no matrix involved,
    // because every value is paragraph-local.
    const boxWidth = 600;
    const centredX = (boxWidth - inspection.inkBounds.width) / 2 - inspection.inkBounds.x;
    assert.ok(Number.isFinite(centredX));
  } finally {
    paragraph.dispose();
  }
});
