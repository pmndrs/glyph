/**
 * The `aGlyphFacts` attribute of `@pmndrs/glyph/pixi3d`: every vertex of a glyph carries the index `glyphs()` reports
 * the glyph at and its pen origin, only for a recipe that declares the attribute on a handle that publishes it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Mesh3D } from '@pixi/3d';
import { bitmap, glyph, msdf, slug, span, txt } from '@pmndrs/glyph';
import { definePixi3DConfig, Pixi3DTextMaterial } from '@pmndrs/glyph/pixi3d';
import { gunzipSync } from 'node:zlib';

const fixtures = new URL('../../../../benches/fixtures/rendering/', import.meta.url);
/**
 * Amiri shapes Arabic and applies `liga` to Latin f-pairs. Its MSDF artifact is larger than the loader accepts by
 * default, so MSDF runs the left-to-right half of the specimen with Inter.
 */
const SOURCES = {
  bitmap: { raster: bitmap({ strikes: [16] }), main: 'amiri-bitmap-16.font.glb' },
  msdf: { raster: msdf, main: 'inter-mtsdf.font.glb.gz' },
  slug: { raster: slug, main: 'amiri-slug.font.glb.gz' },
};
const ARABIC = 'سلام عليكم';
/** A recipe whose only purpose is to ask for the glyph facts. */
const factsBit = {
  name: 'testGlyphFacts',
  attributes: { aGlyphFacts: 'float32x4' },
  interStage: { vGlyphTestFacts: 'vec4<f32>' },
  gpu: { vertex: { end: 'output.vGlyphTestFacts = input.aGlyphFacts;' } },
  gl: { vertex: { end: 'vGlyphTestFacts = aGlyphFacts;' } },
};
async function load(format, name) {
  const source = SOURCES[format];
  const bytes = await readFile(new URL(source[name], fixtures));
  const font = glyph.fontFace(new Blob([source[name].endsWith('.gz') ? gunzipSync(bytes) : bytes]), {
    format: source.raster,
  });
  await font.load();
  return font;
}

/** Every glyph a text's meshes draw as `{ index, x, y }`, from the per-vertex attribute or the native material row. */
function drawnFacts(text) {
  const facts = [];
  for (const mesh of text.children.filter((child) => child instanceof Mesh3D)) {
    const attribute = mesh.geometry.attributes.aGlyphFacts;
    if (attribute === undefined) {
      const row = mesh.material.data.glyphRecordFacts;
      assert.ok(row, 'a native record carries the facts as its material row');
      facts.push({ index: row[2], x: row[0], y: row[1] });
      continue;
    }
    const values = attribute.buffer.data;
    for (let vertex = 0; vertex < values.length / 4; vertex += 4) {
      const corners = [0, 1, 2, 3].map((corner) => [
        ...values.subarray((vertex + corner) * 4, (vertex + corner) * 4 + 4),
      ]);
      for (const corner of corners)
        assert.deepEqual(corner, corners[0], 'a glyph is constant across its four vertices');
      facts.push({ index: corners[0][2], x: corners[0][0], y: corners[0][1] });
    }
  }
  return facts.toSorted((left, right) => left.index - right.index);
}

/** Holds the drawn facts to the inspection: exactly the glyphs with ink, each at its own index and pen origin. */
function assertFactsMatchInspection(text, where) {
  const layout = text.glyphs();
  const drawn = drawnFacts(text);
  const inked = [];
  for (let index = 0; index < layout.glyphCount; index += 1) {
    if (layout.glyphInkWidths[index] > 0 && layout.glyphInkHeights[index] > 0) inked.push(index);
  }
  assert.deepEqual(
    drawn.map((fact) => fact.index),
    inked,
    `${where}: the drawn indices are the inspection's inked glyphs`,
  );
  for (const fact of drawn) {
    assert.ok(Math.abs(fact.x - layout.x[fact.index]) < 1e-3, `${where}: origin x of glyph ${fact.index}`);
    assert.ok(Math.abs(fact.y + layout.y[fact.index]) < 1e-3, `${where}: origin y of glyph ${fact.index}`);
  }
  return { drawn, layout };
}

