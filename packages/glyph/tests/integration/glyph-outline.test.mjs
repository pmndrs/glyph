import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

import { bitmap, createFontStack, glyph, slug } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { slugBaker } from '@pmndrs/glyph/bakers/slug';
import { defineTextMaterial, ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import { loadFont } from '../../dist/loader.js';

let root;
let engineMemory;
let handleOrdinal = 1;
const bakes = {};

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-outline-'));
  const bitmapPlan = { baker: bitmapBaker, packaging: { artifact: 'embedded' }, options: { strikes: [16] } };
  const bake = async (name, font, outlines, rasters = [bitmapPlan]) => {
    const output = join(root, `${name}.font.glb`);
    const input = new URL(`../../../../benches/fixtures/fonts/${font}`, import.meta.url);
    await bakeFont({ input, output, font: { fontFaceIndex: 0, outlines }, rasters });
    bakes[name] = await readFile(output);
  };
  await Promise.all([
    bake('inter', 'inter-v4.1/Inter-Regular.ttf', true, [
      bitmapPlan,
      { baker: slugBaker, packaging: { artifact: 'embedded' } },
    ]),
    bake('interPlain', 'inter-v4.1/Inter-Regular.ttf', false),
    bake('dancingScript', 'dancing-script-3.000/DancingScript-Regular.otf', true),
    bake('icons', 'font-awesome-free-6.7.2/fa-solid-900.ttf', true),
  ]);
});

after(() => rm(root, { recursive: true, force: true }));

async function createHandle(t) {
  if (engineMemory === undefined) {
    const instantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = async (...args) => {
      const result = await instantiate(...args);
      engineMemory ??= (result.instance ?? result).exports.memory;
      return result;
    };
    try {
      await glyph.init();
    } finally {
      WebAssembly.instantiate = instantiate;
    }
  }
  const handle = glyph.handle(`outline:case:${String(handleOrdinal++)}`, ThreeConfig);
  t.after(() => handle.dispose());
  return handle;
}

function load(bytes, format = bitmap({ strikes: [16] })) {
  return loadFont({ baked: { bytes, ownership: 'copy' } }, format);
}

/** The documented view layout, read independently: segment s of contour c uses points 2s + c through 2s + c + 2. */
function curvesOf(view) {
  const { points, contourEnds, segmentLines } = view;
  const contours = [];
  let segment = 0;
  for (let contour = 0; contour < contourEnds.length; contour += 1) {
    const curves = [];
    for (; segment < contourEnds[contour]; segment += 1) {
      const point = 2 * segment + contour;
      curves.push([...points.subarray(2 * point, 2 * point + 6), segmentLines[segment] === 1]);
    }
    contours.push(curves);
  }
  return contours;
}

/** Copies every glyph record and borrowed outline view while the callback is live. */
function readOutlines(text) {
  return text.withGlyphs((glyphs) =>
    Array.from({ length: glyphs.glyphCount }, (_, index) => {
      const view = glyphs.outlineAt(index);
      return {
        glyph: glyphs.glyphAt(index),
        view: {
          fontHandle: view.fontHandle,
          glyphId: view.glyphId,
          points: view.points.slice(),
          contourEnds: view.contourEnds.slice(),
          segmentLines: view.segmentLines.slice(),
        },
        outline: curvesOf(view),
      };
    }),
  );
}

/** Places em-space curves at a glyph's pen position and size, as the API documents. */
function placed(outline, record) {
  return outline.map((contour) =>
    contour.map(([x0, y0, cx, cy, x1, y1, isLine]) => [
      record.x + x0 * record.fontSize,
      record.y + y0 * record.fontSize,
      record.x + cx * record.fontSize,
      record.y + cy * record.fontSize,
      record.x + x1 * record.fontSize,
      record.y + y1 * record.fontSize,
      isLine,
    ]),
  );
}

