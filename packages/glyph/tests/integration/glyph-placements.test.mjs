import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';

import { glyph, glyphFlags, bitmap } from '@pmndrs/glyph';
import { loadFont as loadGlyphFont } from '../../dist/loader.js';
import { defineTextMaterial, defineThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import { createThreeTestHandle } from '../support/three-handle.mjs';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url);

let loaded;

async function loadFont() {
  if (loaded !== undefined) return loaded;
  loaded = await loadGlyphFont(
    { baked: { bytes: await readFile(fontUrl), ownership: 'copy' } },
    bitmap({ strikes: [16, 32] }),
  );
  return loaded;
}

after(() => {
  loaded?.dispose();
});

async function mount(testContext, font, text, properties = {}) {
  const three = await createThreeTestHandle(testContext);
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const node = three.createText({ font, style: { fontSize: 16 }, text, ...properties });
  scene.add(group);
  group.add(node);
  scene.updateMatrixWorld(true);
  return { group, node, scene };
}

function unmount({ group, node }) {
  node.dispose();
  group.dispose();
}

test('measureGlyphs publishes local geometry without traversing world matrices', async (t) => {
  const mounted = await mount(t, await loadFont(), 'Wavy');
  try {
    mounted.node.position.set(7, -3, 2);
    mounted.scene.updateMatrixWorld(true);
    const measurements = mounted.node.measureGlyphs();
    assert.ok(measurements !== undefined && measurements.length === mounted.node.measure().glyphCount);
    for (const measurement of measurements) {
      assert.equal(measurement.originalMatrix.elements[12], measurement.drawnOrigin.x);
      assert.equal(measurement.originalMatrix.elements[13], measurement.drawnOrigin.y);
      assert.equal(measurement.originalMatrix.elements[14], measurement.drawnOrigin.z);
      assert.ok(measurement.localInkBounds.getSize(new THREE.Vector3()).x >= 0);
      assert.ok(measurement.geometry.positions.length >= 4);
    }

    const initialMatrix = measurements[0].originalMatrix.clone();
    const staleGroupWorldX = mounted.group.matrixWorld.elements[12];
    mounted.group.position.x += 11;
    const moved = mounted.node.measureGlyphs();
    assert.ok(moved !== undefined);
    assert.ok(moved[0].originalMatrix.equals(initialMatrix), 'world movement cannot alter Text-local measurements');
    assert.equal(
      mounted.group.matrixWorld.elements[12],
      staleGroupWorldX,
      'measurement cannot traverse dirty ancestors',
    );
  } finally {
    unmount(mounted);
  }
});

test('glyph advances and ink extents agree with independently published paragraph measurements', async (t) => {
  const mounted = await mount(t, await loadFont(), 'Wavy');
  try {
    const inspection = mounted.node.glyphs();
    const summary = mounted.node.measure();
    const line = inspection.lines[0];
    assert.ok(line);

    const glyphStart = inspection.lineGlyphStarts[0];
    const glyphCount = inspection.lineGlyphCounts[0];
    const advanceSum = inspection.glyphAdvances
      .subarray(glyphStart, glyphStart + glyphCount)
      .reduce((total, advance) => total + advance, 0);
    const lineAdvance = summary.lines[0].advance;
    assert.ok(
      Math.abs(advanceSum - lineAdvance) / lineAdvance < 1e-3,
      `glyph advances summed to ${advanceSum}, but the line advance is ${lineAdvance}`,
    );
    assert.ok(line.inkBounds.width > 0);
    assert.notEqual(line.inkBounds.width, line.advance, 'ink and advance extents must remain distinct');
    assert.ok(summary.inkBounds !== undefined);
    assert.ok(Math.abs(summary.inkBounds.width - line.inkBounds.width) < 1e-3);
    assert.ok(Math.abs(line.ascent + line.descent - line.lineHeight) < 1e-6);
    assert.equal(summary.ascent, summary.firstBaseline);
  } finally {
    unmount(mounted);
  }
});

