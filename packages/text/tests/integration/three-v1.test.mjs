import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { createFontStack, createTextRuntime, FontRegistry } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { msdf } from '@pmndrs/text/three/msdf';
import { slug } from '@pmndrs/text/three/slug';
import { defineTextMaterial, Text, TextGroup } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const densityFontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16-32.font.glb',
  import.meta.url,
);
const amiriFontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/amiri-bitmap-16.font.glb',
  import.meta.url,
);
const iconSlugFontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/font-awesome-free-6.7.2-slug.font.glb.gz',
  import.meta.url,
);
const multiTechniqueFontUrl = new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url);

test('one runtime request registers one font and returns typed resources for every declared technique', async () => {
  const runtime = await createTextRuntime({
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const [bitmapFont, msdfFont, slugFont] = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(multiTechniqueFontUrl)) },
    rasters: [{ technique: bitmap, options: { strikes: [32] } }, { technique: msdf }, { technique: slug }],
  });
  assert.equal(bitmapFont.font, msdfFont.font);
  assert.equal(msdfFont.font, slugFont.font);
  assert.equal(bitmapFont.technique, bitmap);
  assert.equal(msdfFont.technique, msdf);
  assert.equal(slugFont.technique, slug);
  runtime.dispose();
});

test('Three Text and TextGroup late-bind, synchronize, reparent, and dispose through the scene graph', async () => {
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const editedSpans = new Text({
    font,
    text: 'ABCD',
    spans: [
      { start: 0, end: 2, paint: { color: '#ff0000' } },
      { start: 2, end: 4, paint: { color: '#00ff00' } },
    ],
  });
  editedSpans.insertText(1, 'X');
  editedSpans.insertText(3, 'Y');
  assert.deepEqual(
    editedSpans.spans.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ],
    'insertion inside a span extends it while insertion at a boundary stays outside',
  );
  editedSpans.deleteText(1, 4);
  assert.equal(editedSpans.text, 'ACD');
  assert.deepEqual(
    editedSpans.spans.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ],
  );
  editedSpans.dispose();

  const scene = new THREE.Scene();
  const group = new TextGroup({ renderOrder: 12 });
  const container = new THREE.Object3D();
  const label = new Text({ font, text: 'First frame' });
  container.add(label);
  group.add(container);
  scene.add(group);

  assert.equal(label.bound, false, 'construction and add must not shape eagerly');
  scene.updateMatrixWorld();
  assert.equal(label.bound, true);
  assert.equal(label.textGroup, group);
  assert.equal(group.textCount, 1);
  assert.equal(label.layout, undefined, 'rendering must not materialize layout readback');
  assert.equal(group.error, undefined);
  const firstDraws = group.children.filter((child) => child.isMesh);
  assert.ok(firstDraws.length > 0);
  assert.equal(firstDraws[0].geometry.instanceCount, 10, 'the GPU plan omits the non-rendering space glyph');
  assert.equal(firstDraws[0].renderOrder, 12);
  const measurement = label.measureLayout();
  assert.ok(measurement, 'layout measurement must be available through an explicit Rust query');
  assert.equal(measurement.width, measurement.contentWidth);
  assert.equal(measurement.height, measurement.contentHeight);
  assert.ok(measurement.firstBaseline > 0);
  assert.equal(measurement.firstBaseline, measurement.lastBaseline);
  assert.equal(measurement.overflowed, false);
  assert.equal(measurement.glyphCount, 11, 'layout summary retains the non-rendering space glyph');
  assert.equal(measurement.lineCount, 1);
  assert.equal(measurement.missingGlyphCount, 0);
  assert.equal(label.measureLayout(), measurement, 'an unchanged committed layout must reuse its queried measurement');
  const inspection = label.inspectLayout();
  assert.ok(inspection, 'per-glyph layout must be available only through an explicit Rust inspection query');
  assert.equal(inspection.glyphIds.length, measurement.glyphCount);
  assert.equal(inspection.glyphStableIds.length, inspection.glyphIds.length);
  assert.equal(inspection.lineGlyphCounts.length, measurement.lineCount);
  assert.equal(label.inspectLayout(), inspection, 'an unchanged committed layout must reuse its copied inspection');
  assert.equal(label.layout, undefined, 'query data must not restore layout arrays to rendering');
  assert.equal(group.children.filter((child) => child.isMesh)[0], firstDraws[0]);

  const origins = label.snapshotGlyphOrigins();
  assert.equal(origins.layout, inspection);
  assert.deepEqual(origins.displayedX, origins.shapedX);
  assert.deepEqual(origins.displayedY, origins.shapedY);
  const presentedX = origins.shapedX.slice();
  presentedX[0] += 3;
  label.setGlyphOrigins({ layout: inspection, x: presentedX, y: origins.shapedY });
  const presented = label.snapshotGlyphOrigins();
  assert.equal(presented.shapedX[0], origins.shapedX[0], 'presentation must not mutate authoritative layout');
  assert.equal(presented.displayedX[0], origins.shapedX[0] + 3);
  label.clearGlyphOriginOverrides();
  assert.deepEqual(label.snapshotGlyphOrigins().displayedX, origins.shapedX);

  group.renderOrder = 20;
  scene.updateMatrixWorld();
  assert.equal(firstDraws[0].renderOrder, 20, 'group render order must update existing draw proxies');

  label.renderOrder = 7;
  scene.updateMatrixWorld();
  assert.equal(group.children.filter((child) => child.isMesh)[0].renderOrder, 20);
  assert.equal(firstDraws[0].geometry.instanceCount, 10, 'render-order-only updates must preserve the Rust plan');

  label.text = 'Only the final desired value';
  label.text = 'Updated';
  scene.updateMatrixWorld();
  assert.equal(label.layout, undefined);
  assert.ok(group.children.some((child) => child.isMesh));
  assert.equal(group.children.filter((child) => child.isMesh)[0], firstDraws[0]);
  assert.equal(
    firstDraws[0].geometry.instanceCount,
    7,
    'compatible revisions must retain draws and resize live counts',
  );
  assert.notEqual(label.measureLayout(), measurement, 'a semantic update must invalidate the measurement cache');
  assert.notEqual(label.inspectLayout(), inspection, 'a semantic update must invalidate the inspection cache');

  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.textGroup, undefined);
  assert.equal(label.bound, true, 'a directly attached Text must own an implicit batch');
  assert.equal(group.textCount, 0);

  group.add(label);
  scene.updateMatrixWorld();
  group.dispose();
  assert.equal(group.disposed, true);
  assert.equal(label.disposed, false);
  assert.equal(label.bound, false);
  assert.equal(label.textGroup, undefined);

  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.bound, true, 'text retained by a disposed group can bind elsewhere');

  label.removeFromParent();
  label.dispose();
  font.dispose();
  runtime.dispose();
});