function controlBox(outline) {
  const xs = outline.flat().flatMap((curve) => [curve[0], curve[2], curve[4]]);
  const ys = outline.flat().flatMap((curve) => [curve[1], curve[3], curve[5]]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function assertClosed(outline) {
  for (const contour of outline) {
    assert.ok(contour.length > 0);
    contour.forEach((curve, index) => {
      assert.ok(curve.slice(0, 6).every(Number.isFinite));
      assert.equal(typeof curve[6], 'boolean');
      assert.deepEqual(contour[(index + 1) % contour.length].slice(0, 2), curve.slice(4, 6));
    });
  }
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
}

test('every TrueType glyph, placed at its pen position and size, outlines exactly its ink box', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.inter);
  const text = three.createText({ font, text: 'Outlines Oxfij 1234, quick & bold!' });
  let drawn = 0;
  for (const { glyph: record, outline } of readOutlines(text)) {
    if (record.inkWidth === 0) {
      assert.deepEqual(outline, []);
      continue;
    }
    assertClosed(outline);
    const box = controlBox(placed(outline, record));
    const tolerance = record.fontSize * 1e-5;
    assertNear(box.minX, record.inkX, tolerance, 'left');
    assertNear(box.minY, record.inkY, tolerance, 'top');
    assertNear(box.maxX, record.inkX + record.inkWidth, tolerance, 'right');
    assertNear(box.maxY, record.inkY + record.inkHeight, tolerance, 'bottom');
    drawn += 1;
  }
  assert.ok(drawn > 20);
  text.dispose();
  font.dispose();
});

test('an outline is in em units with y down and its origin at the pen position on the baseline', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.inter);
  const small = three.createText({ font, text: 'H', style: { fontSize: 16 } });
  const large = three.createText({ font, text: 'H', style: { fontSize: 64 } });
  const [smallRead] = readOutlines(small);
  const [largeRead] = readOutlines(large);
  assert.deepEqual(largeRead.view, smallRead.view, 'an outline does not depend on font size');
  const box = controlBox(smallRead.outline);
  const { glyph: record } = smallRead;
  // H stands on the baseline and rises above it, so its em box ends at y = 0 and starts above, at negative y.
  assert.equal(box.maxY, 0);
  assert.ok(box.minY < -0.5 && box.minY > -1, `cap height ${-box.minY} em`);
  assert.ok(box.minX > 0 && box.maxX < record.advance / record.fontSize, 'ink sits inside the advance');
  assertNear(box.minX, (record.inkX - record.x) / record.fontSize, 1e-6, 'left');
  assertNear(box.minY, (record.inkY - record.y) / record.fontSize, 1e-6, 'top');
  assertNear(box.maxX, (record.inkX + record.inkWidth - record.x) / record.fontSize, 1e-6, 'right');
  assertNear(box.maxY, (record.inkY + record.inkHeight - record.y) / record.fontSize, 1e-6, 'bottom');
  small.dispose();
  large.dispose();
  font.dispose();
});

test('a borrowed view shares endpoints, ends contours by segment, and flags each segment', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.dancingScript);
  const latin = await load(bakes.inter);
  const texts = [
    three.createText({ font: latin, text: 'Outlines HIL o 8 & @' }),
    three.createText({ font, text: 'Dancing Script, flowing curves' }),
  ];
  let lines = 0;
  let curves = 0;
  for (const text of texts) {
    for (const { glyph: record, view } of readOutlines(text)) {
      const { points, contourEnds, segmentLines } = view;
      assert.equal(view.fontHandle, record.fontHandle);
      assert.equal(view.glyphId, record.glyphId);
      assert.ok(points instanceof Float32Array && contourEnds instanceof Uint32Array);
      assert.ok(segmentLines instanceof Uint8Array);
      const segments = segmentLines.length;
      assert.equal(points.length, 2 * (2 * segments + contourEnds.length), 'point count');
      assert.equal(contourEnds.at(-1) ?? 0, segments, 'the last contour ends at the segment count');
      let start = 0;
      contourEnds.forEach((end, contour) => {
        assert.ok(end > start, 'every contour has a segment');
        const first = 2 * (2 * start + contour);
        const last = 2 * (2 * end + contour);
        assert.deepEqual([points[last], points[last + 1]], [points[first], points[first + 1]], 'contour closes');
        start = end;
      });
      for (const flag of segmentLines) {
        assert.ok(flag === 0 || flag === 1);
        lines += flag;
        curves += 1 - flag;
      }
    }
    text.dispose();
  }
  assert.ok(lines > 20 && curves > 20, `${lines} lines, ${curves} curves`);
  font.dispose();
  latin.dispose();
});

