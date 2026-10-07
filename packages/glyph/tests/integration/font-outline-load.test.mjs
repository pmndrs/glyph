import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

import { bitmap } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';

import { getRegisteredFontData } from '../../dist/internal/registered-font.js';
import { immutableFontResources } from '../../dist/loaded-font.js';
import { createFontLibrary, GlyphFontError, loadFont } from '../../dist/loader.js';
import { createThreeTestHandle } from '../support/three-handle.mjs';

const raster = bitmap({ strikes: [16] });
const baked = /baked without outlines; outlines need a font prebaked with glyph bake --outlines/;
const skippedMessage = /outlines were skipped when it loaded/;

let root;
const bytes = {};

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-outline-load-'));
  const input = new URL('../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
  const rasters = [{ baker: bitmapBaker, packaging: { artifact: 'embedded' }, options: { strikes: [16] } }];
  for (const [name, outlines] of [
    ['outlined', true],
    ['plain', false],
  ]) {
    const output = join(root, `${name}.font.glb`);
    await bakeFont({ input, output, font: { fontFaceIndex: 0, outlines }, rasters });
    bytes[name] = await readFile(output);
  }
});

after(() => rm(root, { recursive: true, force: true }));

const input = (name) => ({ baked: { bytes: bytes[name], ownership: 'copy' } });
const dataOf = (font) => getRegisteredFontData(immutableFontResources(font).font);

/** What a caller sees: the first glyph's outline, or the error that read throws. */
async function readFirstOutline(t, font) {
  const three = await createThreeTestHandle(t);
  const text = three.createText({ font, text: 'H' });
  try {
    return text.glyphs().outlineAt(0);
  } catch (error) {
    return error;
  } finally {
    text.dispose();
  }
}

test('a default load decodes the outlines a font carries', async (t) => {
  const font = await loadFont(input('outlined'), raster);
  assert.ok(dataOf(font).glyphOutlines !== undefined);
  const outline = await readFirstOutline(t, font);
  assert.ok(Array.isArray(outline) && outline.length > 0);
  font.dispose();
});

test('a default load of a font without outlines succeeds and reads throw the baked-without message', async (t) => {
  const font = await loadFont(input('plain'), raster);
  assert.equal(dataOf(font).glyphOutlines, undefined);
  assert.equal(dataOf(font).glyphOutlinesSkipped, undefined);
  const error = await readFirstOutline(t, font);
  assert.ok(error instanceof TypeError);
  assert.match(error.message, baked);
  font.dispose();
});

test("outlines: 'auto' is the default", async () => {
  const font = await loadFont(input('outlined'), raster, { outlines: 'auto' });
  assert.ok(dataOf(font).glyphOutlines !== undefined);
  font.dispose();
});

test("outlines: 'skip' decodes and retains nothing, and a read says the outlines were skipped", async (t) => {
  const font = await loadFont(input('outlined'), raster, { outlines: 'skip' });
  assert.equal(dataOf(font).glyphOutlines, undefined);
  const error = await readFirstOutline(t, font);
  assert.ok(error instanceof TypeError);
  assert.match(error.message, skippedMessage);
  font.dispose();
});

test("outlines: 'skip' on a font without outlines keeps the baked-without message", async (t) => {
  const font = await loadFont(input('plain'), raster, { outlines: 'skip' });
  const error = await readFirstOutline(t, font);
  assert.match(error.message, baked);
  font.dispose();
});

test("outlines: 'require' rejects a font without outlines with FONT_OUTLINES_UNAVAILABLE", async () => {
  await assert.rejects(loadFont(input('plain'), raster, { outlines: 'require' }), (error) => {
    assert.ok(error instanceof GlyphFontError);
    assert.equal(error.reason, 'FONT_OUTLINES_UNAVAILABLE');
    assert.equal(error.code, 'resource-unavailable');
    return true;
  });
});

test("outlines: 'require' rejects a baked URL without outlines as itself, not as an invalid asset", async () => {
  const library = createFontLibrary({
    fetch: async () => new Response(Uint8Array.from(bytes.plain)),
  });
  const url = 'https://fonts.test/plain.font.glb';
  await assert.rejects(library.loadFont({ baked: url }, raster, { outlines: 'require' }), (error) => {
    assert.ok(error instanceof GlyphFontError);
    assert.equal(error.reason, 'FONT_OUTLINES_UNAVAILABLE');
    assert.equal(error.url, url);
    return true;
  });
  const font = await library.loadFont({ baked: url }, raster);
  assert.equal(dataOf(font).glyphOutlines, undefined, 'a rejected require leaves nothing that breaks a later load');
  font.dispose();
  library.dispose();
});

test("outlines: 'require' loads a font with outlines", async (t) => {
  const font = await loadFont(input('outlined'), raster, { outlines: 'require' });
  assert.ok(dataOf(font).glyphOutlines !== undefined);
  assert.ok(Array.isArray(await readFirstOutline(t, font)));
  font.dispose();
});

test("a later 'auto' or 'require' load adds outlines to the font an earlier 'skip' load left without them", async (t) => {
  for (const later of ['auto', 'require']) {
    const skipped = await loadFont(input('outlined'), raster, { outlines: 'skip' });
    assert.match((await readFirstOutline(t, skipped)).message, skippedMessage);
    const attached = await loadFont(input('outlined'), raster, { outlines: later });
    assert.equal(dataOf(attached), dataOf(skipped), 'one font backs both loads');
    assert.ok(dataOf(skipped).glyphOutlines !== undefined, `${later} attached outlines`);
    assert.equal(dataOf(skipped).glyphOutlinesSkipped, undefined);
    assert.ok(Array.isArray(await readFirstOutline(t, skipped)), 'the earlier font reads them too');
    skipped.dispose();
    attached.dispose();
  }
});

test("a later 'skip' load never removes outlines a font already has", async (t) => {
  const first = await loadFont(input('outlined'), raster);
  const store = dataOf(first).glyphOutlines;
  const skipping = await loadFont(input('outlined'), raster, { outlines: 'skip' });
  assert.equal(dataOf(skipping), dataOf(first));
  assert.equal(dataOf(first).glyphOutlines, store);
  assert.equal(dataOf(first).glyphOutlinesSkipped, undefined);
  assert.ok(Array.isArray(await readFirstOutline(t, skipping)));
  first.dispose();
  skipping.dispose();
});

test('concurrent loads with different outline modes converge on one font with outlines, in either order', async () => {
  for (const modes of [
    ['skip', 'auto'],
    ['auto', 'skip'],
  ]) {
    const fonts = await Promise.all(modes.map((outlines) => loadFont(input('outlined'), raster, { outlines })));
    assert.equal(dataOf(fonts[0]), dataOf(fonts[1]));
    assert.ok(dataOf(fonts[0]).glyphOutlines !== undefined, modes.join(' then '));
    for (const font of fonts) font.dispose();
  }
});

test('an unknown outlines value or option key is a TypeError naming what is allowed', () => {
  for (const outlines of ['always', true, null, 1]) {
    assert.throws(
      () => loadFont(input('outlined'), raster, { outlines }),
      (error) => error instanceof TypeError && /'auto', 'require', 'skip'/.test(error.message),
      String(outlines),
    );
  }
  const library = createFontLibrary();
  assert.throws(() => library.loadFont(input('outlined'), raster, { outlines: 'nope' }), /'auto', 'require', 'skip'/);
  assert.throws(
    () => library.loadFont(input('outlined'), raster, { outline: 'skip' }),
    /only accept signal and outlines/,
  );
  library.dispose();
});