test('Three retries an unapplied Rust publication before requesting another engine delta', async () => {
  const registry = new FontRegistry();
  const instrumented = await createInstrumentedRuntime(registry);
  const runtime = instrumented.runtime;
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  let failMaterial = true;
  let label;
  const material = defineTextMaterial((context) => {
    if (failMaterial) {
      assert.throws(() => label.measureLayout(), /cannot reenter Three render-plan application/u);
      throw new Error('deliberate material realization failure');
    }
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const group = new TextGroup();
  label = new Text({ font, material, text: 'Retry me' });
  group.add(label);
  scene.add(group);

  scene.updateMatrixWorld();
  assert.match(String(group.error), /deliberate material realization failure/u);
  assert.equal(label.error, group.error, 'group-owned failures must remain visible from the child Text');
  assert.equal(instrumented.crossings, 1);
  assert.equal(group.children.filter((child) => child.isMesh).length, 0);

  failMaterial = false;
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  assert.equal(label.error, undefined);
  assert.equal(instrumented.crossings, 1, 'retrying an owned command buffer must not cross into Rust again');
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);

  group.dispose();
  label.dispose();
  font.dispose();
  runtime.dispose();
});

test('TextGroup drops disposed descendants and reuses their committed transform identities', async () => {
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const survivor = new Text({ font, text: 'A' });
  group.add(survivor);
  scene.add(group);
  scene.updateMatrixWorld();

  let retainedTransformBytes;
  for (let index = 0; index < 12; index += 1) {
    const transient = new Text({ font, text: 'B' });
    group.add(transient);
    scene.updateMatrixWorld();
    const draw = group.children.find((child) => child.isMesh);
    assert.ok(draw);
    const transformBytes = draw.geometry.getAttribute('_pmndrsTextTransforms').array.byteLength;
    retainedTransformBytes ??= transformBytes;
    assert.equal(transformBytes, retainedTransformBytes, 'committed removals must make transform identities reusable');

    transient.dispose();
    assert.doesNotThrow(
      () => scene.updateMatrixWorld(),
      'a disposed child may remain attached until its host removes it',
    );
    assert.equal(group.error, undefined);
    assert.equal(group.textCount, 1);
    transient.removeFromParent();
  }

  const draw = group.children.find((child) => child.isMesh);
  assert.equal(draw.geometry.instanceCount, 1);
  group.dispose();
  survivor.dispose();
  font.dispose();
  runtime.dispose();
});

test('Three retires materials bound to a replaced buffer generation', async () => {
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const materials = [];
  const disposed = new Set();
  const material = defineTextMaterial((context) => {
    const created = context.createDefaultMaterial();
    created.addEventListener('dispose', () => disposed.add(created));
    materials.push(created);
    return created;
  });
  const scene = new THREE.Scene();
  const group = new TextGroup({ capacity: { size: 2, policy: 'grow' } });
  const label = new Text({ font, material, text: 'AB' });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  const initialMaterial = group.children.find((child) => child.isMesh)?.material;
  assert.equal(initialMaterial, materials[0]);

  label.text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  scene.updateMatrixWorld();
  assert.ok(materials.length > 1, 'growing physical buffers must realize a material for the new generation');
  assert.ok(disposed.has(initialMaterial), 'the material retaining the retired generation must be disposed');

  group.dispose();
  label.dispose();
  font.dispose();
  runtime.dispose();
});

test('one Rust plan partitions a mixed Bitmap to Slug fallback stack', async () => {
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const [latin, icon] = await Promise.all([
    runtime.loadFont({
      input: { baked: dataUrl(await readFile(fontUrl)) },
      raster: { technique: bitmap, options: { strikes: [16] } },
    }),
    runtime.loadFont({
      input: { baked: dataUrl(gunzipSync(await readFile(iconSlugFontUrl))) },
      raster: { technique: slug, options: {} },
    }),
  ]);
  const realizedTechniques = [];
  const material = defineTextMaterial((context) => {
    realizedTechniques.push(context.technique);
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const label = new Text({
    font: createFontStack(latin, icon),
    material,
    text: 'Hello \uf0ac',
  });
  scene.add(label);
  scene.updateMatrixWorld();

  const draws = label.children.filter((child) => child.isMesh);
  assert.equal(label.error, undefined);
  assert.equal(draws.length, 2, 'Rust must partition fallback glyphs by renderer program and resource');
  assert.equal(
    draws.reduce((count, draw) => count + draw.geometry.instanceCount, 0),
    6,
  );
  assert.deepEqual(realizedTechniques.sort(), [bitmap.id, slug.id].sort());
  assert.deepEqual(
    draws.map((draw) => draw.geometry.getAttribute('_pmndrsText_2').itemSize).sort(),
    [2, 4],
    'Bitmap vec2 and Slug vec4 records must coexist without a user technique selector',
  );

  label.dispose();
  latin.dispose();
  icon.dispose();
  runtime.dispose();
});

test('TextGroup realizes two public Text objects as one indexed Rust draw', async () => {
  const registry = new FontRegistry();
  const instrumented = await createInstrumentedRuntime(registry);
  const runtime = instrumented.runtime;
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const scene = new THREE.Scene();
  const group = new TextGroup({ renderOrder: 3 });
  const left = new Text({ font, text: 'AB' });
  const right = new Text({ font, text: 'CD' });
  left.position.x = 2;
  right.position.x = 5;
  group.add(left, right);
  scene.add(group);
  scene.updateMatrixWorld();

  assert.equal(group.error, undefined);
  const draws = group.children.filter((child) => child.isMesh);
  assert.equal(draws.length, 1, 'compatible paragraphs must batch in Rust before Three sees the plan');
  assert.equal(draws[0].geometry.instanceCount, 4);
  const start = draws[0].userData.pmndrsTextRunStart;
  const indices = draws[0].geometry.getAttribute('_pmndrsText_15').array;
  assert.deepEqual(Array.from(indices.subarray(start, start + 4)), [1, 1, 2, 2]);
  const transforms = draws[0].geometry.getAttribute('_pmndrsTextTransforms');
  assert.equal(transforms.array[1 * 16 + 12], 2);
  assert.equal(transforms.array[2 * 16 + 12], 5);

  const initialLeftMeasurement = left.measureLayout();
  const initialRightMeasurement = right.measureLayout();
  assert.ok(initialLeftMeasurement);
  assert.ok(initialRightMeasurement);
  instrumented.reset();
  left.set({});
  assert.equal(left.measureLayout(), initialLeftMeasurement, 'an empty update must preserve the cached measurement');
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 0, 'an empty update and cached measurement must not cross into Rust');

  left.deleteText(1, 2);
  scene.updateMatrixWorld();
  assert.deepEqual(instrumented.latestTextMutations(), [{ start: 1, deleteCount: 1, insert: '' }]);
  assert.equal(left.text, 'A');

  left.insertText(1, 'B');
  scene.updateMatrixWorld();
  assert.deepEqual(instrumented.latestTextMutations(), [{ start: 1, deleteCount: 0, insert: 'B' }]);
  assert.equal(left.text, 'AB');

  left.text = 'AY';
  scene.updateMatrixWorld();
  assert.deepEqual(
    instrumented.latestTextMutations(),
    [{ start: 1, deleteCount: 1, insert: 'Y' }],
    'declarative assignment must serialize its smallest scalar-aligned replacement',
  );

  left.replaceText(1, 2, 'Z');
  left.deleteText(0, 1);
  left.insertText(0, 'A');
  scene.updateMatrixWorld();
  assert.deepEqual(instrumented.latestTextMutations(), [
    { start: 1, deleteCount: 1, insert: 'Z' },
    { start: 0, deleteCount: 1, insert: '' },
    { start: 0, deleteCount: 0, insert: 'A' },
  ]);
  assert.equal(left.text, 'AZ');

  left.replaceText(0, 2, '🌍');
  assert.throws(() => left.insertText(1, '!'), /must not split a Unicode scalar/u);
  scene.updateMatrixWorld();
  assert.equal(left.text, '🌍');
  left.text = 'AB';
  scene.updateMatrixWorld();

  instrumented.reset();
  left.contentBox = { width: { mode: 'exact', size: 100 }, wrap: 'word' };
  const resizedMeasurement = left.measureLayout();
  assert.ok(resizedMeasurement, 'a pending mutation must produce its requested measurement');
  assert.notEqual(resizedMeasurement, initialLeftMeasurement);
  assert.deepEqual(
    right.measureLayout(),
    initialRightMeasurement,
    'one requested semantic publication must populate every retained paragraph',
  );
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 1, 'mutation, render plan, and demanded measurement must share one text_update');

  const leftOrigins = left.snapshotGlyphOrigins();
  const rightOrigins = right.snapshotGlyphOrigins();
  assert.equal(leftOrigins.shapedX.length, 2);
  assert.equal(rightOrigins.shapedX.length, 2);
  const shiftedRightX = rightOrigins.shapedX.slice();
  const shiftedLeftX = leftOrigins.shapedX.slice();
  shiftedLeftX[0] += 2;
  shiftedRightX[0] += 4;
  const originsAttribute = draws[0].geometry.getAttribute('_pmndrsText_1');
  const canonicalOrigins = originsAttribute.array;
  const pboUploadOrigins = new Float32Array(canonicalOrigins.length + 4);
  pboUploadOrigins.set(canonicalOrigins);
  originsAttribute.array = pboUploadOrigins;
  originsAttribute.clearUpdateRanges();
  left.setGlyphOrigins({ layout: leftOrigins.layout, x: shiftedLeftX, y: leftOrigins.shapedY });
  const leftUploadRanges = originsAttribute.updateRanges.map((range) => ({ ...range }));
  right.setGlyphOrigins({ layout: rightOrigins.layout, x: shiftedRightX, y: rightOrigins.shapedY });
  assert.ok(
    leftUploadRanges.every(({ start: rangeStart, count }) =>
      originsAttribute.updateRanges.some(
        (range) => range.start <= rangeStart && range.start + range.count >= rangeStart + count,
      ),
    ),
    'separate presentation edits may coalesce but must retain every earlier upload range',
  );
  assert.equal(left.snapshotGlyphOrigins().displayedX[0], leftOrigins.shapedX[0] + 2);
  assert.equal(right.snapshotGlyphOrigins().displayedX[0], rightOrigins.shapedX[0] + 4);
  assert.deepEqual(
    pboUploadOrigins.subarray(0, canonicalOrigins.length),
    canonicalOrigins,
    'WebGL2 PBO replacement storage must receive the same dirty ranges as canonical plan storage',
  );
  assert.deepEqual(pboUploadOrigins.subarray(canonicalOrigins.length), new Float32Array(4));

  const version = transforms.version;
  right.position.x = 7;
  scene.updateMatrixWorld();
  assert.equal(group.children.filter((child) => child.isMesh)[0], draws[0]);
  assert.equal(transforms.version, version + 1);
  assert.equal(transforms.array[2 * 16 + 12], 7);
  assert.equal(
    right.snapshotGlyphOrigins().displayedX[0],
    rightOrigins.shapedX[0] + 4,
    'transform-only updates must not cross into Rust or discard presentation overrides',
  );

  originsAttribute.clearUpdateRanges();
  left.clearGlyphOriginOverrides();
  const clearedOriginRanges = originsAttribute.updateRanges.map((range) => ({ ...range }));
  assert.ok(clearedOriginRanges.length > 0);
  right.style = { ...right.style, color: '#00ff00' };
  scene.updateMatrixWorld();
  assert.ok(
    clearedOriginRanges.every(({ start: rangeStart, count }) =>
      originsAttribute.updateRanges.some(
        (range) => range.start <= rangeStart && range.start + range.count >= rangeStart + count,
      ),
    ),
    'a second plan before rendering must retain every earlier pending upload range',
  );

  right.style = { ...right.style, fontSize: 20 };
  scene.updateMatrixWorld();
  const resizedOrigins = right.snapshotGlyphOrigins();
  assert.notEqual(resizedOrigins.layout, rightOrigins.layout);
  assert.deepEqual(
    resizedOrigins.displayedX,
    resizedOrigins.shapedX,
    'an authoritative command-buffer update must retire the previous presentation override',
  );

  instrumented.reset();
  left.text = 'ABC';
  const replacedMeasurement = left.measureLayout();
  assert.equal(replacedMeasurement?.glyphCount, 3);
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 1, 'text replacement and demanded measurement must share one text_update');
  const replacedDraws = group.children.filter((child) => child.isMesh);
  assert.equal(replacedDraws.length, 1);
  assert.equal(replacedDraws[0].geometry.instanceCount, 5, 'the published command buffer must include the new glyph');

  group.dispose();
  left.dispose();
  right.dispose();
  font.dispose();
  runtime.dispose();
});

