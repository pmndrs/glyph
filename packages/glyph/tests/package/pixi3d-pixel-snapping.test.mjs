import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FlatMaterial, Mesh3D } from '@pixi/3d';
import { bitmap, glyph, GlyphInputError, msdf } from '@pmndrs/glyph';
import { definePixi3DConfig, glyphBitmapBit, glyphMsdfBit, Pixi3DTextMaterial } from '@pmndrs/glyph/pixi3d';

const bitmapFixture = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const msdfFixture = new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url);
const shaperWasm = new URL('../../dist/text-shaper.wasm', import.meta.url);

/** The vertex code a bit adds after PixiJS 3D's own projection, on both backends. */
const afterTransform = (bits) => bits.map((bit) => [bit.gpu?.vertex?.afterTransform, bit.gl?.vertex?.afterTransform]);

test('Pixi3D pixelSnapping is a construction-fixed boolean, off by default', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:snap-validation', definePixi3DConfig());
  const font = glyph.fontFace(new Blob([await readFile(bitmapFixture)]), { format: bitmap({ strikes: [16] }) });
  try {
    await font.load();
    assert.throws(
      () => handle.createText({ font, text: 'A', pixelSnapping: 1 }),
      (error) => error instanceof GlyphInputError && error.path.join('.') === 'pixelSnapping',
    );
    const text = handle.createText({ font, text: 'A' });
    assert.equal(text.pixelSnapping, false);
    assert.throws(() => text.update({ pixelSnapping: true }), /pixelSnapping is fixed at construction/);
    text.dispose();
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('a pixel-snapped Pixi3D text appends the snap bit to its Bitmap and decoration materials only', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:snap-bits', definePixi3DConfig());
  const bitmapFace = glyph.fontFace(new Blob([await readFile(bitmapFixture)]), { format: bitmap({ strikes: [16] }) });
  const msdfFace = glyph.fontFace(new Blob([await readFile(msdfFixture)]), { format: msdf });
  const supplied = [];
  const recipe = new Pixi3DTextMaterial({
    create: (context) => {
      supplied.push(context.bits);
      return new FlatMaterial({ alphaMode: 'blend', doubleSided: true, fog: false, extraBits: context.bits });
    },
  });
  try {
    await Promise.all([bitmapFace.load(), msdfFace.load()]);
    const meshes = (text) => text.children.filter((child) => child instanceof Mesh3D);
    const style = { decoration: { underline: true } };
    const plain = handle.createText({ font: bitmapFace, text: 'Ag', style, material: recipe });
    const unsnapped = handle.createText({ font: bitmapFace, text: 'Ag', style, pixelSnapping: false });
    const snapped = handle.createText({ font: bitmapFace, text: 'Ag', style, material: recipe, pixelSnapping: true });
    const msdfSnapped = handle.createText({ font: msdfFace, text: 'Ag', material: recipe, pixelSnapping: true });
    glyph.shape();

    // Unsnapped: Glyph supplies exactly the Bitmap bit, and the decoration material has only its paint bit.
    assert.deepEqual(supplied[0], [glyphBitmapBit]);
    for (const text of [plain, unsnapped]) {
      for (const mesh of meshes(text))
        assert.ok(
          afterTransform(mesh.material.extraBits)
            .flat()
            .every((code) => code === undefined),
        );
    }
    // Snapped Bitmap: one more bit, after the recipe's, rounding the projected position with the generated helper.
    const snappedBits = supplied[1];
    assert.equal(snappedBits.length, 2);
    assert.equal(snappedBits[0], glyphBitmapBit);
    const [gpu, gl] = afterTransform(snappedBits)[1];
    assert.match(gpu, /clipPosition = vec4<f32>\(\s*glyphSnapClipAxis\(clipPosition\.x, clipPosition\.w/);
    assert.match(gl, /gl_Position = vec4\(\s*glyphSnapClipAxis\(gl_Position\.x, gl_Position\.w/);
    assert.match(snappedBits[1].gpu.header, /floor\(\(physicalPosition \+ 0\.49609375f\)\)/);
    assert.match(snappedBits[1].gl.header, /floor\(\(physicalPosition \+ 0\.49609375\)\)/);
    // The snapped text's decoration is placed from its line's snapped baseline: its bit reads the rectangle's edges and
    // baseline from an attribute only a snapped decoration carries.
    const decorationOf = (text) => meshes(text).find((mesh) => mesh.geometry.getAttribute('aGlyphDecoration'));
    const snappedDecoration = decorationOf(snapped);
    const [decorationGpu, decorationGl] = afterTransform(snappedDecoration.material.extraBits).at(-1);
    assert.match(
      decorationGpu,
      /glyphSnapDecorationClipAxis\(glyphSnapTop\.yw, glyphSnapBottom\.yw, glyphSnapBaseline\.yw/,
    );
    assert.match(
      decorationGl,
      /glyphSnapDecorationClipAxis\(glyphSnapTop\.yw, glyphSnapBottom\.yw, glyphSnapBaseline\.yw/,
    );
    const snap = snappedDecoration.geometry.getAttribute('aGlyphDecorationSnap');
    assert.equal(snap.format, 'float32x4');
    const [top, bottom, baseline, bottomCorner] = snap.buffer.data.slice(0, 4);
    assert.equal(baseline, snapped.measure().lines[0].baseline, "the decoration carries its line's baseline");
    assert.ok(top > baseline && bottom > top, 'an underline sits below its baseline');
    assert.equal(bottomCorner, 0);
    for (const text of [plain, unsnapped])
      assert.equal(decorationOf(text).geometry.getAttribute('aGlyphDecorationSnap'), undefined);
    // MSDF ignores the option.
    assert.deepEqual(supplied[2], [glyphMsdfBit]);
    assert.equal(supplied.length, 3);

    for (const text of [plain, unsnapped, snapped, msdfSnapped]) text.dispose();
  } finally {
    bitmapFace.dispose();
    msdfFace.dispose();
    handle.dispose();
  }
});
