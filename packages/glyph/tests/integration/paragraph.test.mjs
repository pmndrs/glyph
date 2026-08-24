import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import { createTextRuntime } from '@pmndrs/glyph';
import { Paragraph } from '@pmndrs/glyph/core';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { Text } from '@pmndrs/glyph/three';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

const TEXT = 'The quick brown fox jumps over the lazy dog';

async function bootstrap() {
  const runtime = await createTextRuntime({
    wasm: await readFile(new URL('../../dist/text-shaper.wasm', import.meta.url)),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  return {
    runtime,
    font,
    async [Symbol.asyncDispose]() {
      font.dispose();
      runtime.dispose();
    },
  };
}

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
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
test('Paragraph.measure agrees byte-for-byte with the Three.js Text measure route', async () => {
  await using boot = await bootstrap();
  const scene = new THREE.Scene();
  const text = new Text({ font: boot.font, text: TEXT, style: { fontSize: 16 }, contentBox: {} });
  scene.add(text);
  try {
    const paragraph = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
    for (const constraints of CONSTRAINTS) {
      const result = paragraph.measure(constraints);
      assert.equal(result.ok, true);
      text.contentBox = constraints ?? {};
      scene.updateMatrixWorld(true);
      if (text.error !== undefined) throw text.error;
      const expected = text.measureLayout();
      assert.ok(expected !== undefined, 'the Text route must publish a committed measurement');
      assert.deepEqual(projectMeasurement(result.metrics), projectMeasurement(expected));
    }
    paragraph.dispose();
  } finally {
    text.dispose();
  }
});

test('Paragraph.layout agrees byte-for-byte with the Three.js Text inspection route', async () => {
  await using boot = await bootstrap();
  const scene = new THREE.Scene();
  const box = { width: { mode: 'exact', size: 300 }, height: { mode: 'at-most', size: 200 } };
  const text = new Text({ font: boot.font, text: TEXT, style: { fontSize: 16 }, contentBox: box });
  scene.add(text);
  try {
    const paragraph = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
    const result = paragraph.layout(box);
    assert.equal(result.ok, true);
    scene.updateMatrixWorld(true);
    if (text.error !== undefined) throw text.error;
    const expected = text.inspectLayout();
    assert.ok(expected !== undefined, 'the Text route must publish a committed layout inspection');
    assert.deepEqual(projectLayout(result.layout), projectLayout(expected), 'positioned output must be identical');
    paragraph.dispose();
  } finally {
    text.dispose();
  }
});

test('intrinsic widths ride one measurement and match independent content oracles', async () => {
  await using boot = await bootstrap();
  const paragraph = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    const result = paragraph.measure({ width: { mode: 'exact', size: 500 } });
    assert.equal(result.ok, true);
    const { metrics } = result;
    assert.ok(metrics.minContentWidth > 0);
    assert.ok(metrics.minContentWidth <= metrics.maxContentWidth);

    // Oracle for minimum content: the widest word shaped standalone. The engine derives
    // it from one cluster-arena scan mirroring the breaker's wrap decisions, so the two
    // agree within flow-rounding tolerance rather than bit-exactly.
    let widestWord = 0;
    for (const word of TEXT.split(' ')) {
      const probe = new Paragraph({ font: boot.font, text: word, style: { fontSize: 16 } });
      const probeResult = probe.measure();
      assert.equal(probeResult.ok, true);
      widestWord = Math.max(widestWord, probeResult.metrics.contentWidth);
      probe.dispose();
    }
    assert.ok(
      Math.abs(metrics.minContentWidth - widestWord) < 0.1,
      `${metrics.minContentWidth} should equal the widest standalone word ${widestWord}`,
    );

    // Oracle for maximum content: the unconstrained single-line extent.
    const whole = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
    const wholeResult = whole.measure();
    assert.equal(wholeResult.ok, true);
    assert.ok(
      Math.abs(metrics.maxContentWidth - wholeResult.metrics.contentWidth) < 0.5,
      `${metrics.maxContentWidth} should equal the unconstrained extent ${wholeResult.metrics.contentWidth}`,
    );
    whole.dispose();
  } finally {
    paragraph.dispose();
  }
});

test('repeated probes answer from cache and leave authored state untouched', async () => {
  await using boot = await bootstrap();
  const paragraph = new Paragraph({
    font: boot.font,
    text: TEXT,
    style: { fontSize: 16 },
    policy: { overflow: 'clip' },
  });
  try {
    const first = paragraph.measure({ width: { mode: 'at-most', size: 360 } });
    const repeat = paragraph.measure({ width: { mode: 'at-most', size: 360 } });
    assert.equal(repeat, first, 'equal inputs must answer with the identical cached object');
    assert.equal(paragraph.text, TEXT);
    assert.deepEqual(paragraph.policy, { overflow: 'clip' });

    const other = paragraph.measure({ width: { mode: 'exact', size: 200 } });
    assert.equal(other.ok, true);
    assert.ok(other.metrics.lineCount > first.metrics.lineCount, 'a narrower probe wraps into more lines');

    // Authored state survives every probe; a fresh query at the original constraints still
    // answers identically to before the narrower one ran.
    const afterProbe = paragraph.measure({ width: { mode: 'at-most', size: 360 } });
    assert.deepEqual(projectMeasurement(afterProbe.metrics), projectMeasurement(first.metrics));
  } finally {
    paragraph.dispose();
  }
});

test('layoutRevision advances exactly when positioned output changes', async () => {
  await using boot = await bootstrap();
  const paragraph = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    assert.equal(paragraph.layoutRevision, 0, 'no positioned output yet');

    const wide = paragraph.layout({ width: { mode: 'at-most', size: 600 } });
    assert.equal(wide.ok, true);
    assert.equal(wide.layoutRevision, 1, 'first layout advances from zero');
    const wideProjection = projectLayout(wide.layout);

    // A wider at-most box that fits the same lines produces identical positioned output.
    const wider = paragraph.layout({ width: { mode: 'at-most', size: 900 } });
    assert.equal(wider.ok, true);
    assert.equal(wider.layoutRevision, 1, 'equal positioned output must not advance the revision');
    assert.deepEqual(projectLayout(wider.layout), wideProjection);

    // Narrowing until the text wraps changes the positioned output.
    const narrow = paragraph.layout({ width: { mode: 'exact', size: 140 } });
    assert.equal(narrow.ok, true);
    assert.equal(narrow.layoutRevision, 2, 'changed positioned output advances the revision by exactly one');
    assert.notDeepEqual(projectLayout(narrow.layout), wideProjection);

    // A text edit that moves glyphs advances the revision again on the next layout.
    paragraph.update({ text: `${TEXT} and then some` });
    const edited = paragraph.layout({ width: { mode: 'exact', size: 140 } });
    assert.equal(edited.ok, true);
    assert.equal(edited.layoutRevision, 3, 'an edit that changes positioned output advances the revision');

    // Re-laying out unchanged state keeps the revision stable.
    const repeat = paragraph.layout({ width: { mode: 'exact', size: 140 } });
    assert.equal(repeat, edited, 'identical repeated layout answers from cache with the same revision');
  } finally {
    paragraph.dispose();
  }
});

