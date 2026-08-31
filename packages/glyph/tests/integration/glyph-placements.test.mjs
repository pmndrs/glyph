import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';

import { glyphFlags } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { FontLoader, Text, TextGroup } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url);

let loader;
let loaded;

async function loadFont() {
  if (loaded !== undefined) return loaded;
  loader = new FontLoader();
  loaded = await loader.loadAsync({
    input: { baked: { bytes: await readFile(fontUrl), ownership: 'copy' } },
    raster: { technique: bitmap, options: { strikes: [16, 32] } },
  });
  return loaded;
}

after(() => {
  loaded?.dispose();
  loader?.dispose();
});

function mount(font, text, properties = {}) {
  const scene = new THREE.Scene();
  const group = new TextGroup({});
  const node = new Text({ font, style: { fontSize: 16 }, text, ...properties });
  scene.add(group);
  group.add(node);
  scene.updateMatrixWorld(true);
  return { group, node, scene };
}

function unmount({ group, node }) {
  node.dispose();
  group.dispose();
}

test('measureGlyphs publishes local geometry without traversing world matrices', async () => {
  const mounted = mount(await loadFont(), 'Wavy');
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

test('glyph advances and ink extents agree with independently published paragraph measurements', async () => {
  const mounted = mount(await loadFont(), 'Wavy');
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

test('caret and selection helpers resolve clusters without exposing a mutable snapshot', async () => {
  const mounted = mount(await loadFont(), 'hi there');
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

test('word and caret ranges preserve UTF-16 clusters and bidi direction', async () => {
  const font = await loadFont();
  const astralText = 'A😀';
  const astral = mount(font, astralText);
  const combining = mount(font, 'e\u0301');
  const rtl = mount(font, 'אב', {
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

test('glyph flags decode through exported names rather than remembered indices', async () => {
  const mounted = mount(await loadFont(), 'flags');
  try {
    const inspection = mounted.node.glyphs();
    assert.equal(inspection.glyphFlags.length, inspection.glyphCount);
    assert.equal(glyphFlags.produced, glyphFlags.unsafeToBreak | glyphFlags.unsafeToConcat);
    for (const flags of inspection.glyphFlags) assert.equal(flags & ~glyphFlags.produced, 0);
  } finally {
    unmount(mounted);
  }
});

test('breakApart carries stable line and word metadata without presentation overrides', async () => {
  const mounted = mount(await loadFont(), 'one two three', {
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
      const glyph = glyphs.glyphAt(index);
      assert.equal(glyph?.index, index);
      assert.ok((glyph?.line ?? -1) >= 0);
      assert.ok((glyph?.word ?? -2) >= -1);
      if (glyph !== undefined && glyph.word >= 0) {
        const lines = linesByWord.get(glyph.word) ?? new Set();
        lines.add(glyph.line);
        linesByWord.set(glyph.word, lines);
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

test('detached glyph keys survive movement-only reflow and change when text reshapes', async () => {
  const mounted = mount(await loadFont(), 'ABCD');
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

test('commit state distinguishes unbound, pending, and committed paragraph state', async () => {
  const font = await loadFont();
  const scene = new THREE.Scene();
  const node = new Text({ font, style: { fontSize: 16 }, text: 'ready' });
  try {
    assert.deepEqual(node.commitState(), { status: 'unbound' });
    assert.throws(() => node.breakApart(), /before its renderer state is committed/);
    scene.add(node);
    assert.equal(node.commitState().status, 'pending');
    assert.throws(() => node.breakApart(), /before its renderer state is committed/);
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