async function createInstrumentedRuntime(registry) {
  const wasm = await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url));
  const abi = JSON.parse(await readFile(new URL('../../dist/text-shaper-abi-v0.json', import.meta.url), 'utf8'));
  const originalInstantiate = WebAssembly.instantiate;
  let crossings = 0;
  let latestRequest;
  WebAssembly.instantiate = async (source, imports) => {
    const instance = await originalInstantiate(source, imports);
    const exports = { ...instance.exports };
    const update = exports[abi.functions.textUpdate];
    assert.equal(typeof update, 'function', 'instrumented shaper must export text_update');
    exports[abi.functions.textUpdate] = (...arguments_) => {
      crossings += 1;
      const [, pointer, length] = arguments_;
      latestRequest = new Uint8Array(exports.memory.buffer, pointer, length).slice();
      return update(...arguments_);
    };
    return { exports };
  };
  try {
    const runtime = await createTextRuntime({ registry, wasm });
    return {
      runtime,
      get crossings() {
        return crossings;
      },
      reset() {
        crossings = 0;
      },
      latestTextMutations() {
        assert.ok(latestRequest, 'a text update request must have been captured');
        const request = abi.layouts.engineUpdateRequest;
        const mutation = abi.layouts.engineTextMutation;
        const view = new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength);
        const offset = view.getUint32(request.textMutationsOffset, true);
        const count = view.getUint32(request.textMutationCount, true);
        return Array.from({ length: count }, (_recordValue, index) => {
          const record = offset + index * mutation.size;
          const insertOffset = view.getUint32(record + mutation.insertOffset, true);
          const insertCount = view.getUint32(record + mutation.insertCount, true);
          const insert = String.fromCharCode(
            ...Array.from({ length: insertCount }, (_unitValue, unit) => view.getUint16(insertOffset + unit * 2, true)),
          );
          return {
            start: view.getUint32(record + mutation.textStart, true),
            deleteCount: view.getUint32(record + mutation.deleteCount, true),
            insert,
          };
        });
      },
    };
  } finally {
    WebAssembly.instantiate = originalInstantiate;
  }
}

