import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Material3D, Mesh3D } from '@pixi/3d';
import { bitmap, glyph, msdf, slug } from '@pmndrs/glyph';
import { definePixi3DConfig, Pixi3DTextMaterial } from '@pmndrs/glyph/pixi3d';
import { testEffectBit } from '../support/pixi3d-effect-bit.mjs';

const fixtures = [
  ['bitmap', bitmap({ strikes: [16] }), '../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb'],
  ['msdf', msdf, '../../../../apps/typegpu-hello-world/assets/inter-latin.font.glb'],
  ['slug', slug, '../../../../apps/typegpu-hello-world/assets/inter-latin.font.glb'],
];

for (const [name, format, fixture] of fixtures) {
  test(`${name}: independent Codec records share native geometry while retaining materials and transforms`, async () => {
    await glyph.init({ wasm: await readFile(new URL('../../dist/text-shaper.wasm', import.meta.url)) });
    const handle = glyph.handle(`pixi3d:native-record:${name}`, definePixi3DConfig());
    const font = glyph.fontFace(new Blob([await readFile(new URL(fixture, import.meta.url))]), { format });
    await font.load();
    try {
      const recipes = Array.from(
        { length: 32 },
        (_, index) =>
          new Pixi3DTextMaterial({
            nativeRecords: true,
            extraBits: [testEffectBit],
            data: { uGlyphTestImpact: index / 32 },
            create: ({ bits }) =>
              new Material3D({ alphaMode: 'blend', doubleSided: true, fog: false, extraBits: bits }),
          }),
      );
      const texts = recipes.map((material, index) =>
        handle.createText({
          font,
          material,
          text: 'aMWz'[index % 4],
          style: { fontSize: 24 + index, ...(name === 'msdf' ? { outline: { color: '#ffffff', width: 1 } } : {}) },
          constraints: { anchor: { x: 'center', y: 'middle' } },
        }),
      );
      glyph.shape();
      const meshes = texts.map((text) => text.children.find((child) => child instanceof Mesh3D));
      assert.equal(meshes.filter(Boolean).length, 32, 'the realization keeps one mesh per independent character');
      assert.equal(new Set(meshes.map((mesh) => mesh.geometry)).size, 1, 'differing glyphs share native draw identity');
      assert.equal(new Set(meshes.map((mesh) => mesh.material)).size, 32, 'effects retain independent material rows');
      assert.deepEqual(Object.keys(meshes[0].geometry.attributes).sort(), ['aPosition', 'aUV']);
      assert.equal(meshes[0].geometry.indexBuffer.data.length, 6);
      assert.equal(meshes[0].geometry.vertexCount, 4, 'native atlas allocation receives four vertices');
      if (name === 'msdf')
        assert.equal(
          meshes[0].material.data.glyphRecordEffectColor0,
          0xffffffff,
          'packed paint keeps all 32 integer bits',
        );
      assert.equal(
        meshes[0].geometry.boundsSphere.radius,
        -1,
        'GPU culling conservatively accepts shader-owned positions',
      );
      for (const mesh of meshes) {
        assert.ok(mesh.boundsVolume.width > 0);
        assert.equal(mesh.hitVolume, mesh.boundsVolume);
        assert.ok(mesh.getLocalBounds().width > 0, 'native bounds use the instance volume');
      }
      const [snapshot, decorations] = texts[0].split();
      const copied = snapshot.children[0].children[0];
      assert.equal(copied.geometry.vertexCount, 4, 'detached native quads remain valid atlas inputs');
      assert.equal(copied.geometry.indexBuffer.data.length, 6);
      snapshot.dispose();
      decorations?.dispose();
      const anchor = texts[0].measure().anchorOffset;
      assert.ok(anchor.x < 0 && anchor.y < 0);
      assert.deepEqual([meshes[0].position.x, meshes[0].position.y], [anchor.x, -anchor.y]);
      const geometry = meshes[0].geometry;
      const indexBuffer = geometry.indexBuffer;
      texts[0].position.set(23, -17, 4);
      texts[1].visible = false;
      recipes[0].update({ uGlyphTestImpact: 0.875 });
      glyph.shape();
      assert.equal(meshes[0].material.data.uGlyphTestImpact, 0.875);
      assert.equal(meshes[1].material.data.uGlyphTestImpact, 1 / 32);
      assert.ok(
        texts.every((text, index) => text.children[0] === meshes[index]),
        'transform/effect-only frames retain every draw',
      );
      texts[0].text = 'Q';
      glyph.shape();
      assert.equal(texts[0].children[0].geometry, geometry, 'changed Codec data retains canonical geometry');
      assert.equal(texts[1].children[0], meshes[1], 'a sibling update keeps the accepted mesh');
      texts[0].dispose();
      glyph.shape();
      assert.equal(texts[1].children[0].material.destroyed, false);
      assert.equal(indexBuffer.destroyed, false);
      texts.slice(1).forEach((text) => text.dispose());
      glyph.shape();
      assert.equal(indexBuffer.destroyed, true, 'the last native lease releases canonical buffers');
    } finally {
      font.dispose();
      handle.dispose();
    }
  });
}