test('a line segment keeps its midpoint as its control', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.inter);
  const text = three.createText({ font, text: 'I' });
  const [{ outline }] = readOutlines(text);
  assert.equal(outline.length, 1, 'I is one rectangle');
  assert.equal(outline[0].length, 4);
  for (const [x0, y0, cx, cy, x1, y1, isLine] of outline[0]) {
    assert.equal(isLine, true);
    assertNear(cx, (x0 + x1) / 2, 1e-7, 'control x');
    assertNear(cy, (y0 + y1) / 2, 1e-7, 'control y');
  }
  text.dispose();
  font.dispose();
});

test('a target is refilled with new views and returned', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.inter);
  const text = three.createText({ font, text: 'Ho' });
  text.withGlyphs((glyphs) => {
    const target = {
      fontHandle: 0,
      glyphId: 0,
      points: new Float32Array(0),
      contourEnds: new Uint32Array(0),
      segmentLines: new Uint8Array(0),
    };
    const fresh = glyphs.outlineAt(0);
    const expected = curvesOf(fresh);
    assert.equal(glyphs.outlineAt(0, target), target);
    assert.deepEqual(curvesOf(target), expected);
    assert.equal(target.glyphId, glyphs.glyphAt(0).glyphId);
    const firstPoints = target.points;
    assert.equal(glyphs.outlineAt(1, target), target);
    assert.notEqual(target.points, firstPoints, 'typed-array views are created on every call');
    assert.equal(target.glyphId, glyphs.glyphAt(1).glyphId);
    assert.notDeepEqual(curvesOf(target), expected);
  });
  text.dispose();
  font.dispose();
});

test('owned outlines from glyphs() equal the borrowed views as curve tuples', async (t) => {
  const three = await createHandle(t);
  const [latin, icon, script] = await Promise.all([load(bakes.inter), load(bakes.icons), load(bakes.dancingScript)]);
  const texts = [
    three.createText({ font: createFontStack(latin, icon), text: `Owned I ${String.fromCodePoint(0xf0ac)} 8` }),
    three.createText({ font: script, text: 'Script curves' }),
  ];
  for (const text of texts) {
    const borrowed = readOutlines(text);
    const layout = text.glyphs();
    assert.equal(layout.glyphCount, borrowed.length);
    borrowed.forEach(({ outline }, index) => assert.deepEqual(layout.outlineAt(index), outline, `glyph ${index}`));
    assert.notEqual(layout.outlineAt(0), layout.outlineAt(0), 'each call returns a new outer array');
    const [first] = layout.outlineAt(0);
    if (first !== undefined) {
      assert.equal(layout.outlineAt(0)[0], first, 'equal glyphs share one frozen contour');
      assert.ok(Object.isFrozen(first) && Object.isFrozen(first[0]), 'shared contours and curves are frozen');
    }
    assert.equal(Object.keys(layout).includes('outlineAt'), false, 'the columns stay plain data');
    assert.deepEqual(structuredClone(layout).glyphIds, layout.glyphIds);
    assert.throws(() => layout.outlineAt(layout.glyphCount), RangeError);
    assert.throws(() => layout.outlineAt(-1), RangeError);
    text.withGlyphs((glyphs) => {
      assert.throws(() => glyphs.outlineAt(glyphs.glyphCount), RangeError);
      assert.throws(() => glyphs.outlineAt(-1), RangeError);
    });
    text.dispose();
  }
  latin.dispose();
  icon.dispose();
  script.dispose();
});