test('Bitmap strike changes fully initialize a replacement indexed batch', async () => {
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(densityFontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16, 32] } },
  });
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const label = new Text({
    font,
    rasterPixelRatio: 2,
    text: 'AB',
    style: { fontSize: 8 },
    contentBox: { width: { mode: 'exact', size: 80 }, wrap: 'word' },
  });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);

  label.style = { ...label.style, fontSize: 16 };
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'crossing from the 16 ppem strike to 32 ppem must publish successfully');
  const draw = group.children.find((child) => child.isMesh);
  assert.ok(draw);
  const start = draw.userData.pmndrsTextRunStart;
  const transforms = draw.geometry.getAttribute('_pmndrsText_15').array;
  assert.deepEqual(Array.from(transforms.subarray(start, start + draw.geometry.instanceCount)), [1, 1]);

  label.contentBox = { ...label.contentBox, width: { mode: 'exact', size: 40 } };
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'width-only reflow must retain the initialized transform stream');

  group.dispose();
  label.dispose();
  font.dispose();
  runtime.dispose();
});

test('multi-page Bitmap strikes remain one ordered texture-array draw', async () => {
  const runtime = await createTextRuntime({
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(densityFontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16, 32] } },
  });
  assert.ok(font.data.strikes[1].pages.length > 1, 'the regression fixture must contain a multi-page 32 ppem strike');
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const label = new Text({
    font,
    rasterPixelRatio: 2,
    text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !?.,;:'.repeat(24),
    style: { fontSize: 16 },
    contentBox: { width: { mode: 'exact', size: 480 }, wrap: 'word' },
  });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  const draws = group.children.filter((child) => child.isMesh);
  assert.equal(draws.length, 1, 'atlas page changes must select texture-array layers without fragmenting draws');
  assert.ok(draws[0].geometry.getAttribute('_pmndrsText_6'), 'the Bitmap plan must publish a page-layer stream');

  group.dispose();
  label.dispose();
  font.dispose();
  runtime.dispose();
});