test('caret and selection helpers resolve clusters without exposing a mutable snapshot', async (t) => {
  const mounted = await mount(t, await loadFont(), 'hi there');
  try {
    const line = mounted.node.glyphs().lines[0];
    const start = mounted.node.caretAt(-1_000, line.baseline);
    const end = mounted.node.caretAt(1_000, line.baseline);
    assert.equal(start?.offset, 0);
    assert.equal(start?.leading, true);
    assert.equal(start?.rect.height, line.lineHeight);
    assert.equal(end?.leading, false);
    assert.ok((end?.rect.x ?? 0) > (start?.rect.x ?? 0));

    assert.deepEqual(mounted.node.selectionRects(3, 3), []);
    const whole = mounted.node.selectionRects(0, mounted.node.text.length);
    assert.equal(whole?.length, 1);
    assert.equal(whole?.[0].height, line.lineHeight);
  } finally {
    unmount(mounted);
  }
});

test('word and caret ranges preserve UTF-16 clusters and bidi direction', async (t) => {
  const font = await loadFont();
  const astralText = 'A😀';
  const astral = await mount(t, font, astralText);
  const combining = await mount(t, font, 'e\u0301');
  const rtl = await mount(t, font, 'אב', {
    style: { fontSize: 16, direction: 'rtl' },
    constraints: { width: { mode: 'exact', size: 100 } },
  });
  try {
    const astralInspection = astral.node.glyphs();
    assert.equal(astralInspection.clusters.at(-1), 1, 'the astral glyph starts at one UTF-16 cluster boundary');
    assert.equal(astral.node.selectionRects(2, 3)?.length, 1, 'a range inside an astral cluster selects it');

    const combiningInspection = combining.node.glyphs();
    assert.deepEqual([...new Set(combiningInspection.clusters)], [0], 'a combining sequence remains one cluster');

    const rtlInspection = rtl.node.glyphs();
    const rtlLine = rtlInspection.lines[0];
    assert.ok([...rtlInspection.glyphBidiLevels].every((level) => (level & 1) === 1));
    const logicalStart = rtl.node.caretAt(1_000, rtlLine.baseline);
    const logicalEnd = rtl.node.caretAt(-1_000, rtlLine.baseline);
    assert.equal(logicalStart?.offset, 0, 'RTL logical start is the visually right edge');
    assert.equal(logicalStart?.leading, true);
    assert.equal(logicalEnd?.offset, 'אב'.length, 'RTL logical end is the visually left edge');
    assert.equal(logicalEnd?.leading, false);
  } finally {
    unmount(astral);
    unmount(combining);
    unmount(rtl);
  }
});

test('glyph flags decode through exported names rather than remembered indices', async (t) => {
  const mounted = await mount(t, await loadFont(), 'flags');
  try {
    const inspection = mounted.node.glyphs();
    assert.equal(inspection.glyphFlags.length, inspection.glyphCount);
    assert.equal(glyphFlags.produced, glyphFlags.unsafeToBreak | glyphFlags.unsafeToConcat);
    for (const flags of inspection.glyphFlags) assert.equal(flags & ~glyphFlags.produced, 0);
  } finally {
    unmount(mounted);
  }
});

test('breakApart carries stable line and word metadata without presentation overrides', async (t) => {
  const mounted = await mount(t, await loadFont(), 'one two three', {
    constraints: { width: { mode: 'exact', size: 60 } },
    layout: { wrap: 'word' },
  });
  let glyphs;
  try {
    [glyphs] = mounted.node.breakApart();
    mounted.scene.add(glyphs);
    mounted.scene.updateMatrixWorld(true);
    assert.ok(glyphs.count > 0);
    assert.ok(mounted.node.glyphs().lineCount > 1, 'the fixture must wrap so line membership is not trivial');
    const linesByWord = new Map();
    for (let index = 0; index < glyphs.count; index += 1) {
      const placement = glyphs.glyphAt(index);
      assert.equal(placement?.index, index);
      assert.ok((placement?.line ?? -1) >= 0);
      assert.ok((placement?.word ?? -2) >= -1);
      if (placement !== undefined && placement.word >= 0) {
        const lines = linesByWord.get(placement.word) ?? new Set();
        lines.add(placement.line);
        linesByWord.set(placement.word, lines);
      }
    }
    assert.equal(linesByWord.size, 3, 'three space-separated runs remain three words');
    assert.ok(
      [...linesByWord.values()].every((lines) => lines.size === 1),
      'no word may straddle a line',
    );
  } finally {
    glyphs?.dispose();
    unmount(mounted);
  }
});

