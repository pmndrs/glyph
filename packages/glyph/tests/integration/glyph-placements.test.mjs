import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';

import { bitmap, createFontStack, glyphFlags } from '@pmndrs/glyph';
import { createGlyphPlacements } from '@pmndrs/glyph/core';
import { loadFont as loadGlyphFont } from '../../dist/loader.js';
import * as THREE from 'three/webgpu';

import { createThreeTestHandle } from '../support/three-handle.mjs';

const fontUrls = {
  inter: new URL('../../../../benches/fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url),
  amiri: new URL('../../../../benches/fixtures/rendering/amiri-bitmap-16-32.font.glb', import.meta.url),
};

const loaded = new Map();

async function loadFont(fixture = 'inter') {
  const existing = loaded.get(fixture);
  if (existing !== undefined) return existing;
  const font = await loadGlyphFont(
    { baked: { bytes: await readFile(fontUrls[fixture]), ownership: 'copy' } },
    bitmap({ strikes: [16, 32] }),
  );
  loaded.set(fixture, font);
  return font;
}

after(() => {
  for (const font of loaded.values()) font.dispose();
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

function placementsOf(node) {
  const layout = node.glyphs();
  return createGlyphPlacements(layout, node.text, layout.x, layout.y, []);
}

function leadingEdgeOf(placements, cluster) {
  const glyphs = placements.glyphs.filter((glyph) => glyph.cluster === cluster);
  assert.ok(glyphs.length > 0, `cluster ${String(cluster)} must have a glyph`);
  const left = Math.min(...glyphs.flatMap((glyph) => [glyph.x, glyph.x + glyph.advance]));
  const right = Math.max(...glyphs.flatMap((glyph) => [glyph.x, glyph.x + glyph.advance]));
  return (glyphs[0].bidiLevel & 1) !== 0 ? right : left;
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

    const atStart = mounted.node.caretForOffset(0);
    assert.deepEqual(atStart, start, 'the caret before the first cluster matches the caret at the line start');
    const atEnd = mounted.node.caretForOffset(mounted.node.text.length);
    assert.deepEqual(atEnd, end, 'the caret after the last cluster matches the caret at the line end');
    const inside = mounted.node.caretForOffset(3);
    assert.equal(inside?.offset, 3);
    assert.equal(inside?.leading, true);
    assert.equal(inside?.rect.x, mounted.node.caretAt(inside.rect.x, line.baseline)?.rect.x);
    assert.throws(() => mounted.node.caretForOffset(mounted.node.text.length + 1), RangeError);
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

test('caretForOffset follows logical clusters through RTL and mixed-direction text', async (t) => {
  const [inter, amiri] = await Promise.all([loadFont(), loadFont('amiri')]);
  const rtl = await mount(t, amiri, 'سلام', {
    style: { fontSize: 16, direction: 'rtl', language: 'ar' },
    constraints: { width: { mode: 'exact', size: 100 } },
  });
  const mixed = await mount(t, createFontStack(inter, amiri), 'ab سلام cd', {
    style: { fontSize: 16, direction: 'ltr', language: 'ar' },
  });
  try {
    const rtlPlacements = placementsOf(rtl.node);
    const rtlStart = rtlPlacements.caretForOffset(0);
    const rtlEnd = rtlPlacements.caretForOffset(rtl.node.text.length);
    assert.equal(rtlStart.offset, 0);
    assert.equal(rtlStart.leading, true);
    assert.equal(rtlEnd.offset, rtl.node.text.length);
    assert.equal(rtlEnd.leading, false);
    assert.ok(rtlStart.rect.x > rtlEnd.rect.x, 'RTL logical start must draw to the right of its logical end');

    const rtlClusters = [...new Set(rtlPlacements.glyphs.map((glyph) => glyph.cluster))].sort(
      (left, right) => left - right,
    );
    const rtlCarets = rtlClusters.map((cluster) => rtlPlacements.caretForOffset(cluster));
    assert.deepEqual(
      rtlCarets.map((caret) => caret.offset),
      rtlClusters,
      'each logical RTL cluster must resolve independently of visual glyph order',
    );
    assert.equal(
      new Set(rtlCarets.map((caret) => caret.rect.x)).size,
      rtlClusters.length,
      'distinct RTL clusters must not collapse onto one visual caret',
    );

    const mixedPlacements = placementsOf(mixed.node);
    const mixedRtlClusters = [
      ...new Set(mixedPlacements.glyphs.filter((glyph) => (glyph.bidiLevel & 1) !== 0).map((glyph) => glyph.cluster)),
    ].sort((left, right) => left - right);
    assert.ok(mixedRtlClusters.length >= 3, 'the real mixed-font fixture must retain a multi-cluster RTL run');
    const mixedCarets = mixedRtlClusters.map((cluster) => mixedPlacements.caretForOffset(cluster));
    assert.deepEqual(
      mixedCarets.map((caret) => caret.offset),
      mixedRtlClusters,
      'logical offsets inside an RTL run must remain distinct in an LTR paragraph',
    );
    assert.equal(new Set(mixedCarets.map((caret) => caret.rect.x)).size, mixedRtlClusters.length);

    const ambiguous = mixedCarets[0];
    assert.ok(ambiguous);
    assert.equal(ambiguous.leading, true, 'an ambiguous bidi boundary uses the owning cluster leading affinity');
    assert.equal(ambiguous.rect.x, leadingEdgeOf(mixedPlacements, ambiguous.offset));
    assert.deepEqual(mixed.node.caretForOffset(ambiguous.offset), ambiguous, 'Three Text mirrors the core helper');
  } finally {
    unmount(rtl);
    unmount(mixed);
  }
});

test('caretForOffset keeps hard-break gaps on the preceding line and soft wraps on the following line', async (t) => {
  const font = await loadFont();
  const newline = await mount(t, font, 'ab\ncd');
  const crlf = await mount(t, font, 'ab\r\ncd');
  const trailing = await mount(t, font, 'ab\n');
  const wrapped = await mount(t, font, 'alpha beta gamma', {
    constraints: { width: { mode: 'exact', size: 50 } },
    layout: { wrap: 'word' },
  });
  try {
    const newlinePlacements = placementsOf(newline.node);
    const newlineEnd = newlinePlacements.caretForOffset(2);
    assert.equal(newlineEnd.line, 0);
    assert.equal(newlineEnd.offset, 2);
    assert.equal(newlineEnd.leading, false);
    assert.deepEqual(newlineEnd, newlinePlacements.caretAt(1_000, newlinePlacements.lines[0].baseline));
    assert.equal(newlinePlacements.caretForOffset(3).line, 1, 'the offset after LF starts the following line');

    const crlfPlacements = placementsOf(crlf.node);
    const crlfEnd = crlfPlacements.caretForOffset(2);
    assert.equal(crlfEnd.line, 0);
    assert.deepEqual(
      crlfPlacements.caretForOffset(3),
      crlfEnd,
      'both UTF-16 offsets within a CRLF gap pin to the preceding line end',
    );
    assert.equal(crlfPlacements.caretForOffset(4).line, 1, 'the offset after CRLF starts the following line');

    const trailingPlacements = placementsOf(trailing.node);
    assert.equal(trailingPlacements.caretForOffset(2).line, 0, 'the offset before trailing LF ends the text line');
    const afterTrailingNewline = trailingPlacements.caretForOffset(3);
    assert.equal(afterTrailingNewline.line, 1);
    assert.equal(afterTrailingNewline.offset, 3);
    assert.equal(afterTrailingNewline.leading, true);

    const wrappedPlacements = placementsOf(wrapped.node);
    assert.ok(wrappedPlacements.lines.length > 1, 'the real Inter fixture must wrap');
    const softBoundary = wrappedPlacements.lines[0].textEnd;
    assert.equal(softBoundary, wrappedPlacements.lines[1].textStart, 'the fixture boundary must be a soft wrap');
    const softCaret = wrappedPlacements.caretForOffset(softBoundary);
    assert.equal(softCaret.line, 1);
    assert.equal(softCaret.offset, softBoundary);
    assert.equal(softCaret.leading, true);
  } finally {
    unmount(newline);
    unmount(crlf);
    unmount(trailing);
    unmount(wrapped);
  }
});

test('caretForOffset pins interior UTF-16 offsets to their owning cluster and rejects invalid ranges', async (t) => {
  const font = await loadFont();
  const astral = await mount(t, font, 'A😀b');
  const combining = await mount(t, font, 'e\u0301x');
  try {
    const astralPlacements = placementsOf(astral.node);
    assert.deepEqual(
      astralPlacements.caretForOffset(2),
      astralPlacements.caretForOffset(1),
      'an offset inside a surrogate pair pins to the emoji cluster leading edge',
    );

    const combiningPlacements = placementsOf(combining.node);
    assert.deepEqual(
      combiningPlacements.caretForOffset(1),
      combiningPlacements.caretForOffset(0),
      'an offset inside a combining sequence pins to its owning cluster leading edge',
    );

    for (const offset of [-1, 0.5, astral.node.text.length + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => astralPlacements.caretForOffset(offset), RangeError);
    }
    const astralLayout = astral.node.glyphs();
    assert.throws(
      () => createGlyphPlacements(astralLayout, '', astralLayout.x, astralLayout.y, []),
      /paragraph text does not cover/,
      'a public caller cannot pair a real inspection with text shorter than its ranges',
    );
  } finally {
    unmount(astral);
    unmount(combining);
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

test('split carries stable line and word metadata without presentation overrides', async (t) => {
  const mounted = await mount(t, await loadFont(), 'one two three', {
    constraints: { width: { mode: 'exact', size: 60 } },
    layout: { wrap: 'word' },
  });
  let glyphs;
  try {
    [glyphs] = mounted.node.split();
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

test('detached glyph keys survive movement-only reflow and change when text reshapes', async (t) => {
  const mounted = await mount(t, await loadFont(), 'ABCD');
  let before;
  let resized;
  let reshaped;
  try {
    [before] = mounted.node.split();
    const beforeKeys = Array.from({ length: before.count }, (_, index) => before.glyphAt(index)?.key);
    const beforeX = before.measurements.map((measurement) => measurement.originalMatrix.elements[12]);

    mounted.node.style = { fontSize: 32 };
    mounted.scene.updateMatrixWorld(true);
    [resized] = mounted.node.split();
    const resizedKeys = Array.from({ length: resized.count }, (_, index) => resized.glyphAt(index)?.key);
    assert.deepEqual(resizedKeys, beforeKeys, 'a font-size reflow moves the same glyph identities');
    assert.ok(
      resized.measurements.some((measurement, index) => measurement.originalMatrix.elements[12] !== beforeX[index]),
      'the movement-only reflow must actually reposition at least one glyph',
    );

    mounted.node.text = 'WXYZ';
    mounted.scene.updateMatrixWorld(true);
    [reshaped] = mounted.node.split();
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
    assert.throws(() => node.split(), /before its renderer state is committed/);
    scene.add(node);
    assert.equal(node.commitState().status, 'pending');
    assert.throws(() => node.split(), /before its renderer state is committed/);
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