test('update invalidates cached measurements and failure surfaces from the measure call itself', async () => {
  await using boot = await bootstrap();
  const paragraph = new Paragraph({ font: boot.font, text: 'Hello', style: { fontSize: 16 } });
  try {
    const before = paragraph.measure({ width: { mode: 'exact', size: 400 } });
    assert.equal(before.ok, true);
    paragraph.update({ text: `${TEXT}, now much longer than before` });
    const after = paragraph.measure({ width: { mode: 'exact', size: 400 } });
    assert.equal(after.ok, true);
    assert.notDeepEqual(projectMeasurement(after.metrics), projectMeasurement(before.metrics));
    assert.ok(after.metrics.glyphCount > before.metrics.glyphCount);

    // Boundary violations are caller arithmetic errors: they throw from the call site
    // rather than resolving as a failed measurement outcome.
    assert.throws(() => paragraph.measure({ width: { mode: 'exact', size: -1 } }), RangeError);
    assert.throws(() => paragraph.measure({ width: { mode: 'at-most', size: Number.NaN } }), RangeError);

    // Disposed paragraphs stop answering entirely.
    paragraph.dispose();
    assert.throws(() => paragraph.measure(), /disposed/);
  } finally {
    paragraph.dispose();
  }
});

function projectMeasurement(measurement) {
  return {
    width: measurement.width,
    height: measurement.height,
    contentWidth: measurement.contentWidth,
    contentHeight: measurement.contentHeight,
    firstBaseline: measurement.firstBaseline,
    lastBaseline: measurement.lastBaseline,
    overflowed: measurement.overflowed,
    glyphCount: measurement.glyphCount,
    lineCount: measurement.lineCount,
    missingGlyphCount: measurement.missingGlyphCount,
  };
}

test('authored nested state is snapshotted, so later caller mutation cannot change shaping input', async () => {
  await using boot = await bootstrap();
  const features = [{ tag: 'liga', value: 1 }];
  const paragraph = new Paragraph({
    font: boot.font,
    text: TEXT,
    style: { fontSize: 16, features },
    policy: { justify: { threshold: 0.5 } },
  });
  try {
    const before = projectMeasurement(paragraph.measure({}).metrics);
    // The caller still owns the array it passed in and may legitimately reuse it. Mutating it must
    // not reach the shaping input this paragraph was keyed on; a one-level freeze shared the array
    // and its records, so this edit changed the engine input while the cache kept answering stale.
    features[0].value = 0;
    features.push({ tag: 'kern', value: 0 });
    const after = projectMeasurement(paragraph.measure({}).metrics);
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
    glyphFontSizes: Array.from(layout.glyphFontSizes),
    x: Array.from(layout.x),
    y: Array.from(layout.y),
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