test('every CFF curve ends inside the glyph ink box', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.dancingScript);
  const text = three.createText({ font, text: 'Dancing Script, flowing curves' });
  let drawn = 0;
  for (const { glyph: record, outline } of readOutlines(text)) {
    if (record.inkWidth === 0) continue;
    assertClosed(outline);
    const tolerance = record.fontSize * 1e-5;
    for (const curve of placed(outline, record).flat()) {
      assert.ok(curve[4] >= record.inkX - tolerance && curve[4] <= record.inkX + record.inkWidth + tolerance);
      assert.ok(curve[5] >= record.inkY - tolerance && curve[5] <= record.inkY + record.inkHeight + tolerance);
    }
    drawn += 1;
  }
  assert.ok(drawn > 20);
  text.dispose();
  font.dispose();
});

test('a fallback glyph decodes from the font that shaped it', async (t) => {
  const three = await createHandle(t);
  const [latin, icon] = await Promise.all([load(bakes.inter), load(bakes.icons)]);
  const text = three.createText({ font: createFontStack(latin, icon), text: `Globe ${String.fromCodePoint(0xf0ac)}` });
  const read = readOutlines(text);
  const globe = read.at(-1);
  assert.notEqual(globe.glyph.fontHandle, read[0].glyph.fontHandle);
  assert.equal(globe.view.fontHandle, globe.glyph.fontHandle);
  const box = controlBox(placed(globe.outline, globe.glyph));
  const tolerance = globe.glyph.fontSize * 1e-5;
  assertNear(box.minX, globe.glyph.inkX, tolerance, 'left');
  assertNear(box.maxY, globe.glyph.inkY + globe.glyph.inkHeight, tolerance, 'bottom');
  text.dispose();
  latin.dispose();
  icon.dispose();
});

test('a repeated read returns the same outlines, even when a decode grows engine memory', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.inter);
  const text = three.createText({ font, text: 'Growing memory' });
  const first = text.withGlyphs((glyphs) =>
    Array.from({ length: glyphs.glyphCount }, (_, index) => {
      const outline = curvesOf(glyphs.outlineAt(index));
      engineMemory.grow(1);
      return { glyph: glyphs.glyphAt(index), outline };
    }),
  );
  assert.deepEqual(
    readOutlines(text).map(({ glyph: record, outline }) => ({ glyph: record, outline })),
    first,
  );
  text.dispose();
  font.dispose();
});

test('every raster format reads the same outlines', async (t) => {
  const three = await createHandle(t);
  const [bitmapFont, slugFont] = await Promise.all([load(bakes.inter), load(bakes.inter, slug)]);
  const bitmapText = three.createText({ font: bitmapFont, text: 'Same outline' });
  const slugText = three.createText({ font: slugFont, text: 'Same outline' });
  assert.deepEqual(
    readOutlines(slugText).map(({ outline }) => outline),
    readOutlines(bitmapText).map(({ outline }) => outline),
  );
  bitmapText.dispose();
  slugText.dispose();
  bitmapFont.dispose();
  slugFont.dispose();
});

test('a glyph whose font was baked without outlines throws at the call', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.interPlain);
  const text = three.createText({ font, text: 'Plain' });
  const message = /baked without outlines; outlines need a font prebaked with glyph bake --outlines/;
  assert.throws(() => text.withGlyphs((glyphs) => glyphs.outlineAt(0)), message);
  assert.throws(() => text.glyphs().outlineAt(0), message);
  text.dispose();
  font.dispose();
});

