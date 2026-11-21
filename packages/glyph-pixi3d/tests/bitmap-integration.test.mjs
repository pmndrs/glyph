import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { Container3D, Material3D, Mesh3D } from '@pixi/3d';
import { bitmap, glyph, msdf, slug, txt, span } from '@pmndrs/glyph';

import { definePixi3DConfig, Pixi3DTextMaterial } from '../dist/index.js';

const fontFixture = new URL('../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const allRasterFontFixture = new URL('../../../apps/typegpu-hello-world/assets/inter-latin.font.glb', import.meta.url);
const shaperWasm = new URL('../../glyph/dist/text-shaper.wasm', import.meta.url);

test('shared text meshes survive sibling updates and native parent destruction', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:shared-text-lifetime', definePixi3DConfig());
  const font = glyph.fontFace(new Blob([await readFile(fontFixture)], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  await font.load();
  const parent = new Container3D();
  try {
    const texts = Array.from({ length: 4 }, () => handle.createText({ font, text: 'GLYPH', style: { fontSize: 32 } }));
    for (const text of texts) parent.addChild(text);
    glyph.shape();
    const meshes = texts.map((text) => text.children.find((child) => child instanceof Mesh3D));
    const geometry = meshes[1].geometry;
    const material = meshes[1].material;
    assert.equal(new Set(meshes.map((mesh) => mesh.geometry)).size, 1);
    assert.equal(new Set(meshes.map((mesh) => mesh.material)).size, 1);
    texts[0].text = 'BREAK';
    glyph.shape();
    assert.equal(texts[1].children[0], meshes[1], 'an unrelated text retains its accepted mesh');
    assert.equal(meshes[1].geometry, geometry);
    assert.equal(material.destroyed, false);
    texts[0].dispose();
    glyph.shape();
    assert.equal(material.destroyed, false, 'disposing a sibling does not destroy a leased material');
    parent.destroy({ children: true });
    glyph.shape();
    assert.ok(
      texts.every((text) => text.disposed),
      'native parent disposal releases retained text controllers',
    );
    assert.equal(material.destroyed, true, 'the final lease releases the shared material');
  } finally {
    if (!parent.destroyed) parent.destroy({ children: true });
    font.dispose();
    handle.dispose();
  }
});

test('Bitmap text publishes retained Pixi3D meshes without a TypeGPU runtime', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:bitmap-test', definePixi3DConfig());
  const bytes = await readFile(fontFixture);
  const font = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  await font.load();
  try {
    const text = handle.createText({
      font,
      text: 'Pixi3D',
      style: { fontSize: 32, color: '#72e1ff' },
      constraints: { width: { mode: 'at-most', size: 512 } },
    });
    glyph.shape();

    const firstMeshes = text.children.filter((child) => child instanceof Mesh3D);
    assert.ok(firstMeshes.length > 0);
    for (const mesh of firstMeshes) {
      assert.ok(mesh.material instanceof Material3D);
      assert.ok(mesh.geometry.getAttribute('aGlyphOrigin'));
      assert.ok(mesh.geometry.getAttribute('aGlyphColor'));
      assert.equal(mesh.material.alphaMode, 'blend');
      const atlas = mesh.material.textures.glyphBitmapAtlas.source;
      assert.equal(atlas.format, 'rgba8unorm');
      assert.ok(atlas.resource instanceof Uint8Array);
      assert.ok(atlas.resource.some((value, index) => index % 4 === 0 && value !== 0));
      assert.ok(atlas.resource.every((value, index) => index % 4 !== 3 || value === 255));
    }

    text.update({ text: 'Pixi3D + Glyph' });
    glyph.shape();
    const nextMeshes = text.children.filter((child) => child instanceof Mesh3D);
    assert.ok(nextMeshes.length > 0);
    assert.notEqual(nextMeshes[0], firstMeshes[0]);

    text.dispose();
    glyph.shape();
    assert.equal(text.children.filter((child) => child instanceof Mesh3D).length, 0);
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('MTSDF shaping publishes Pixi3D meshes with effect attributes and material constants', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:msdf-test', definePixi3DConfig());
  const bytes = await readFile(allRasterFontFixture);
  const font = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), { format: msdf });
  await font.load();
  try {
    const text = handle.createText({
      font,
      text: 'MTSDF',
      style: {
        fontSize: 48,
        color: '#f4f7ff',
        outline: { color: '#22d3ee', width: 1.5 },
        shadow: { color: '#6d28d9', offset: [3, 3] },
      },
    });
    glyph.shape();
    const meshes = text.children.filter((child) => child instanceof Mesh3D);
    assert.ok(meshes.length > 0);
    for (const mesh of meshes) {
      assert.ok(mesh.material instanceof Material3D);
      assert.ok(mesh.geometry.getAttribute('aGlyphRect'));
      assert.ok(mesh.geometry.getAttribute('aGlyphEffectColor'));
      assert.ok(mesh.geometry.getAttribute('aGlyphPage'));
      assert.equal(mesh.material.alphaMode, 'blend');
      assert.ok(mesh.material.data.uGlyphPixelRange > 0);
    }
    text.dispose();
    glyph.shape();
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('Slug shaping publishes Pixi3D meshes with byte-packed lookup textures', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:slug-test', definePixi3DConfig());
  const bytes = await readFile(allRasterFontFixture);
  const font = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), { format: slug });
  await font.load();
  try {
    const text = handle.createText({ font, text: 'Slug', style: { fontSize: 64, color: '#ffffff' } });
    glyph.shape();
    const meshes = text.children.filter((child) => child instanceof Mesh3D);
    assert.ok(meshes.length > 0);
    for (const mesh of meshes) {
      assert.ok(mesh.material instanceof Material3D);
      assert.ok(mesh.geometry.getAttribute('aGlyphPlaneRect'));
      assert.ok(mesh.geometry.getAttribute('aGlyphTableStarts'));
      assert.ok(mesh.geometry.getAttribute('aGlyphBandCounts'));
      assert.equal(mesh.material.textures.glyphSlugHeaders.source.format, 'rgba8unorm');
      const bandCurves = mesh.material.textures.glyphSlugBandCurves.source;
      assert.equal(bandCurves.format, 'rgba8unorm');
      assert.ok(
        bandCurves.resource.some((value) => value !== 0),
        'drawn glyphs have resident band curves',
      );
    }
    text.dispose();
    glyph.shape();
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('Slug paragraphs realize Glyph line-height placement in Pixi3D geometry', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:slug-paragraph-test', definePixi3DConfig());
  const bytes = await readFile(allRasterFontFixture);
  const font = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), { format: slug });
  await font.load();
  try {
    const text = handle.createText({
      font,
      text: 'AAAA\nAAAA',
      style: { fontSize: 15, lineHeight: 1.4, color: '#ffffff' },
      constraints: { width: { mode: 'exact', size: 120 } },
      layout: { align: 'center', wrap: 'word' },
    });
    glyph.shape();

    const inspection = text.glyphs();
    assert.equal(inspection.lineCount, 2);
    assert.equal(inspection.lines[1].baseline - inspection.lines[0].baseline, 21);

    const mesh = text.children.find((child) => child instanceof Mesh3D);
    assert.ok(mesh);
    const rects = mesh.geometry.getAttribute('aGlyphRect').buffer.data;
    const firstLineY = rects[1];
    const secondLineY = rects[inspection.lineGlyphStarts[1] * 16 + 1];
    assert.equal(secondLineY - firstLineY, 21);

    text.dispose();
    glyph.shape();
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('formatted spans retain styles, font leases and cluster-aware placement', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:formatted', definePixi3DConfig());
  const font = glyph.fontFace(new Blob([await readFile(fontFixture)], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  await font.load();
  try {
    const content = txt`A${span({ color: '#ff0000', fontSize: 64 })`B`}C`;
    const text = handle.createText({ font, text: content, style: { fontSize: 32, color: '#ffffff' } });
    glyph.shape();
    const glyphs = text.measureGlyphs();
    assert.equal(glyphs.length, 3);
    assert.ok(glyphs[1].advance > glyphs[0].advance * 1.5, 'inline size affects real shaping');
    assert.equal(text.caretForOffset(3).offset, 3);
    assert.ok(text.selectionRects(1, 2).length > 0);
    const colors = text.children
      .filter((child) => child instanceof Mesh3D)
      .flatMap((mesh) => Array.from(mesh.geometry.getAttribute('aGlyphColor').buffer.data));
    assert.ok(
      colors.some((value, index) => index % 4 === 1 && value === 0),
      'inline red reaches mesh color',
    );
    text.text = 'ABC';
    glyph.shape();
    assert.ok(text.measureGlyphs()[1].advance < glyphs[1].advance);
    text.update({ text: txt`${span({ decoration: { underline: true, color: '#ff0088' } })`X`}` });
    glyph.shape();
    const decoration = text.children.find(
      (child) => child instanceof Mesh3D && child.geometry.getAttribute('aGlyphDecoration'),
    );
    assert.ok(decoration, 'engine-authored decoration rows are rendered');
    const rect = decoration.geometry.getAttribute('aPosition').buffer.data;
    assert.ok(rect[3] > rect[0], 'solid decoration has positive width');
    assert.ok(rect[7] < rect[1], 'paragraph-down decoration rectangle flips into Pixi Y-up');
    const [copies, decorationCopy] = text.split();
    assert.equal(copies.children.length, 1);
    assert.ok(decorationCopy);
    const copiedMesh = copies.children[0].children[0];
    const copiedMaterial = copiedMesh.material;
    text.dispose();
    glyph.shape();
    assert.equal(copiedMaterial.destroyed, false, 'detached copies own their material lifetime');
    copies.destroy({ children: true });
    decorationCopy.destroy({ children: true });
    assert.equal(copiedMaterial.destroyed, true);
    text.dispose();
    glyph.shape();
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('a rejected renderer publication retains the last mesh and does not retry until edited', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:rejection', definePixi3DConfig());
  const font = glyph.fontFace(new Blob([await readFile(fontFixture)], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  await font.load();
  let reject = false;
  let calls = 0;
  try {
    const material = new Pixi3DTextMaterial({
      create: ({ createDefaultMaterial }) => {
        calls++;
        if (reject) throw new Error('intentional material rejection');
        return createDefaultMaterial();
      },
    });
    const text = handle.createText({
      font,
      text: 'ONE',
      material,
      constraints: { anchor: { x: 'center', y: 'first-baseline' } },
    });
    glyph.shape();
    const sibling = handle.createText({ font, text: 'sibling' });
    glyph.shape();
    let notifications = 0;
    text.onError = (error) => {
      notifications++;
      assert.equal(sibling.error, error, 'root participants receive state before notifications');
      assert.throws(() => sibling.dispose(), 'publication callbacks cannot mutate engine lifetime');
      assert.equal(sibling.disposed, false, 'rejected lifetime mutation preserves active membership');
      throw new Error('notification must not replace the material failure');
    };
    const accepted = text.children[0];
    const acceptedPosition = [accepted.position.x, accepted.position.y];
    reject = true;
    text.constraints = { anchor: { x: 'right', y: 'bottom' } };
    text.text = 'TWO';
    assert.throws(() => glyph.shape(), /intentional material rejection/);
    assert.match(text.error.message, /intentional material rejection/);
    assert.equal(notifications, 1);
    assert.equal(text.children[0], accepted);
    assert.deepEqual(
      [accepted.position.x, accepted.position.y],
      acceptedPosition,
      'rejection retains accepted placement',
    );
    assert.equal(accepted.material.destroyed, false);
    const rejectedCalls = calls;
    text.position.x = 73;
    assert.doesNotThrow(() => glyph.shape());
    assert.equal(calls, rejectedCalls, 'a rejected frame is not compiled repeatedly');
    assert.equal(notifications, 1, 'a rejected publication reports once');
    assert.equal(text.position.x, 73);
    reject = false;
    text.text = 'THREE';
    glyph.shape();
    assert.notEqual(text.children[0], accepted);
    const offset = text.measure().anchorOffset;
    assert.deepEqual([text.children[0].position.x, text.children[0].position.y], [offset.x, -offset.y]);
    assert.equal(text.error, undefined);
    assert.equal(sibling.error, undefined);
    handle.dispose();
    assert.equal(sibling.disposed, true, 'root disposal releases retained text membership');
    text.dispose();
    glyph.shape();
  } finally {
    font.dispose();
    handle.dispose();
  }
});

test('anchors place retained draws, local queries and detached copies without changing the default origin', async () => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle('pixi3d:anchor-space', definePixi3DConfig());
  const font = glyph.fontFace(new Blob([await readFile(fontFixture)], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  await font.load();
  let copies;
  let decorations;
  try {
    const text = handle.createText({
      font,
      text: txt`${span({ decoration: { underline: true } })`ABC`}`,
      style: { fontSize: 32 },
      constraints: { width: { mode: 'exact', size: 240 }, height: { mode: 'exact', size: 90 } },
    });
    const parent = new Container3D({
      position: { x: 30, y: -14, z: 8 },
      scale: { x: 1.4, y: 0.7, z: 1.2 },
      rotation: { x: 0.2, y: -0.3, z: 0.15 },
    });
    text.position.set(19, -27, 4);
    text.scale.set(0.8, 1.3, 0.9);
    text.rotation.set(-0.1, 0.25, -0.2);
    text.origin.set(4, 5, 0);
    parent.addChild(text);
    const measure = text.measure.bind(text);
    let measurements = 0;
    text.measure = () => {
      measurements++;
      return measure();
    };
    glyph.shape();
    assert.equal(measurements, 0, 'omitted anchors issue no placement measurement query');
    const mesh = text.children.find((child) => child instanceof Mesh3D);
    const geometry = mesh.geometry;
    let transformWrites = 0;
    const setPosition = mesh.position.set.bind(mesh.position);
    mesh.position.set = (...values) => {
      transformWrites++;
      return setPosition(...values);
    };
    const sibling = handle.createText({ font, text: 'other' });
    glyph.shape();
    assert.equal(transformWrites, 0, 'default zero placement does not write owned transforms');
    assert.equal(measurements, 0, 'default zero placement does not query metrics on sibling publication');
    const raw = text.glyphs();
    const defaultGlyph = text.measureGlyphs()[0];
    const defaultCaret = text.caretForOffset(1);
    const defaultSelection = text.selectionRects(0, 2)[0];
    const defaultBounds = text.computeBoundingBox();
    assert.deepEqual(raw.anchorOffset, { x: 0, y: 0 });
    assert.equal(mesh.position.x, 0);
    assert.equal(mesh.position.y, 0);
    assert.equal(defaultGlyph.x, raw.x[0]);
    const callerChild = new Container3D();
    callerChild.position.set(13, 17, 23);
    text.addChild(callerChild);
    text.constraints = { ...text.constraints, anchor: { x: 'center', y: 'middle' } };
    glyph.shape();
    assert.equal(
      text.children.find((child) => child instanceof Mesh3D),
      mesh,
      'anchor-only edits retain meshes',
    );
    assert.equal(mesh.geometry, geometry, 'anchor placement does not upload geometry');
    assert.deepEqual([mesh.position.x, mesh.position.y], [-120, 45]);
    assert.equal(transformWrites, 1, 'changed placement translates each owned mesh once');
    text.constraints = { ...text.constraints, anchor: { x: 'center', y: 'middle' } };
    glyph.shape();
    assert.equal(transformWrites, 1, 'equal resolved placement does not write transforms');
    assert.deepEqual([callerChild.position.x, callerChild.position.y, callerChild.position.z], [13, 17, 23]);
    assert.equal(text.glyphs().x[0], raw.x[0], 'raw inspections stay paragraph-local');
    const measuredGlyph = text.measureGlyphs()[0];
    assert.equal(measuredGlyph.x, defaultGlyph.x - 120);
    assert.equal(measuredGlyph.y, defaultGlyph.y - 45);
    assert.equal(text.caretForOffset(1).rect.x, defaultCaret.rect.x - 120);
    assert.equal(text.caretForOffset(1).rect.y, defaultCaret.rect.y - 45);
    assert.equal(text.caretAt(defaultCaret.rect.x - 120, defaultCaret.rect.y - 45).offset, 1);
    assert.equal(text.selectionRects(0, 2)[0].x, defaultSelection.x - 120);
    assert.equal(text.computeBoundingBox().min.x, defaultBounds.min.x - 120);
    assert.equal(text.computeBoundingBox().max.y, defaultBounds.max.y + 45);
    [copies, decorations] = text.split();
    const copiedMesh = copies.children[0].children[0];
    assert.deepEqual([copiedMesh.position.x, copiedMesh.position.y], [-raw.x[0], raw.y[0]]);
    assert.ok(decorations);
    assert.deepEqual([decorations.children[0].position.x, decorations.children[0].position.y], [-120, 45]);
    parent.addChild(copies, decorations);
    const sample = { x: raw.x[0], y: -raw.y[0], z: 0 };
    const sourceWorld = mesh.toGlobal(sample);
    const copiedWorld = copiedMesh.toGlobal(sample);
    for (const axis of ['x', 'y', 'z'])
      assert.ok(
        Math.abs(sourceWorld[axis] - copiedWorld[axis]) < 0.0001,
        `split ${axis} world coordinate matches source`,
      );
    const decorationSample = { x: 0, y: 0, z: 0 };
    const sourceDecoration = text.children.find(
      (child) => child instanceof Mesh3D && child.geometry.getAttribute('aGlyphDecoration'),
    );
    const beforeDecoration = sourceDecoration.toGlobal(decorationSample);
    const afterDecoration = decorations.children[0].toGlobal(decorationSample);
    for (const axis of ['x', 'y', 'z'])
      assert.ok(
        Math.abs(beforeDecoration[axis] - afterDecoration[axis]) < 0.0001,
        `decoration ${axis} world coordinate matches source`,
      );

    text.constraints = { width: { mode: 'exact', size: 240 }, height: { mode: 'exact', size: 90 } };
    glyph.shape();
    assert.deepEqual([mesh.position.x, mesh.position.y], [0, 0]);
    assert.equal(transformWrites, 2, 'clearing placement writes the identity once');
    measurements = 0;
    sibling.text = 'changed';
    glyph.shape();
    assert.equal(transformWrites, 2, 'identity placement stays a no-op after clearing an anchor');
    assert.equal(measurements, 0, 'identity placement restores the zero-query path');
    sibling.dispose();
    assert.deepEqual(
      [copiedMesh.position.x, copiedMesh.position.y],
      [-raw.x[0], raw.y[0]],
      'copies retain their glyph-local compensation',
    );
    text.dispose();
  } finally {
    copies?.dispose();
    decorations?.dispose();
    handle.dispose();
    font.dispose();
  }
});

test('split glyphs rotate and scale around their captured anchored pen in the source local frame', async (t) => {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const nearPoint = (actual, expected, label) => {
    for (const axis of ['x', 'y', 'z'])
      assert.ok(
        Math.abs(actual[axis] - expected[axis]) < 0.0001,
        `${label}.${axis}: ${actual[axis]} != ${expected[axis]}`,
      );
  };
  for (const [name, format, fixture] of [
    ['bitmap', bitmap({ strikes: [16] }), fontFixture],
    ['msdf', msdf, allRasterFontFixture],
    ['slug', slug, allRasterFontFixture],
  ])
    for (const anchor of [undefined, { x: 'center', y: 'first-baseline' }])
      await t.test(`${name}/${anchor === undefined ? 'default' : 'anchored'}`, async () => {
        const handle = glyph.handle(`pixi3d:split-pivot-${name}`, definePixi3DConfig());
        const font = glyph.fontFace(new Blob([await readFile(fixture)]), { format });
        await font.load();
        const parent = new Container3D({
          position: { x: 13, y: -21, z: 8 },
          rotation: { x: 0.15, y: -0.2, z: 0.3 },
          scale: { x: 1.4, y: 0.7, z: 1.2 },
        });
        let copies;
        let decorations;
        try {
          const text = handle.createText({
            font,
            text: txt`A${span({ fontSize: 48, decoration: { underline: true } })`B`}\nCD`,
            style: { fontSize: 32 },
            constraints: { width: { mode: 'exact', size: 180 }, anchor },
          });
          text.position.set(-11, 17, 3);
          text.rotation.set(-0.1, 0.12, -0.25);
          text.scale.set(0.8, 1.3, 0.9);
          text.origin.set(4, 5, 0);
          parent.addChild(text);
          glyph.shape();
          const measured = text.measureGlyphs();
          const raw = text.glyphs();
          [copies, decorations] = text.split();
          assert.equal(copies.children.length, measured.length);
          assert.ok(decorations);
          parent.addChild(copies, decorations);
          const assertRest = () => {
            for (const [index, child] of copies.children.entries()) {
              const pen = { x: measured[index].x, y: -measured[index].y, z: 0 };
              nearPoint(child.toGlobal({ x: 0, y: 0, z: 0 }), text.toGlobal(pen), 'glyph pen pivot');
              const rawPoint = { x: raw.x[index] + 3, y: -raw.y[index] + 7, z: 0 };
              const anchoredPoint = { x: pen.x + 3, y: pen.y + 7, z: 0 };
              for (const mesh of child.children)
                nearPoint(mesh.toGlobal(rawPoint), text.toGlobal(anchoredPoint), 'replacement content');
            }
            const sourceDecoration = text.children.find(
              (child) => child instanceof Mesh3D && child.geometry.getAttribute('aGlyphDecoration'),
            );
            nearPoint(
              decorations.children[0].toGlobal({ x: 3, y: 7, z: 0 }),
              sourceDecoration.toGlobal({ x: 3, y: 7, z: 0 }),
              'decoration placement',
            );
          };
          assertRest();
          for (const object of [text, copies, decorations]) {
            object.rotation.z += 0.4;
            object.scale.set(1.1, 0.6, 1.2);
          }
          assertRest();
          const expected = [];
          for (const [index, child] of copies.children.entries()) {
            const pen = { x: measured[index].x, y: -measured[index].y, z: 0 };
            child.rotation.z = 0.6;
            child.scale.set(1.35, 0.7, 1);
            nearPoint(child.toGlobal({ x: 0, y: 0, z: 0 }), text.toGlobal(pen), 'animated pivot stays fixed');
            const offsetX = Math.cos(0.6) * 3 * 1.35 - Math.sin(0.6) * 7 * 0.7;
            const offsetY = Math.sin(0.6) * 3 * 1.35 + Math.cos(0.6) * 7 * 0.7;
            const point = { x: raw.x[index] + 3, y: -raw.y[index] + 7, z: 0 };
            const world = text.toGlobal({ x: pen.x + offsetX, y: pen.y + offsetY, z: 0 });
            for (const mesh of child.children) nearPoint(mesh.toGlobal(point), world, 'glyph-local rotation and scale');
            expected.push({ point, world });
          }
          text.update({ text: 'Different', constraints: { anchor: { x: 'right', y: 'bottom' } } });
          glyph.shape();
          text.dispose();
          glyph.shape();
          for (const [index, child] of copies.children.entries())
            for (const mesh of child.children)
              nearPoint(mesh.toGlobal(expected[index].point), expected[index].world, 'source-independent snapshot');
        } finally {
          copies?.dispose();
          decorations?.dispose();
          parent.destroy({ children: true });
          handle.dispose();
          font.dispose();
        }
      });
});
