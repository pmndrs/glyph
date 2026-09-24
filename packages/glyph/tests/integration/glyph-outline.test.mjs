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

function readOutlines(text) {
  return text.withGlyphs((glyphs) =>
    Array.from({ length: glyphs.glyphCount }, (_, index) => ({
      glyph: glyphs.glyphAt(index),
      outline: glyphs.outlineAt(index),
    })),
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
      assert.ok(curve.every(Number.isFinite));
      assert.deepEqual(contour[(index + 1) % contour.length].slice(0, 2), curve.slice(4));
    });
  }
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
}

test('every TrueType glyph outlines exactly the ink box the layout reports for it', async (t) => {
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
    const box = controlBox(outline);
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

test('every CFF curve ends inside the glyph ink box', async (t) => {
  const three = await createHandle(t);
  const font = await load(bakes.dancingScript);
  const text = three.createText({ font, text: 'Dancing Script, flowing curves' });
  let drawn = 0;
  for (const { glyph: record, outline } of readOutlines(text)) {
    if (record.inkWidth === 0) continue;
    assertClosed(outline);
    const tolerance = record.fontSize * 1e-5;
    for (const curve of outline.flat()) {
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
  const box = controlBox(globe.outline);
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
      const outline = glyphs.outlineAt(index);
      engineMemory.grow(1);
      return { glyph: glyphs.glyphAt(index), outline };
    }),
  );
  assert.deepEqual(readOutlines(text), first);
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
  assert.throws(
    () => text.withGlyphs((glyphs) => glyphs.outlineAt(0)),
    /baked without outlines; bake it with --outlines/,
  );
  text.dispose();
  font.dispose();
});