test('detached glyph keys survive movement-only reflow and change when text reshapes', async (t) => {
  const mounted = await mount(t, await loadFont(), 'ABCD');
  let before;
  let resized;
  let reshaped;
  try {
    [before] = mounted.node.breakApart();
    const beforeKeys = Array.from({ length: before.count }, (_, index) => before.glyphAt(index)?.key);
    const beforeX = before.measurements.map((measurement) => measurement.originalMatrix.elements[12]);

    mounted.node.style = { fontSize: 32 };
    mounted.scene.updateMatrixWorld(true);
    [resized] = mounted.node.breakApart();
    const resizedKeys = Array.from({ length: resized.count }, (_, index) => resized.glyphAt(index)?.key);
    assert.deepEqual(resizedKeys, beforeKeys, 'a font-size reflow moves the same glyph identities');
    assert.ok(
      resized.measurements.some((measurement, index) => measurement.originalMatrix.elements[12] !== beforeX[index]),
      'the movement-only reflow must actually reposition at least one glyph',
    );

    mounted.node.text = 'WXYZ';
    mounted.scene.updateMatrixWorld(true);
    [reshaped] = mounted.node.breakApart();
    const reshapedKeys = new Set(Array.from({ length: reshaped.count }, (_, index) => reshaped.glyphAt(index)?.key));
    assert.equal(
      beforeKeys.filter((key) => reshapedKeys.has(key)).length,
      0,
      'reshaping different text must replace every detached glyph identity',
    );
  } finally {
    before?.dispose();
    resized?.dispose();
    reshaped?.dispose();
    unmount(mounted);
  }
});

test('commit state distinguishes unbound, pending, and committed paragraph state', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont();
  const scene = new THREE.Scene();
  const node = three.createText({ font, style: { fontSize: 16 }, text: 'ready' });
  try {
    assert.deepEqual(node.commitState(), { status: 'unbound' });
    assert.throws(() => node.breakApart(), /before its renderer state is committed/);
    scene.add(node);
    assert.equal(node.commitState().status, 'pending');
    scene.updateMatrixWorld(true);
    const committed = node.commitState();
    assert.equal(committed.status, 'committed');
    assert.equal(typeof committed.revision, 'number');

    node.text = 'ready again';
    assert.equal(node.commitState().status, 'pending');
    scene.updateMatrixWorld(true);
    assert.equal(node.commitState().status, 'committed');
    assert.notEqual(node.commitState().revision, committed.revision);
  } finally {
    node.dispose();
  }
});

test('committed-layout reads publish a pending paragraph in a Scene without waiting for a traversal', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont();
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const node = three.createText({ font, style: { fontSize: 16 }, text: 'ready' });
  let copy;
  try {
    parent.add(node);
    assert.equal(node.commitState().status, 'pending');
    assert.equal(node.measureGlyphs(), undefined, 'a paragraph outside any Scene has no root publication');
    assert.throws(() => node.breakApart(), /before its renderer state is committed/);

    scene.add(parent);
    assert.equal(node.measureGlyphs()?.length, node.measure().glyphCount);
    assert.equal(node.commitState().status, 'committed');

    node.text = 'steady';
    assert.equal(node.commitState().status, 'pending');
    [copy] = node.breakApart();
    assert.equal(copy.count, node.measure().glyphCount);
    assert.equal(node.commitState().status, 'committed');
  } finally {
    copy?.dispose();
    node.dispose();
  }
});