test('owned outlines are data: they read inside a render plan, after it, and after their font is disposed', async (t) => {
  const three = await createHandle(t);
  const [outlined, drawnFont] = await Promise.all([load(bakes.inter), load(bakes.interPlain)]);
  const probe = three.createText({ font: outlined, text: 'Owned' });
  const layout = probe.glyphs();
  const expected = layout.outlineAt(0);
  let duringPlan;
  const material = defineTextMaterial((context) => {
    try {
      duringPlan = layout.outlineAt(0);
    } catch (error) {
      duringPlan = error;
    }
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({ font: drawnFont, material, text: 'Drawn' });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  assert.deepEqual(duringPlan, expected, 'a read inside a material callback makes no engine call');
  assert.deepEqual(layout.outlineAt(0), expected, 'the copy reads after a render pass releases unused fonts');
  probe.dispose();
  outlined.dispose();
  assert.deepEqual(layout.outlineAt(0), expected, 'the copy reads after its Text and font are disposed');
  label.dispose();
  drawnFont.dispose();
});

const outlinesOf = (glyphs) => Array.from({ length: glyphs.count }, (_, index) => glyphs.outlineAt(index));

/** Mounts `text` so its layout commits, then splits it; the caller disposes the returned pieces. */
function splitMounted(three, font, content) {
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const text = three.createText({ font, text: content });
  scene.add(group);
  group.add(text);
  scene.updateMatrixWorld(true);
  const [glyphs] = text.split();
  return { group, text, glyphs };
}

function dispose({ group, text, glyphs }) {
  glyphs.dispose();
  text.dispose();
  group.dispose();
}

test('Glyphs uses dense drawable indices and skips blanks while preserving source outlines', async (t) => {
  const three = await createHandle(t);
  const [latin, icon] = await Promise.all([load(bakes.inter), load(bakes.icons)]);
  const mounted = splitMounted(three, createFontStack(latin, icon), `  A b${String.fromCodePoint(0xf0ac)} I`);
  try {
    const { glyphs, text } = mounted;
    const layout = text.glyphs();
    const sourceIndices = Array.from({ length: layout.glyphCount }, (_, index) => index).filter(
      (index) => layout.outlineAt(index).length > 0,
    );
    assert.equal(glyphs.count, 4, 'only the four visible glyphs are detached');
    assert.ok(glyphs.count < layout.glyphCount, 'blank source glyphs are excluded');
    assert.equal(glyphs.measurements.length, glyphs.count);
    for (let index = 0; index < glyphs.count; index += 1) {
      const detached = glyphs.glyphAt(index);
      const sourceIndex = sourceIndices[index];
      assert.equal(detached.index, index);
      assert.equal(glyphs.measurements[index].index, index);
      assert.equal('sourceIndex' in detached, false);
      assert.equal('drawn' in detached, false);
      assert.deepEqual(glyphs.outlineAt(index), layout.outlineAt(sourceIndex), `drawable glyph ${index}`);
      assert.ok(glyphs.outlineAt(index).length > 0);
      assert.equal(detached.glyphId, layout.glyphIds[sourceIndex]);
      assert.equal(detached.fontHandle, layout.fontHandles[layout.glyphFontSlots[sourceIndex]]);
    }
    assert.notEqual(glyphs.outlineAt(0), glyphs.outlineAt(0), 'each call returns a new outer array');
  } finally {
    dispose(mounted);
    latin.dispose();
    icon.dispose();
  }
});

test('Glyphs.outlineAt keeps reading after the source re-lays out and after the font is disposed', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.inter);
  const mounted = splitMounted(three, font, ' Hi o');
  try {
    const { glyphs, text } = mounted;
    const captured = outlinesOf(glyphs);
    text.text = 'Wxyz Q';
    text.parent.parent.updateMatrixWorld(true);
    assert.notEqual(text.glyphs().glyphCount, glyphs.count);
    assert.deepEqual(outlinesOf(glyphs), captured, 'a re-layout of the source does not change a detached glyph');
    font.dispose();
    assert.deepEqual(outlinesOf(glyphs), captured, 'the font is not needed to read an outline');
    const count = glyphs.count;
    glyphs.dispose();
    assert.deepEqual(
      glyphs.outlineAt(count - 1),
      captured.at(-1),
      'a disposed Glyphs object still reads, like glyphAt',
    );
  } finally {
    dispose(mounted);
  }
});

test('Glyphs.outlineAt rejects an index that is not a glyph of the object', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.inter);
  const mounted = splitMounted(three, font, ' Hi');
  try {
    const { glyphs } = mounted;
    for (const index of [-1, glyphs.count, glyphs.count + 1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => glyphs.outlineAt(index), RangeError, String(index));
      assert.throws(() => glyphs.glyphAt(index), RangeError, `glyphAt ${String(index)}`);
      assert.throws(() => glyphs.getMatrixAt(index, new THREE.Matrix4()), RangeError, `getMatrixAt ${String(index)}`);
      assert.throws(() => glyphs.setMatrixAt(index, new THREE.Matrix4()), RangeError, `setMatrixAt ${String(index)}`);
    }
  } finally {
    dispose(mounted);
    font.dispose();
  }
});