test('native records lower cross-bit glyph reads and fall back for full custom material rows', async () => {
  await glyph.init({ wasm: await readFile(new URL('../../dist/text-shaper.wasm', import.meta.url)) });
  const handle = glyph.handle('pixi3d:native-custom-bits', definePixi3DConfig());
  const font = glyph.fontFace(new Blob([await readFile(new URL(fixtures[2][2], import.meta.url))]), { format: slug });
  await font.load();
  try {
    const reader = {
      name: 'testNativeCrossBitReader',
      gpu: { vertex: { beforeTransform: 'position.x += input.aGlyphRect.z * 0.01;' } },
      gl: { vertex: { beforeTransform: 'position.x += aGlyphRect.z * 0.01;' } },
    };
    let readerBits;
    const material = new Pixi3DTextMaterial({
      nativeRecords: true,
      extraBits: [reader],
      create: (context) => {
        readerBits = context.bits;
        return context.createDefaultMaterial();
      },
    });
    const text = handle.createText({ font, material, text: 'A' });
    glyph.shape();
    const lowered = readerBits.find((bit) => bit.name === `${reader.name}:nativeRecord`);
    assert.match(lowered.gpu.vertex.beforeTransform, /material\.glyphRecordRect/);
    assert.match(lowered.gl.vertex.beforeTransform, /material\.glyphRecordRect/);
    assert.match(reader.gpu.vertex.beforeTransform, /input\.aGlyphRect/);

    const fullRow = {
      name: 'testNativeFullMaterialRow',
      bindings: { material: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`uCustom${index}`, 'f32'])) },
    };
    let fullBits;
    const full = handle.createText({
      font,
      text: 'B',
      material: new Pixi3DTextMaterial({
        nativeRecords: true,
        extraBits: [fullRow],
        create: (context) => {
          fullBits = context.bits;
          return context.createDefaultMaterial();
        },
      }),
    });
    glyph.shape();
    assert.deepEqual(
      Object.keys(full.children[0].geometry.attributes).sort(),
      ['aPosition', 'aUV'],
      'a recipe with many material fields still takes a native record row',
    );
    assert.ok(
      fullBits.some((bit) => bit.name === `${fullRow.name}:nativeRecord`),
      'the caller recipe reaches the factory lowered once',
    );
    const headerReader = {
      name: 'testNativeHeaderReader',
      gl: { header: 'float glyphWidth() { return aGlyphRect.z; }' },
    };
    const header = handle.createText({
      font,
      text: 'C',
      material: new Pixi3DTextMaterial({ extraBits: [headerReader] }),
    });
    glyph.shape();
    assert.ok(
      header.children[0].geometry.getAttribute('aGlyphRect'),
      'custom attribute headers keep their original realization',
    );
    const collisionBit = {
      name: 'testNativeRecordFieldCollision',
      bindings: { material: { glyphRecordRect: 'vec4<f32>', glyphRecordTableStarts0: 'f32' } },
    };
    const collisionMaterial = new Pixi3DTextMaterial({
      extraBits: [collisionBit],
      data: { glyphRecordRect: [9, 8, 7, 6], glyphRecordTableStarts0: 7.5 },
    });
    const collision = handle.createText({ font, text: 'D', material: collisionMaterial });
    glyph.shape();
    const collisionMesh = collision.children[0];
    assert.ok(
      collisionMesh.geometry.getAttribute('aGlyphRect'),
      'existing caller material fields retain attribute geometry',
    );
    assert.deepEqual(Array.from(collisionMesh.material.data.glyphRecordRect), [9, 8, 7, 6]);
    assert.equal(collisionMesh.material.data.glyphRecordTableStarts0, 7.5);
    collisionMaterial.update({ glyphRecordRect: [1, 2, 3, 4], glyphRecordTableStarts0: 3.25 });
    assert.equal(collision.children[0], collisionMesh);
    assert.deepEqual(Array.from(collisionMesh.material.data.glyphRecordRect), [1, 2, 3, 4]);
    assert.equal(collisionMesh.material.data.glyphRecordTableStarts0, 3.25);
    for (const item of [text, full, header, collision]) item.dispose();
    glyph.shape();
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('native record preparation rejects transactionally and keeps the accepted draw live', async () => {
  await glyph.init({ wasm: await readFile(new URL('../../dist/text-shaper.wasm', import.meta.url)) });
  const handle = glyph.handle('pixi3d:native-rejection', definePixi3DConfig());
  const font = glyph.fontFace(new Blob([await readFile(new URL(fixtures[2][2], import.meta.url))]), { format: slug });
  await font.load();
  let reject = false;
  try {
    const material = new Pixi3DTextMaterial({
      nativeRecords: true,
      create: ({ createDefaultMaterial }) => {
        if (reject) throw new Error('test native record rejection');
        return createDefaultMaterial();
      },
    });
    const text = handle.createText({ font, text: 'A', material });
    glyph.shape();
    const accepted = text.children[0];
    const nativeMaterial = accepted.material;
    const nativeGeometry = accepted.geometry;
    reject = true;
    text.text = 'B';
    assert.throws(() => glyph.shape(), /test native record rejection/);
    assert.equal(text.children[0], accepted);
    assert.equal(nativeMaterial.destroyed, false);
    assert.equal(nativeGeometry.indexBuffer.destroyed, false);
    assert.doesNotThrow(() => glyph.shape(), 'a rejected native preparation is not retried until edited');
    reject = false;
    text.text = 'C';
    glyph.shape();
    assert.equal(text.children[0].geometry, nativeGeometry);
    text.dispose();
    glyph.shape();
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('custom factories preserve appended glyph bits and material fields unless native records are explicitly enabled', async () => {
  await glyph.init({ wasm: await readFile(new URL('../../dist/text-shaper.wasm', import.meta.url)) });
  const handle = glyph.handle('pixi3d:native-factory-default', definePixi3DConfig());
  const font = glyph.fontFace(new Blob([await readFile(new URL(fixtures[2][2], import.meta.url))]), { format: slug });
  await font.load();
  try {
    const factoryBit = {
      name: 'testFactoryAppendedRecordFields',
      bindings: { material: { glyphRecordRect: 'vec4<f32>', glyphRecordTableStarts0: 'f32' } },
    };
    const recipe = new Pixi3DTextMaterial({
      create: ({ bits }) => {
        const material = new Material3D({
          alphaMode: 'blend',
          doubleSided: true,
          fog: false,
          extraBits: [...bits, testEffectBit, factoryBit],
        });
        material.data.glyphRecordRect = new Float32Array([9, 8, 7, 6]);
        material.data.glyphRecordTableStarts0 = 7.5;
        return material;
      },
    });
    assert.equal(recipe.nativeRecords, false);
    const custom = handle.createText({ font, text: 'A', material: recipe });
    const standard = handle.createText({ font, text: 'B' });
    const disabled = handle.createText({ font, text: 'C', material: new Pixi3DTextMaterial({ nativeRecords: false }) });
    glyph.shape();
    const mesh = custom.children[0];
    assert.ok(mesh.geometry.getAttribute('aGlyphRect'));
    assert.ok(mesh.geometry.getAttribute('aGlyphEffect'), 'factory-appended glyph effects retain their vertex input');
    assert.deepEqual(Array.from(mesh.material.data.glyphRecordRect), [9, 8, 7, 6]);
    assert.equal(mesh.material.data.glyphRecordTableStarts0, 7.5);
    assert.deepEqual(Object.keys(standard.children[0].geometry.attributes).sort(), ['aPosition', 'aUV']);
    assert.ok(
      disabled.children[0].geometry.getAttribute('aGlyphRect'),
      'standard factories can explicitly keep attributes',
    );
    custom.text = 'D';
    glyph.shape();
    assert.ok(custom.children[0].geometry.getAttribute('aGlyphEffect'));
    assert.deepEqual(Array.from(custom.children[0].material.data.glyphRecordRect), [9, 8, 7, 6]);
    assert.equal(custom.children[0].material.data.glyphRecordTableStarts0, 7.5);
    for (const text of [custom, standard, disabled]) text.dispose();
    glyph.shape();
  } finally {
    font.dispose();
    handle.dispose();
  }
});