for (const [name, read] of [
  ['measureGlyphs', (node) => node.measureGlyphs()],
  ['caretAt', (node) => node.caretAt(0, 0)],
  ['selectionRects', (node) => node.selectionRects(0, 1)],
  ['breakApart', (node) => node.breakApart()],
]) {
  test(`${name} propagates publication failures from an explicit read`, async (t) => {
    const three = await createThreeTestHandle(t);
    const failure = new Error('material creation failed');
    let node;
    const material = defineTextMaterial(() => {
      assert.throws(() => node.measureGlyphs(), /cannot be reentered/);
      throw failure;
    });
    node = three.createText({ font: await loadFont(), material, text: 'ready' });
    const scene = new THREE.Scene();
    scene.add(node);
    try {
      assert.throws(
        () => read(node),
        (error) => error === failure,
      );
      assert.equal(node.error, failure);
    } finally {
      node.dispose();
    }
  });
}

for (const owner of ['text', 'group']) {
  test(`a read retries a failed publication after explicit ${owner} material changes`, async (t) => {
    const three = await createThreeTestHandle(t);
    const failure = new Error('material creation failed');
    let attempts = 0;
    const material = defineTextMaterial(() => {
      attempts += 1;
      throw failure;
    });
    const node = three.createText({
      font: await loadFont(),
      text: 'ready',
      ...(owner === 'text' ? { material } : {}),
    });
    const group = three.createTextGroup(owner === 'group' ? { material } : {});
    const scene = new THREE.Scene();
    group.add(node);
    scene.add(group);
    // Observing the same failure, including from onError, must not reenter or retry publication.
    node.onError = () => assert.equal(node.measureGlyphs(), undefined);
    let copies;
    try {
      assert.throws(
        () => node.measureGlyphs(),
        (error) => error === failure,
      );
      assert.equal(node.measureGlyphs(), undefined);
      assert.throws(() => node.breakApart(), /after renderer realization failed/);
      assert.equal(attempts, 1);

      // Even a repeated failure with the same Error belongs to the new attempted revision.
      if (owner === 'text') node.material = material;
      else group.material = material;
      assert.throws(
        () => node.measureGlyphs(),
        (error) => error === failure,
      );
      assert.equal(node.measureGlyphs(), undefined);
      assert.equal(attempts, 2);

      if (owner === 'text') node.material = undefined;
      else group.material = undefined;
      // A layout-only query may stage the repair, but must not consume the pending renderer publication.
      assert.ok(node.computeBoundingBox().max.x > node.computeBoundingBox().min.x);
      copies = node.breakApart();
      assert.equal(copies[0].count, 5);
      assert.equal(node.commitState().status, 'committed');
      assert.equal(node.error, undefined);
      assert.equal(group.error, undefined);
    } finally {
      copies?.forEach((copy) => copy?.dispose());
      node.dispose();
      group.dispose();
    }
  });
}

test('a repair skipped by fixed capacity keeps rejected draw data unavailable until publication succeeds', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 6, policy: 'fixed' } }));
  const font = await loadFont();
  const node = three.createText({ font, text: 'ready' });
  const group = three.createTextGroup();
  group.add(node);
  new THREE.Scene().add(group);
  let extra;
  let copies;
  try {
    assert.equal(node.measureGlyphs()?.length, 5);
    const failure = new Error('material creation failed');
    group.material = defineTextMaterial(() => {
      throw failure;
    });
    assert.throws(glyph.shape.bind(glyph), (error) => error === failure);

    group.material = undefined;
    extra = three.createText({ font, text: 'more' });
    group.add(extra);
    node.computeBoundingBox();
    assert.equal(node.measureGlyphs(), undefined, 'staging the repair cannot acknowledge rejected renderer data');
    assert.throws(() => node.breakApart(), /after renderer realization failed/);

    extra.dispose();
    copies = node.breakApart();
    assert.equal(copies[0].count, 5);
    assert.equal(node.commitState().status, 'committed');
  } finally {
    copies?.forEach((copy) => copy?.dispose());
    extra?.dispose();
    node.dispose();
    group.dispose();
  }
});
