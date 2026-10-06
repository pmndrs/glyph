import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

import { bitmap, createFontStack, glyph, slug } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { slugBaker } from '@pmndrs/glyph/bakers/slug';
import { ThreeConfig } from '@pmndrs/glyph/three';

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
  text.dispose();
  font.dispose();
});