for (const format of Object.keys(SOURCES)) {
  test(`${format}: aGlyphFacts carries each glyph's layout index and pen origin`, async () => {
    await glyph.init({ wasm: await readFile(new URL('../../dist/text-shaper.wasm', import.meta.url)) });
    const handle = glyph.handle(`pixi3d:glyph-facts:${format}`, definePixi3DConfig({ glyphFacts: true }));
    const main = await load(format, 'main');
    const shapesArabic = SOURCES[format].main.startsWith('amiri');
    const material = () => new Pixi3DTextMaterial({ extraBits: [factsBit] });
    try {
      // Blanks are glyphs of the layout no mesh draws; in Amiri "ffi" is one glyph over three characters.
      const latin = handle.createText({ font: main, material: material(), text: 'To office' });
      // A right-to-left run between two left-to-right ones, over three lines.
      const body = shapesArabic ? ARABIC : 'middle words';
      const mixed = handle.createText({ font: main, material: material(), text: `ab ${body} cd\nsecond\n${body}` });
      // A span of another size is its own placement span and shares the text's one index sequence.
      const fonts = handle.createText({
        font: main,
        material: material(),
        text: txt`ab${span({ fontSize: 40 })`cd`}ef`,
      });
      // One character is a native material row instead of per-vertex attributes.
      const single = handle.createText({ font: main, material: material(), text: 'M' });
      glyph.shape();

      const { drawn: latinDrawn, layout: latinLayout } = assertFactsMatchInspection(latin, `${format} latin`);
      if (shapesArabic) {
        assert.deepEqual([...latinLayout.clusters], [0, 1, 2, 3, 4, 7, 8]);
        assert.deepEqual(
          latinDrawn.map((fact) => fact.index),
          [0, 1, 3, 4, 5, 6],
        );
      } else {
        assert.equal(latinDrawn.length, 8);
      }

      const { drawn: mixedDrawn, layout: mixedLayout } = assertFactsMatchInspection(mixed, `${format} mixed`);
      assert.equal(mixedLayout.lineCount, 3);
      const firstLine = mixedDrawn.filter((fact) => fact.index < mixedLayout.lineGlyphCounts[0]);
      // Visual order: indices ascend left to right, through a right-to-left run whose text runs backwards.
      assert.deepEqual(
        firstLine.map((fact) => fact.x),
        firstLine.map((fact) => fact.x).toSorted((left, right) => left - right),
      );
      if (shapesArabic) {
        const arabic = firstLine.filter((fact) => mixedLayout.glyphBidiLevels[fact.index] === 1);
        assert.ok(arabic.length >= 6);
        assert.deepEqual(
          arabic.map((fact) => mixedLayout.clusters[fact.index]),
          arabic.map((fact) => mixedLayout.clusters[fact.index]).toSorted((left, right) => right - left),
        );
      }

      const { drawn: fontsDrawn } = assertFactsMatchInspection(fonts, `${format} fonts`);
      assert.deepEqual(
        fontsDrawn.map((fact) => fact.index),
        [0, 1, 2, 3, 4, 5],
      );
      assertFactsMatchInspection(single, `${format} single`);

      // One more blank on the first line moves every later glyph one index on.
      mixed.update({ text: `ab  ${body} cd\nsecond\n${body}` });
      glyph.shape();
      assertFactsMatchInspection(mixed, `${format} after a blank`);
      for (const text of [latin, mixed, fonts, single]) text.dispose();
    } finally {
      handle.dispose();
      main.dispose();
    }
  });
}

test('a recipe that does not declare aGlyphFacts carries none, and a handle that does not publish it refuses one', async () => {
  await glyph.init({ wasm: await readFile(new URL('../../dist/text-shaper.wasm', import.meta.url)) });
  const font = await load('bitmap', 'main');
  const publishing = glyph.handle('pixi3d:glyph-facts:unread', definePixi3DConfig({ glyphFacts: true }));
  const plain = glyph.handle('pixi3d:glyph-facts:unpublished', definePixi3DConfig());
  try {
    const unread = publishing.createText({ font, text: 'plain' });
    glyph.shape();
    const mesh = unread.children.find((child) => child instanceof Mesh3D);
    assert.equal(mesh.geometry.attributes.aGlyphFacts, undefined);
    unread.dispose();

    plain.createText({ font, material: new Pixi3DTextMaterial({ extraBits: [factsBit] }), text: 'asks' });
    assert.throws(() => glyph.shape(), /aGlyphFacts.*definePixi3DConfig\(\{ glyphFacts: true \}\)/);
    assert.throws(() => definePixi3DConfig({ glyphFacts: 1 }), /glyphFacts must be a boolean/);
  } finally {
    publishing.dispose();
    plain.dispose();
    font.dispose();
  }
});
