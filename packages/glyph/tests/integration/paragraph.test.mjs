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
      text.contentBox = constraints ?? {};
      scene.updateMatrixWorld(true);
      if (text.error !== undefined) throw text.error;
      const expected = text.measureLayout();
      assert.ok(expected !== undefined, 'the Text route must publish a committed measurement');
      assert.deepEqual(projectMeasurement(result), projectMeasurement(expected));
    }
    paragraph.dispose();
  } finally {
    text.dispose();
  }
});

test('measure() positioned columns agree byte-for-byte with the Three.js Text inspection route', async () => {
  await using boot = await bootstrap();
  const scene = new THREE.Scene();
  const box = { width: { mode: 'exact', size: 300 }, height: { mode: 'at-most', size: 200 } };
  const text = new Text({ font: boot.font, text: TEXT, style: { fontSize: 16 }, contentBox: box });
  scene.add(text);
  try {
    const paragraph = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
    const result = paragraph.measure(box);
    scene.updateMatrixWorld(true);
    if (text.error !== undefined) throw text.error;
    const expected = text.inspectLayout();
    assert.ok(expected !== undefined, 'the Text route must publish a committed layout inspection');
    assert.deepEqual(projectLayout(result), projectLayout(expected), 'positioned output must be identical');
    paragraph.dispose();
  } finally {
    text.dispose();
  }
});

test('intrinsic widths ride one measurement and match independent content oracles', async () => {
  await using boot = await bootstrap();
  const paragraph = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    const metrics = paragraph.measure({ width: { mode: 'exact', size: 500 } });
    assert.ok(metrics.minContentWidth > 0);
    assert.ok(metrics.minContentWidth <= metrics.maxContentWidth);

    // Oracle for minimum content: the widest word shaped standalone. The engine derives
    // it from one cluster-arena scan mirroring the breaker's wrap decisions, so the two
    // agree within flow-rounding tolerance rather than bit-exactly.
    let widestWord = 0;
    for (const word of TEXT.split(' ')) {
      const probe = new Paragraph({ font: boot.font, text: word, style: { fontSize: 16 } });
      const probeResult = probe.measure();
      widestWord = Math.max(widestWord, probeResult.contentWidth);
      probe.dispose();
    }
    assert.ok(
      Math.abs(metrics.minContentWidth - widestWord) < 0.1,
      `${metrics.minContentWidth} should equal the widest standalone word ${widestWord}`,
    );

    // Oracle for maximum content: the unconstrained single-line extent.
    const whole = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
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
    assert.ok(other.lineCount > first.lineCount, 'a narrower probe wraps into more lines');

    // Authored state survives every probe; a fresh query at the original constraints still
    // answers identically to before the narrower one ran.
    const afterProbe = paragraph.measure({ width: { mode: 'at-most', size: 360 } });
    assert.deepEqual(projectMeasurement(afterProbe), projectMeasurement(first));
  } finally {
    paragraph.dispose();
  }
});

test('layoutRevision advances when the columns materialize and the output differs', async () => {
  await using boot = await bootstrap();
  const paragraph = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
  try {
    assert.equal(paragraph.layoutRevision, 0, 'no positioned output yet');

    // Metrics alone never materialize the columns, so the revision does not move. This is what a
    // flexbox host does dozens of times per layout pass, and it must stay free.
    const probe = paragraph.measure({ width: { mode: 'at-most', size: 600 } });
    assert.ok(probe.contentWidth > 0);
    assert.equal(paragraph.layoutRevision, 0, 'reading sizes must not produce positioned output');

    // Touching a column materializes it once, and the revision moves with it.
    const wide = paragraph.measure({ width: { mode: 'at-most', size: 600 } });
    const wideProjection = projectLayout(wide);
    assert.equal(paragraph.layoutRevision, 1, 'materializing the columns advances from zero');
    projectLayout(wide);
    assert.equal(paragraph.layoutRevision, 1, 'a second read of the same layout is already resolved');

    // A wider at-most box that fits the same lines produces identical positioned output.
    const wider = paragraph.measure({ width: { mode: 'at-most', size: 900 } });
    assert.deepEqual(projectLayout(wider), wideProjection);
    assert.equal(paragraph.layoutRevision, 1, 'equal positioned output must not advance the revision');

    // Narrowing until the text wraps changes the positioned output.
    const narrow = paragraph.measure({ width: { mode: 'exact', size: 140 } });
    projectLayout(narrow);
    assert.equal(paragraph.layoutRevision, 2, 'changed positioned output advances the revision by exactly one');
    assert.ok(narrow.lineCount > wide.lineCount, 'a narrower box wraps into more lines');
  } finally {
    paragraph.dispose();
  }
});

test('update invalidates cached measurements, and meaningless input throws where it was written', async () => {
  await using boot = await bootstrap();
  const paragraph = new Paragraph({ font: boot.font, text: 'Hello', style: { fontSize: 16 } });
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

test('measurement is complete and available before anything is rendered', async () => {
  // The question this answers: can a host place text correctly on the FIRST frame? That needs the
  // full metric set with no scene, no renderer, no world matrix, and no committed frame -- because
  // at that point none of those exist yet.
  await using boot = await bootstrap();
  const paragraph = new Paragraph({ font: boot.font, text: TEXT, style: { fontSize: 16 } });
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
    // contentWidth centres the pen, centring on inkBounds centres what you see.
    assert.ok(m.inkBounds !== undefined, 'ink bounds must be measured before render');
    assert.ok(Number.isFinite(m.inkBounds.x) && Number.isFinite(m.inkBounds.width));
    assert.notEqual(m.inkBounds.width, m.contentWidth, 'ink and advance extents are different numbers');

    // The baseline is measured from the box top edge, which is what a flexbox baseline
    // alignment and a first-line cap alignment both need.
    assert.ok(m.firstBaseline > 0 && m.firstBaseline <= m.height);
    assert.ok(Math.abs(m.height - m.contentHeight) < 1e-6 || m.height >= m.contentHeight);

    // Centring a paragraph in a box is arithmetic on these numbers alone -- no matrix involved,
    // because every value is paragraph-local.
    const boxWidth = 600;
    const centredX = (boxWidth - m.inkBounds.width) / 2 - m.inkBounds.x;
    assert.ok(Number.isFinite(centredX));
  } finally {
    paragraph.dispose();
  }
});