test('Rust ellipsis reshapes only the narrowed unsafe line boundary', async () => {
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(amiriFontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const text = 'مرحبا بالعالم';

  const scene = new THREE.Scene();
  const label = new Text({
    font,
    text,
    style: { fontSize: 16 },
    contentBox: {
      width: { mode: 'exact', size: 37 },
      maxLines: 1,
      wrap: 'none',
      overflow: 'ellipsis',
    },
  });
  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.error, undefined);
  const inspection = label.inspectLayout();
  assert.ok(inspection);
  assert.equal(inspection.lineTextEnds[0], 3, 'the fixed width must preserve the unsafe-boundary fixture');
  assert.equal(inspection.clusters.at(-1), 3, 'the ellipsis is anchored at the truncation boundary');
  assert.deepEqual([...inspection.glyphIds], [61, 2613, 2598, 6597]);
  assert.deepEqual([...inspection.clusters], [2, 1, 0, 3]);
  assert.deepEqual([...inspection.x], [0.23199999332427979, 10.807999610900879, 18.375999450683594, 23.91200065612793]);

  label.dispose();
  font.dispose();
  runtime.dispose();
});

test('TextGroup atomically replaces child paragraphs without multiplying retained text capacity', async () => {
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const scene = new THREE.Scene();
  const group = new TextGroup({ capacity: { size: 4_096, policy: 'grow' } });
  const first = [new Text({ font, text: 'A' }), new Text({ font, text: 'B' })];
  group.add(...first);
  scene.add(group);
  scene.updateMatrixWorld();

  const second = ['C', 'D', 'E'].map((text) => new Text({ font, text }));
  group.remove(...first);
  group.add(...second);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);
  assert.equal(group.children.find((child) => child.isMesh).geometry.instanceCount, 3);

  const third = ['Y', 'Z'].map((text) => new Text({ font, text }));
  group.remove(...second);
  group.add(...third);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'a recycled Rust paragraph must not retain its previous semantic contents');
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);
  assert.equal(group.children.find((child) => child.isMesh).geometry.instanceCount, 2);

  group.dispose();
  for (const text of [...first, ...second, ...third]) text.dispose();
  font.dispose();
  runtime.dispose();
});

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