test('Glyphs.outlineAt throws the missing-outline error for a font without outlines', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.interPlain);
  const mounted = splitMounted(three, font, ' Plain');
  try {
    assert.throws(
      () => mounted.glyphs.outlineAt(0),
      new TypeError('font was baked without outlines; outlines need a font prebaked with glyph bake --outlines'),
    );
  } finally {
    dispose(mounted);
    font.dispose();
  }
});

test('a leading space is skipped and dense matrix index zero moves the following drawable glyph', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.inter);
  const mounted = splitMounted(three, font, ' H');
  try {
    const { glyphs, text } = mounted;
    assert.equal(glyphs.count, 1);
    assert.ok(glyphs.outlineAt(0).length > 0);
    const rest = new THREE.Matrix4();
    glyphs.getMatrixAt(0, rest);
    assert.equal(glyphs.measurements[0].index, 0);
    assert.equal(glyphs.glyphAt(0).cluster, 1, 'the only detached glyph is the H after the space');
    assert.deepEqual(rest.elements, text.measureGlyphs()[1].originalMatrix.elements);
    const draw = glyphs.children.find((child) => child.isMesh);
    const transforms = draw.geometry.getAttribute('_pmndrsGlyphInstanceTransforms');
    const version = transforms.version;
    const moved = new THREE.Matrix4().makeTranslation(5, 6, 7);
    glyphs.setMatrixAt(0, moved);
    const read = new THREE.Matrix4();
    glyphs.getMatrixAt(0, read);
    assert.deepEqual(read.elements, moved.elements);
    assert.ok(transforms.version > version, 'dense index zero updates the H render record');
    assert.throws(() => glyphs.setMatrixAt(1, moved), RangeError);
  } finally {
    dispose(mounted);
    font.dispose();
  }
});

test('a detached glyph names its shape by fontHandle and glyphId, apart from its index and key', async (t) => {
  const three = await createHandle(t);
  const [latin, icon] = await Promise.all([load(bakes.inter), load(bakes.icons)]);
  const globe = String.fromCodePoint(0xf0ac);
  const mounted = splitMounted(three, createFontStack(latin, icon), ` a b a ${globe}`);
  try {
    const { glyphs, text } = mounted;
    const layout = text.glyphs();
    const at = (index) => glyphs.glyphAt(index);
    const sourceIndices = [1, 3, 5, 7];
    assert.equal(glyphs.count, sourceIndices.length);
    for (let index = 0; index < glyphs.count; index += 1) {
      const sourceIndex = sourceIndices[index];
      assert.equal(typeof at(index).fontHandle, 'number');
      assert.equal(at(index).fontHandle, layout.fontHandles[layout.glyphFontSlots[sourceIndex]], `fontHandle ${index}`);
      assert.equal(at(index).glyphId, layout.glyphIds[sourceIndex], `glyphId ${index}`);
    }
    const [firstA, b, secondA] = [at(0), at(1), at(2)];
    assert.equal(firstA.fontHandle, secondA.fontHandle);
    assert.equal(firstA.glyphId, secondA.glyphId);
    assert.notEqual(firstA.key, secondA.key, 'one shape, two occurrences');
    assert.notEqual(firstA.glyphId, b.glyphId, 'different letters are different shapes');
    assert.deepEqual(glyphs.outlineAt(firstA.index), glyphs.outlineAt(secondA.index), 'one shape, one outline');
    const globeGlyph = at(glyphs.count - 1);
    assert.notEqual(globeGlyph.fontHandle, firstA.fontHandle, 'a fallback glyph comes from another font');
    assert.ok(Object.isFrozen(firstA) && !('fontId' in firstA));
  } finally {
    dispose(mounted);
    latin.dispose();
    icon.dispose();
  }
});
