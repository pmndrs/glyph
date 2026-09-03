import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { Constraints, createFontStack, glyph, ParagraphLayout, TextStyle, txt } from '@pmndrs/glyph';
import { createFontLibrary, loadFont } from '../../dist/loader.js';
import { GlyphHandleState } from '../../dist/internal/handle-state.js';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import {
  defineThreeConfig,
  defineTextMaterial,
  localToWorldMatrix,
  span as textSpan,
  ThreeConfig,
  worldToLocalMatrix,
} from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { bitmapSchema } from '../../dist/raster/bitmap.js';
import { msdfSchema } from '../../dist/raster/msdf.js';
import { slugSchema } from '../../dist/raster/slug.js';
import { decorationSchema, threeSystemBuffers } from '../../dist/three/codec.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

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
const glyphAttribute = (bufferId) => `_pmndrsGlyph_${bufferId}`;
const instrumentedGlyph = instrumentNextGlyphEngine();
let nextThreeTestHandle = 1;
after(() => instrumentedGlyph.restoreInstantiate());

async function createThreeTestHandle(t, config = ThreeConfig) {
  await glyph.init();
  const handle = glyph.handle(`three:integration:case:${String(nextThreeTestHandle++)}`, config);
  t.after(() => handle.dispose());
  return handle;
}

test('failed Glyph initialization retains one rejected operation until the module is replaced', async () => {
  const isolatedModule = await import(new URL('../../dist/glyph.js?failed-initialization', import.meta.url));
  const isolatedGlyph = isolatedModule.glyph;
  const invalidWasm = new Uint8Array([0]);
  const firstInit = isolatedGlyph.init({ wasm: invalidWasm });

  assert.equal(isolatedGlyph.init({ wasm: invalidWasm }), firstInit, 'concurrent failure shares one operation');
  await assert.rejects(firstInit, WebAssembly.CompileError);

  const repeatedInit = isolatedGlyph.init({ wasm: invalidWasm });
  assert.equal(repeatedInit, firstInit, 'a rejected initialization cannot start another Wasm engine implicitly');
  await assert.rejects(repeatedInit, WebAssembly.CompileError);
});

test('one initialized Glyph runtime creates independent named Three handles over immutable root fonts', async () => {
  const firstInit = glyph.init();
  const secondInit = glyph.init();
  assert.equal(firstInit, secondInit, 'concurrent initialization shares one operation');
  try {
    await firstInit;
  } finally {
    instrumentedGlyph.restoreInstantiate();
  }
  assert.equal(glyph.init(), firstInit, 'successful initialization keeps one settled promise forever');

  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const first = glyph.handle('three:integration:first', ThreeConfig);
  assert.equal(first.handle, first, 'the handle is its anonymous root owner');
  assert.equal(
    first.name,
    undefined,
    'the handle fronts the anonymous root rather than exposing its integration label',
  );
  let wrappedEncodeCalls = 0;
  let wrappedResolveCalls = 0;
  let wrappedRendererFactories = 0;
  let wrappedPrepareCalls = 0;
  let wrappedTransformSyncCalls = 0;
  const second = glyph.handle('three:integration:second', {
    ...ThreeConfig,
    encode(context) {
      wrappedEncodeCalls += 1;
      return ThreeConfig.encode(context);
    },
    resolve(context) {
      wrappedResolveCalls += 1;
      return ThreeConfig.resolve(context);
    },
    renderer(context) {
      wrappedRendererFactories += 1;
      const renderer = ThreeConfig.renderer(context);
      return {
        decode(frame) {
          wrappedPrepareCalls += 1;
          assert.equal(frame.delivery, 'borrowed-command-buffer');
          assert.ok(frame.displayList.kind === 'unchanged' || frame.displayList.kind === 'replace');
          return renderer.decode(frame);
        },
        syncTransforms(updates) {
          wrappedTransformSyncCalls += 1;
          renderer.syncTransforms(updates);
        },
        dispose: () => renderer.dispose(),
      };
    },
  });
  const scene = new THREE.Scene();
  const secondScene = new THREE.Scene();
  const secondSceneRoot = first('secondary-scene');
  assert.equal(first('secondary-scene'), secondSceneRoot, 'one handle interns named roots by label');
  assert.equal(secondSceneRoot.handle, first, 'a terminal named root identifies its owning handle without nesting');
  const label = first.createText({ font, text: 'Handle owned', style: { fontSize: 16 } });
  assert.equal('createText' in first, true, 'the callable handle reflects its anonymous-root surface');
  assert.equal('handle' in first, true);
  assert.equal('createText' in first('hud'), true, 'named roots reflect the same adapter extension surface');
  assert.equal('renderObject' in first, false, 'renderer publication objects stay behind the Three config schema');
  assert.equal('scene' in secondSceneRoot, false, 'Scene discovery stays behind the Three root host');
  assert.equal('services' in secondSceneRoot, false, 'core root services do not leak through public roots');
  assert.equal('renderer' in secondSceneRoot, false, 'the configured renderer does not leak through public roots');
  assert.equal('acquireFont' in secondSceneRoot, false, 'internal Font acquisition does not leak through public roots');
  const secondSceneLabel = secondSceneRoot.createText({
    font,
    text: 'Same handle, other scene',
    style: { fontSize: 16 },
  });
  const group = second.createTextGroup();
  const grouped = second.createText({ font, text: 'Independent', style: { fontSize: 16 } });
  const disposed = second.createText({ font, text: 'Disposed', style: { fontSize: 16 } });
  disposed.dispose();
  group.add(grouped);
  scene.add(label, group);
  secondScene.add(secondSceneLabel);

  try {
    scene.updateMatrixWorld(true);
    secondScene.updateMatrixWorld(true);
    assert.equal(wrappedEncodeCalls, 1, 'a spread config participates in its handle construction');
    assert.equal(wrappedRendererFactories, 1, 'one config renderer is created for the TextGroup boundary');
    assert.ok(wrappedResolveCalls > 0, 'the selected resolver binds acquired portable resources');
    assert.ok(wrappedPrepareCalls > 0, 'the selected renderer prepares the bound command buffer');
    assert.ok(wrappedTransformSyncCalls > 0, 'transform synchronization uses the renderer side path');
    const semanticCounts = {
      resolve: wrappedResolveCalls,
      prepare: wrappedPrepareCalls,
      transforms: wrappedTransformSyncCalls,
    };
    grouped.position.x += 1;
    scene.updateMatrixWorld(true);
    assert.equal(wrappedResolveCalls, semanticCounts.resolve, 'transform-only shape does not resolve');
    assert.equal(wrappedPrepareCalls, semanticCounts.prepare, 'transform-only shape does not prepare semantic state');
    assert.ok(wrappedTransformSyncCalls > semanticCounts.transforms, 'transform-only shape synchronizes the renderer');
    const firstDrawRoot = scene.getObjectByName('@pmndrs/glyph:anonymous');
    assert.ok(firstDrawRoot, 'the handle fronts one anonymous root that late-binds to the Text Scene');
    const secondDrawRoot = secondScene.getObjectByName('@pmndrs/glyph:secondary-scene');
    assert.ok(secondDrawRoot, 'a named root gives the same handle an independent publication stream in another Scene');
    assert.ok(
      firstDrawRoot.children.some((child) => child.isMesh),
      'root batches realize as renderer-owned meshes',
    );
    assert.ok(
      secondDrawRoot.children.some((child) => child.isMesh),
      'the second root owns its own renderer meshes',
    );
    assert.throws(() => group.add(label), /different Glyph roots/);
    assert.throws(() => group.add(disposed), /disposed Text cannot be attached/);
    scene.updateMatrixWorld(true);
    assert.equal(group.textCount, 1, 'rejected Text attachments leave the valid hierarchy unchanged');
    assert.ok(rootDraws(scene).length > 0, 'the valid hierarchy still renders through ordinary scene traversal');
    assert.throws(() => glyph.handle('three:integration:first', ThreeConfig), /already exists/);
  } finally {
    disposed.dispose();
    label.dispose();
    secondSceneLabel.dispose();
    grouped.dispose();
    group.dispose();
    first.dispose();
    second.dispose();
    font.dispose();
  }

  const reused = glyph.handle('three:integration:first', ThreeConfig);
  reused.dispose();
});

test('glyph.shape preserves root, codec, and font ownership while batching handles', async (t) => {
  const first = await createThreeTestHandle(t);
  const second = await createThreeTestHandle(t);
  const named = first('batch-scene');
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const firstScene = new THREE.Scene();
  const secondScene = new THREE.Scene();
  const thirdScene = new THREE.Scene();
  const labels = [
    first.createText({ font, text: 'anonymous' }),
    named.createText({ font, text: 'named' }),
    second.createText({ font, text: 'second handle' }),
  ];
  firstScene.add(labels[0]);
  secondScene.add(labels[1]);
  thirdScene.add(labels[2]);
  instrumentedGlyph.reset();

  try {
    glyph.shape();
    assert.equal(instrumentedGlyph.crossings, 1, 'all dirty roots share one engine update call');
    assert.equal(instrumentedGlyph.latestBatchCount, 3, 'the batch carries every dirty root exactly once');
    const firstBatchRootIds = instrumentedGlyph.latestBatchRootIds;
    assert.equal(new Set(firstBatchRootIds).size, labels.length, 'the public root set emits each identity once');
    assert.ok(rootDraws(firstScene).length > 0);
    assert.ok(rootDraws(secondScene, 'batch-scene').length > 0);
    assert.ok(rootDraws(thirdScene).length > 0);
    assert.equal(
      rootDraws(firstScene, 'batch-scene').length,
      0,
      'a named root cannot leak into its handle default root',
    );
    assert.equal(rootDraws(secondScene).length, 0, 'the default root cannot leak into a named root publication');
    assert.equal(rootDraws(thirdScene, 'batch-scene').length, 0, 'one handle cannot consume another handle root');

    glyph.shape();
    assert.equal(instrumentedGlyph.crossings, 1, 'an unchanged global shape performs no engine update');

    for (const [index, label] of labels.entries()) label.text = `updated ${String(index)}`;
    glyph.shape();
    assert.equal(instrumentedGlyph.crossings, 2);
    assert.equal(instrumentedGlyph.latestBatchCount, 3);
    assert.deepEqual(instrumentedGlyph.latestBatchRootIds, firstBatchRootIds, 'later batches preserve root identity');
  } finally {
    for (const label of labels) label.dispose();
    font.dispose();
  }
});

test('a configured renderer receives a command-buffer view only for its synchronous decode', async (t) => {
  let captured;
  const three = await createThreeTestHandle(t, {
    ...ThreeConfig,
    renderer() {
      return {
        decode(view) {
          captured = view;
          return { result: undefined, commit: () => undefined, discard: () => undefined };
        },
        syncTransforms: () => undefined,
        dispose: () => undefined,
      };
    },
  });
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({ font, text: 'Borrowed command buffer' });
  scene.add(label);

  try {
    glyph.shape();
    assert.equal(captured.delivery, 'borrowed-command-buffer');
    assert.equal(captured.displayList.kind, 'replace');
    assert.ok(captured.displayList.value.children.length > 0);
    assert.throws(
      () => captured.displayList.value.children.at(0),
      /borrowed text render plan has expired/u,
      'renderer code cannot lazily read a command after decode returns',
    );
  } finally {
    label.dispose();
    font.dispose();
  }
});

test('one Three root binds one Scene and exposes its semantic name to material factories', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const root = three('semantic-hud');
  const first = root.createText({ font, text: 'first scene' });
  const second = root.createText({ font, text: 'second scene' });
  const firstScene = new THREE.Scene();
  const secondScene = new THREE.Scene();
  const materialRoots = [];
  root.material = defineTextMaterial((context) => {
    materialRoots.push(context.root);
    return context.createDefaultMaterial();
  });
  firstScene.add(first);
  secondScene.add(second);

  try {
    assert.throws(
      () => glyph.shape(),
      /spans more than one Scene; select a different handle root for each Scene/,
      'a root cannot ambiguously publish into two host scenes',
    );
    firstScene.add(second);
    firstScene.updateMatrixWorld(true);
    const renderObject = firstScene.getObjectByName('@pmndrs/glyph:semantic-hud');
    assert.ok(renderObject);
    assert.equal(renderObject.parent, firstScene, 'the publication object is attached directly to the Scene');
    assert.equal(first.parent, firstScene, 'Text stays a sibling of its publication object');
    assert.equal(second.parent, firstScene, 'every Text stays a sibling of the shared publication object');
    assert.equal(
      renderObject.children.some((child) => child.isMesh),
      true,
      'generated meshes remain children of the publication object',
    );
    assert.equal(materialRoots.length > 0, true);
    assert.equal(materialRoots[0].name, 'semantic-hud', 'the semantic root name is not derived from Scene.uuid');
    assert.equal(materialRoots[0].scene, firstScene);
    assert.equal(materialRoots[0].renderObject, renderObject);
  } finally {
    first.dispose();
    second.dispose();
    root.dispose();
    font.dispose();
  }
});

test('a root releases its renderer publication when its final Text is disposed', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const root = three('transient');
  const scene = new THREE.Scene();
  const first = root.createText({ font, text: 'first' });
  scene.add(first);
  scene.updateMatrixWorld(true);
  assert.ok(scene.getObjectByName('@pmndrs/glyph:transient'));
  assert.ok(root.gpuBytes > 0);

  first.dispose();
  assert.equal(root.textCount, 0);
  assert.equal(
    scene.getObjectByName('@pmndrs/glyph:transient'),
    undefined,
    'the empty root no longer retains its Scene',
  );
  assert.equal(root.gpuBytes, 0, 'the empty root releases its planner and renderer resources');

  const second = root.createText({ font, text: 'second' });
  scene.add(second);
  scene.updateMatrixWorld(true);
  assert.ok(scene.getObjectByName('@pmndrs/glyph:transient'), 'the same idempotent root can publish again');
  second.dispose();
  font.dispose();
});

test('a root restores its draw object when the host clears and reattaches the authored tree', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const text = three.createText({ font, text: 'reattached' });
  scene.add(text);
  scene.updateMatrixWorld(true);
  assert.ok(scene.getObjectByName('@pmndrs/glyph:anonymous'));
  assert.ok(rootDraws(scene).length > 0);

  scene.clear();
  assert.equal(scene.getObjectByName('@pmndrs/glyph:anonymous'), undefined);
  scene.add(text);
  scene.updateMatrixWorld(true);
  assert.ok(
    scene.getObjectByName('@pmndrs/glyph:anonymous'),
    'the stable scene identity must not hide a detached draw object',
  );
  assert.ok(rootDraws(scene).length > 0);

  text.dispose();
  font.dispose();
});

test('TextGroup ancestry cannot smuggle a Text across Glyph roots', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const world = three('world');
  const hud = three('hud');
  const worldGroup = world.createTextGroup();
  const bridge = new THREE.Group();
  const hudText = hud.createText({ font, text: 'wrong root' });
  const scene = new THREE.Scene();
  worldGroup.add(bridge);
  bridge.add(hudText);
  scene.add(worldGroup);
  try {
    assert.throws(() => glyph.shape(), /different Glyph roots/);
  } finally {
    hudText.dispose();
    worldGroup.dispose();
    font.dispose();
  }
});

test('text property registries validate and freeze reusable rules', () => {
  for (const [registry, rules] of [
    [TextStyle, { body: { fontSize: 16 } }],
    [ParagraphLayout, { centered: { align: 'center' } }],
    [Constraints, { card: { width: { mode: 'at-most', size: 320 } } }],
  ]) {
    const created = registry.create(rules);
    assert.ok(Object.isFrozen(created));
    assert.ok(Object.isFrozen(Object.values(created)[0]));
  }
  assert.throws(() => Constraints.create({ broken: { width: { mode: 'exact', size: Number.NaN } } }), /size/);
});

test('detached matrix helpers round-trip aliased and independent targets with a hoisted inverse', () => {
  const rootWorld = new THREE.Matrix4().compose(
    new THREE.Vector3(4, -3, 2),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.4, 0.1)),
    new THREE.Vector3(1.5, 0.75, 2),
  );
  const rootWorldInverse = rootWorld.clone().invert();
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(-2, 5, 1),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.3, 0.6)),
    new THREE.Vector3(0.5, 1.25, 0.8),
  );
  const world = localToWorldMatrix(rootWorld, local, new THREE.Matrix4());
  const independent = worldToLocalMatrix(rootWorldInverse, world, new THREE.Matrix4());
  const aliased = world.clone();
  worldToLocalMatrix(rootWorldInverse, aliased, aliased);
  for (let lane = 0; lane < 16; lane += 1) {
    assert.ok(Math.abs(independent.elements[lane] - local.elements[lane]) < 1e-6);
    assert.ok(Math.abs(aliased.elements[lane] - local.elements[lane]) < 1e-6);
  }
});

test('Text.breakApart imports a planner-assisted copy with exact world alignment and full matrices', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const sourceParent = new THREE.Group();
  sourceParent.position.set(-4, 2, 3);
  sourceParent.rotation.set(0.15, -0.3, 0.25);
  sourceParent.scale.set(1.2, 0.8, 1.1);
  scene.add(sourceParent);
  const label = three.createText({ font, text: 'Glyphs move', style: { fontSize: 16 } });
  label.position.set(7, -3, 2);
  sourceParent.add(label);
  scene.updateMatrixWorld(true);
  const traversedSourceMatrix = label.matrix.clone();
  label.position.x += 2;
  assert.ok(
    label.matrix.equals(traversedSourceMatrix),
    'the fixture must leave the source local matrix stale before breakApart',
  );

  let detached;
  try {
    [detached] = label.breakApart();
    assert.deepEqual(
      detached.matrix.elements,
      label.matrix.elements,
      'the detached root must compose and copy the current source-local transform without ancestor traversal',
    );
    assert.equal(detached.position.x, 9, 'the copy must include local TRS changes made after the last traversal');
    sourceParent.add(detached);
    label.visible = false;

    assert.ok(detached.count > 0);
    assert.ok(detached.count < label.glyphs().glyphCount, 'the non-drawing space remains semantic-only');
    assert.ok(
      detached.children.some((child) => child.isMesh),
      'the copied checkpoint must realize Three draws',
    );
    const firstMeasurement = detached.measurements[0];
    assert.equal(firstMeasurement.geometry.kind, 'metric-quad');
    assert.equal(firstMeasurement.geometry.coordinates, 'glyph-local');
    const anchorBeforeSourceMove = firstMeasurement.anchorPoint({ x: 'center', y: 'center' });
    label.position.x += 100;
    scene.updateMatrixWorld(true);
    assert.ok(
      firstMeasurement.anchorPoint({ x: 'center', y: 'center' }).equals(anchorBeforeSourceMove),
      'detached measurement anchors remain in the copied glyph root local space',
    );
    label.position.x -= 100;
    scene.updateMatrixWorld(true);
    for (const [vertexIndex, position] of firstMeasurement.geometry.positions.entries()) {
      assert.ok(
        position
          .clone()
          .applyMatrix4(firstMeasurement.originalMatrix)
          .distanceTo(firstMeasurement.localQuad[vertexIndex]) < 1e-6,
        `metric geometry vertex ${vertexIndex} must compose with the original glyph matrix exactly once`,
      );
    }
    // A first-frame physics write can happen after attachment but before the renderer's first
    // scene traversal. Directly assigned Glyphs matrices must already produce current world space.
    for (let index = 0; index < detached.count; index += 1) {
      const matrix = new THREE.Matrix4();
      detached.getWorldMatrixAt(index, matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      const expectedMatrix = detached.matrixWorld.clone().multiply(detached.measurements[index].originalMatrix);
      const expected = new THREE.Vector3().setFromMatrixPosition(expectedMatrix);
      assert.ok(position.distanceTo(expected) < 1e-5, `glyph ${index} must begin at its source world origin`);
      for (let lane = 0; lane < 16; lane += 1) {
        assert.ok(
          Math.abs(matrix.elements[lane] - expectedMatrix.elements[lane]) < 1e-5,
          `glyph ${index} world matrix lane ${lane} must match its retained original transform`,
        );
      }
    }
    scene.updateMatrixWorld(true);

    const draw = detached.children.find((child) => child.isMesh);
    const sourceDraw = rootDraws(scene).find(
      (child) => child.isMesh && child.userData.pmndrsGlyphPrimitiveKind === 'glyph',
    );
    assert.ok(sourceDraw);
    const sourceStableIds = sourceDraw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.stableGlyphId.id));
    const detachedStableIds = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.stableGlyphId.id));
    const sourceOrigins = sourceDraw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id));
    const detachedOrigins = draw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id));
    const sourceSizes = sourceDraw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.size.id));
    const detachedSizes = draw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.size.id));
    assert.ok(sourceStableIds && detachedStableIds && sourceOrigins && detachedOrigins && sourceSizes && detachedSizes);
    const detachedTransformIndices = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id));
    const detachedTransformTable = draw.geometry.getAttribute('_pmndrsGlyphTransforms');
    assert.ok(detachedTransformIndices && detachedTransformTable);
    const firstRecord = draw.userData.pmndrsGlyphRunStart;
    const detachedTransformIndex = detachedTransformIndices.getX(firstRecord);
    const detachedRelativeTransform = detachedTransformTable.array.subarray(
      detachedTransformIndex * 16,
      detachedTransformIndex * 16 + 16,
    );
    const identity = new THREE.Matrix4();
    assert.deepEqual(
      [...detachedRelativeTransform],
      identity.elements,
      'the detached root transform must realize as exact identity without an inverse round trip',
    );
    assert.ok(
      Array.from({ length: detached.count }, (_, index) => detached.glyphAt(index)).some(
        (entry) => entry.sourceIndex > entry.index,
      ),
      'the fixture must include drawable glyphs after a semantic-only space',
    );
    let comparedRecords = 0;
    for (let detachedRecord = 0; detachedRecord < detachedStableIds.count; detachedRecord += 1) {
      const stableId = detachedStableIds.getX(detachedRecord);
      if (stableId === 0) continue;
      let sourceRecord = -1;
      for (let candidate = 0; candidate < sourceStableIds.count; candidate += 1) {
        if (sourceStableIds.getX(candidate) === stableId) {
          sourceRecord = candidate;
          break;
        }
      }
      assert.notEqual(sourceRecord, -1, `copied stable glyph ${stableId} must exist in the source plan`);
      assert.deepEqual(
        [
          detachedOrigins.getX(detachedRecord),
          detachedOrigins.getY(detachedRecord),
          detachedSizes.getX(detachedRecord),
          detachedSizes.getY(detachedRecord),
        ],
        [
          sourceOrigins.getX(sourceRecord),
          sourceOrigins.getY(sourceRecord),
          sourceSizes.getX(sourceRecord),
          sourceSizes.getY(sourceRecord),
        ],
        `copied stable glyph ${stableId} must preserve its drawable geometry across semantic-only records`,
      );
      comparedRecords += 1;
    }
    assert.equal(comparedRecords, detached.count);
    assert.notEqual(draw.material, sourceDraw.material, 'the detached branch owns independent material state');
    const sourceOpacity = sourceDraw.material.opacity;
    detached.materials[0].opacity = 0.35;
    assert.equal(sourceDraw.material.opacity, sourceOpacity, 'detached material edits cannot mutate the live Text');
    const detachedInstanceCount = draw.geometry.instanceCount;
    const detachedStableIdsBeforeSourceEdit = Array.from(detachedStableIds.array);
    const detachedOriginsBeforeSourceEdit = Array.from(detachedOrigins.array);
    label.text = 'the source keeps shaping';
    scene.updateMatrixWorld(true);
    assert.equal(
      detached.children.find((child) => child.isMesh),
      draw,
      'source publications cannot replace a detached draw',
    );
    assert.equal(draw.geometry.instanceCount, detachedInstanceCount);
    assert.deepEqual(Array.from(detachedStableIds.array), detachedStableIdsBeforeSourceEdit);
    assert.deepEqual(Array.from(detachedOrigins.array), detachedOriginsBeforeSourceEdit);
    const transforms = draw.geometry.getAttribute('_pmndrsGlyphInstanceTransforms');
    assert.ok(transforms.count / 4 >= detached.count, 'storage covers the copied plan physical record capacity');
    const pbo = { needsUpdate: false };
    transforms.pbo = pbo;
    const version = transforms.version;
    for (let index = 0; index < detached.count; index += 1) {
      const local = new THREE.Matrix4();
      detached.getMatrixAt(index, local);
      detached.setMatrixAt(index, local);
    }
    assert.ok(transforms.version > version, 'glyph writes must advance the storage version');
    assert.equal(transforms.updateRanges.length, 1, 'per-glyph writes should coalesce into one upload range');
    assert.equal(pbo.needsUpdate, true, 'the WebGL2 PBO mirror must be dirtied with the canonical storage');

    const world = new THREE.Matrix4().compose(
      new THREE.Vector3(11, 4, -5),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.4, 0.7)),
      new THREE.Vector3(1.25, 0.75, 1.5),
    );
    detached.setWorldMatrixAt(0, world);
    const roundTrip = new THREE.Matrix4();
    detached.getWorldMatrixAt(0, roundTrip);
    for (let lane = 0; lane < 16; lane += 1) {
      assert.ok(Math.abs(roundTrip.elements[lane] - world.elements[lane]) < 1e-5);
    }
    const rootX = detached.position.x;
    detached.position.x += 3;
    scene.updateMatrixWorld(true);
    assert.equal(detached.matrix.elements[12], rootX + 3, 'ordinary Three TRS edits must update the detached root');
    detached.dispose();
    assert.throws(() => detached.getMatrixAt(0, new THREE.Matrix4()), /disposed/u);
    assert.throws(() => detached.setMatrixAt(0, new THREE.Matrix4()), /disposed/u);
    detached = undefined;
  } finally {
    detached?.dispose();
    label.dispose();
    font.dispose();
  }
});

test('detached glyphs retain their engine domain after the source and font owners are disposed', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({ font, text: 'outlives source', style: { fontSize: 16 } });
  scene.add(label);
  scene.updateMatrixWorld(true);
  const [detached] = label.breakApart();
  scene.add(detached);
  label.dispose();
  font.dispose();
  three.dispose();
  try {
    assert.ok(detached.materials.length > 0);
    detached.getMatrixAt(0, new THREE.Matrix4());
  } finally {
    detached.dispose();
  }
});

test('Text.breakApart returns a paragraph-scoped independent decoration plan when one exists', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({
    font,
    text: 'decorated text',
    style: { decoration: { underline: true, color: '#38bdf8' }, fontSize: 16 },
  });
  scene.add(label);
  scene.updateMatrixWorld(true);

  let decorations;
  let detached;
  let plain;
  let plainGlyphs;
  try {
    [detached, decorations] = label.breakApart();
    assert.ok(decorations, 'the tuple includes decorations when the committed paragraph draws them');
    scene.add(decorations);
    scene.updateMatrixWorld();
    const copiedDraws = decorations.children.filter((child) => child.isMesh);
    assert.ok(copiedDraws.length > 0);
    assert.ok(copiedDraws.every((draw) => draw.userData.pmndrsGlyphPrimitiveKind === 'decoration'));
    const sourceDraw = rootDraws(scene).find(
      (child) => child.isMesh && child.userData.pmndrsGlyphPrimitiveKind === 'decoration',
    );
    assert.ok(sourceDraw);
    assert.equal(copiedDraws.length, 1);
    assert.equal(copiedDraws[0].geometry.instanceCount, sourceDraw.geometry.instanceCount);
    for (const buffer of [decorationSchema.buffers.rect, decorationSchema.buffers.packed]) {
      const source = sourceDraw.geometry.getAttribute(glyphAttribute(buffer.id));
      const copied = copiedDraws[0].geometry.getAttribute(glyphAttribute(buffer.id));
      assert.ok(source && copied);
      const sourceStart = sourceDraw.userData.pmndrsGlyphRunStart * source.itemSize;
      const copiedStart = copiedDraws[0].userData.pmndrsGlyphRunStart * copied.itemSize;
      const scalarCount = sourceDraw.geometry.instanceCount * source.itemSize;
      assert.deepEqual(
        Array.from(copied.array.subarray(copiedStart, copiedStart + scalarCount)),
        Array.from(source.array.subarray(sourceStart, sourceStart + scalarCount)),
        `the copied decoration ${buffer === decorationSchema.buffers.rect ? 'rectangle' : 'paint'} data must be exact`,
      );
    }
    assert.notEqual(copiedDraws[0].material, sourceDraw.material);
    const copiedMaterial = decorations.materials[0];
    const sourceOpacity = sourceDraw.material.opacity;
    copiedMaterial.opacity = 0.2;
    assert.equal(sourceDraw.material.opacity, sourceOpacity);

    const copiedCount = copiedDraws[0].geometry.instanceCount;
    label.text = 'the live paragraph changed';
    scene.updateMatrixWorld();
    assert.equal(
      copiedDraws[0].geometry.instanceCount,
      copiedCount,
      'source edits cannot reshape the copied decorations',
    );
    decorations.dispose();
    decorations.dispose();
    assert.throws(() => decorations.materials, /disposed/u);
    decorations = undefined;
    detached.dispose();
    detached = undefined;

    plain = three.createText({ font, text: 'plain text', style: { fontSize: 16 } });
    scene.add(plain);
    scene.updateMatrixWorld(true);
    const plainParts = plain.breakApart();
    assert.equal(plainParts.length, 2);
    assert.ok(Object.isFrozen(plainParts));
    [plainGlyphs] = plainParts;
    assert.equal(plainParts[1], undefined, 'the tuple uses undefined instead of an empty decoration object');
  } finally {
    plainGlyphs?.dispose();
    plain?.dispose();
    decorations?.dispose();
    detached?.dispose();
    label.dispose();
    font.dispose();
  }
});

test('Text.breakApart preserves TextGroup paint order across detached roots', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const layer = new THREE.Group();
  layer.renderOrder = 3;
  const group = three.createTextGroup({ renderOrder: 20 });
  const before = three.createText({ font, text: 'earlier sibling', style: { fontSize: 16, color: '#f97316' } });
  const label = three.createText({
    font,
    text: 'layered decorations',
    style: {
      decoration: { underline: true, overline: true, lineThrough: true, color: '#38bdf8' },
      fontSize: 16,
    },
  });
  group.add(before);
  group.add(label);
  layer.add(group);
  scene.add(layer);
  scene.updateMatrixWorld(true);

  let glyphs;
  let decorations;
  try {
    [glyphs, decorations] = label.breakApart();
    assert.ok(decorations);
    group.add(glyphs, decorations);
    assert.equal(glyphs.isGroup, undefined, 'the detached root must not create a Three group-order bucket');
    assert.equal(decorations.isGroup, undefined, 'the decoration root must not create a Three group-order bucket');
    const glyphDraws = glyphs.children.filter((child) => child.isMesh);
    const under = decorations.children.filter((child) => child.isMesh && child.userData.pmndrsGlyphDepthKey === 0);
    const over = decorations.children.filter((child) => child.isMesh && child.userData.pmndrsGlyphDepthKey === 2);
    assert.ok(glyphDraws.length > 0 && under.length > 0 && over.length > 0);
    const labelStableIds = new Set(label.glyphs().glyphStableIds);
    const sourceGlyphOrders = rootDraws(scene)
      .filter((child) => child.isMesh && child.userData.pmndrsGlyphPrimitiveKind === 'glyph')
      .filter((draw) => {
        const stableIds = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.stableGlyphId.id));
        if (stableIds === undefined) return false;
        const start = draw.userData.pmndrsGlyphRunStart;
        for (let index = 0; index < draw.geometry.instanceCount; index += 1) {
          if (labelStableIds.has(stableIds.getX(start + index))) return true;
        }
        return false;
      })
      .map((draw) => draw.renderOrder);
    assert.ok(sourceGlyphOrders.length > 0);
    assert.equal(
      Math.min(...glyphDraws.map((draw) => draw.renderOrder)),
      Math.min(...sourceGlyphOrders),
      'a later text must retain its actual live draw offset inside a shared TextGroup batch',
    );
    assert.ok(under.every((draw) => draw.renderOrder >= 20));
    assert.ok(
      Math.max(...under.map((draw) => draw.renderOrder)) < Math.min(...glyphDraws.map((draw) => draw.renderOrder)),
      'underline and overline draws must remain beneath copied glyph draws',
    );
    assert.ok(
      Math.max(...glyphDraws.map((draw) => draw.renderOrder)) < Math.min(...over.map((draw) => draw.renderOrder)),
      'line-through draws must remain above copied glyph draws',
    );
  } finally {
    decorations?.dispose();
    glyphs?.dispose();
    before.dispose();
    label.dispose();
    group.dispose();
    font.dispose();
  }
});

test('Text.breakApart preserves per-span material routing with independently owned instances', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const namedMaterial = (name) =>
    defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      material.name = name;
      return material;
    });
  const base = namedMaterial('detached-base');
  const accent = namedMaterial('detached-accent');
  const accented = textSpan(accent);
  const scene = new THREE.Scene();
  const label = three.createText({
    font,
    text: txt`A${accented`B`}`,
    material: base,
  });
  scene.add(label);
  scene.updateMatrixWorld(true);

  let detached;
  try {
    const sourceNames = new Set(rootDraws(scene).map((draw) => draw.material.name));
    assert.deepEqual(sourceNames, new Set(['detached-base', 'detached-accent']));
    [detached] = label.breakApart();
    scene.add(detached);
    scene.updateMatrixWorld(true);
    assert.deepEqual(
      new Set(detached.materials.map((material) => material.name)),
      new Set(['detached-base', 'detached-accent']),
      'the detached plan must resolve each copied material id rather than substituting the root material',
    );
    for (const material of detached.materials) {
      assert.ok(
        !label.children.some((child) => child.isMesh && child.material === material),
        'each detached material must be a fresh owned instance',
      );
    }
  } finally {
    detached?.dispose();
    label.dispose();
    font.dispose();
  }
});

test('one portable request returns typed resources for every declared technique', async () => {
  const [bitmapFont, msdfFont, slugFont] = await loadFont({ baked: { bytes: await readFile(multiTechniqueFontUrl) } }, [
    bitmap({ strikes: [32] }),
    msdf,
    slug,
  ]);
  assert.equal(bitmapFont.font, msdfFont.font);
  assert.equal(msdfFont.font, slugFont.font);
  assert.equal(bitmapFont.raster, bitmap);
  assert.equal(msdfFont.raster, msdf);
  assert.equal(slugFont.raster, slug);
  bitmapFont.dispose();
  msdfFont.dispose();
  slugFont.dispose();
});

test('Three carries supported text effects into MSDF lanes and rejects them for unsupported techniques', async (t) => {
  const three = await createThreeTestHandle(t);
  const bytes = await readFile(multiTechniqueFontUrl);
  const [bitmapFont, msdfFont, slugFont] = await loadFont({ baked: dataUrl(bytes) }, [
    bitmap({ strikes: [32] }),
    msdf,
    slug,
  ]);
  const effectStyle = {
    fontSize: 32,
    color: '#00ff00',
    opacity: 0.5,
    outline: { color: '#ff000080', width: 2 },
    shadow: { color: '#0000ff80', offset: [3, 4] },
  };
  assert.throws(() => three.createText({ font: bitmapFont, text: 'A', style: effectStyle }), /pmndrs\.bitmap.*outline/);
  assert.throws(() => three.createText({ font: slugFont, text: 'A', style: effectStyle }), /pmndrs\.slug.*outline/);

  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const smaller = textSpan({ fontSize: 24 });
  const label = three.createText({
    font: msdfFont,
    text: txt`${smaller`A`}`,
    style: effectStyle,
  });
  try {
    group.add(label);
    scene.add(group);
    scene.updateMatrixWorld(true);
    assert.equal(label.error, undefined);
    const draw = rootDraws(scene)[0];
    assert.ok(draw, 'MSDF effect text must publish a draw');
    const effects = draw.geometry.getAttribute(glyphAttribute(msdfSchema.buffers.effectColor.id)).array;
    const page = draw.geometry.getAttribute(glyphAttribute(msdfSchema.buffers.page.id)).array;
    const color = draw.geometry.getAttribute(glyphAttribute(msdfSchema.buffers.color.id)).array;
    assert.deepEqual([...color.slice(0, 3)], [0, 1, 0], 'a typography-only span must inherit foreground');
    assert.deepEqual([...effects.slice(0, 2)], [0x400000ff, 0x40ff0000]);
    const effectFontSize = 24;
    const expectedEffects = [3 / effectFontSize, 4 / effectFontSize, 2 / effectFontSize];
    for (let lane = 0; lane < expectedEffects.length; lane += 1) {
      assert.ok(
        Math.abs(page[lane] - expectedEffects[lane]) < 1e-6,
        `MSDF effect lane ${lane} must retain its em-relative value`,
      );
    }
    label.style = {
      ...effectStyle,
      outline: { color: '#00ffff80', width: 2 },
    };
    scene.updateMatrixWorld(true);
    assert.deepEqual(
      [...effects.slice(0, 2)],
      [0x40ffff00, 0x40ff0000],
      'a retained color-only edit must rewrite the packed effect buffer',
    );
  } finally {
    group.dispose();
    label.dispose();
    bitmapFont.dispose();
    msdfFont.dispose();
    slugFont.dispose();
  }
});

test('Three handle ownership follows immutable variants across user-font disposal', async (t) => {
  const three = await createThreeTestHandle(t);
  const library = createFontLibrary();
  const input = { baked: { bytes: await readFile(fontUrl) } };
  const raster = bitmap({ strikes: [16] });
  const [first, second] = await Promise.all([library.loadFont(input, raster), library.loadFont(input, raster)]);
  assert.notEqual(first, second, 'each caller owns an independent Font lease');

  const label = three.createText({ font: second, text: 'retained' });
  first.dispose();
  second.dispose();
  assert.ok(label.measure().glyphCount > 0, 'a live Text retains everything needed after Font disposal');

  label.dispose();
  library.dispose();
  assert.equal(label.disposed, true);
});

test('Three balances resolved font-stack ownership across measurement, updates, publication, and disposal', async (t) => {
  const three = await createThreeTestHandle(t);
  const registerFontStack = GlyphHandleState.prototype.registerFontStack;
  const disposeFontStack = GlyphHandleState.prototype.disposeFontStack;
  let registrations = 0;
  let disposals = 0;
  GlyphHandleState.prototype.registerFontStack = function (...args) {
    registrations += 1;
    return registerFontStack.apply(this, args);
  };
  GlyphHandleState.prototype.disposeFontStack = function (...args) {
    disposals += 1;
    return disposeFontStack.apply(this, args);
  };
  t.after(() => {
    GlyphHandleState.prototype.registerFontStack = registerFontStack;
    GlyphHandleState.prototype.disposeFontStack = disposeFontStack;
  });

  const first = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const second = await loadFont({ baked: dataUrl(await readFile(amiriFontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({ font: first, text: 'first' });
  try {
    assert.ok(label.measure().glyphCount > 0);
    assert.deepEqual([registrations, disposals], [1, 0], 'measurement retains the initial resolved font stack');

    label.font = second;
    label.text = 'الثاني';
    assert.ok(label.measure().glyphCount > 0);
    assert.deepEqual([registrations, disposals], [2, 1], 'measuring an update releases the replaced resolved state');

    scene.add(label);
    scene.updateMatrixWorld(true);
    assert.equal(label.error, undefined);
    assert.deepEqual([registrations, disposals], [2, 1], 'publication shares the current resolved state');

    label.font = first;
    label.text = 'published replacement';
    scene.updateMatrixWorld(true);
    assert.equal(label.error, undefined);
    assert.deepEqual([registrations, disposals], [3, 2], 'publication releases the previously committed state');

    label.dispose();
    assert.deepEqual(
      [registrations, disposals],
      [3, 2],
      'a disposed text keeps its committed state until removal publication or root teardown',
    );
    three.dispose();
    assert.equal(disposals, registrations, 'terminal disposal releases the desired and committed references once');
  } finally {
    label.dispose();
    first.dispose();
    second.dispose();
  }
});

test('Three Text and TextGroup late-bind, synchronize, reparent, and dispose through the scene graph', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const emptyScene = new THREE.Scene();
  const initiallyEmpty = three.createText({ font, text: '' });
  emptyScene.add(initiallyEmpty);
  emptyScene.updateMatrixWorld(true);
  assert.equal(initiallyEmpty.error, undefined, 'an empty paragraph must publish without a no-op text mutation');
  initiallyEmpty.text = 'A';
  emptyScene.updateMatrixWorld(true);
  assert.equal(initiallyEmpty.error, undefined, 'an initially empty paragraph must accept its first text edit');
  assert.equal(initiallyEmpty.measure().glyphCount, 1);
  initiallyEmpty.dispose();

  const red = textSpan({ color: '#ff0000' });
  const green = textSpan({ color: '#00ff00' });
  const editedSpans = three.createText({ font, text: txt`${red`AB`}${green`CD`}` });
  // Text and structural span fragments are authored together. `set` receives a new document and
  // still derives the narrow engine edit from the two flattened strings.
  editedSpans.set({
    text: txt`${red`AXB`}Y${green`CD`}`,
  });
  assert.equal(editedSpans.text, 'AXBYCD');
  editedSpans.set({
    text: txt`${red`A`}${green`CD`}`,
  });
  assert.equal(editedSpans.text, 'ACD');
  // Stating a plain string replaces the structural document rather than retaining hidden ranges.
  editedSpans.text = 'ACD!';
  assert.equal(editedSpans.text, 'ACD!');
  editedSpans.dispose();

  const scene = new THREE.Scene();
  const group = three.createTextGroup({ renderOrder: 12 });
  const container = new THREE.Object3D();
  const label = three.createText({ font, text: 'First frame' });
  container.add(label);
  group.add(container);
  scene.add(group);

  assert.equal(label.bound, true, 'construction binds desired state to its required handle root');
  assert.equal(rootDraws(scene).length, 0, 'construction and add must not publish or realize draws eagerly');
  scene.updateMatrixWorld();
  assert.equal(label.bound, true);
  assert.equal(label.textGroup, group);
  assert.equal(group.textCount, 1);
  assert.equal(group.error, undefined);
  const firstDraws = rootDraws(scene);
  assert.ok(firstDraws.length > 0);
  assert.equal(firstDraws[0].geometry.instanceCount, 10, 'the GPU plan omits the non-rendering space glyph');
  assert.equal(firstDraws[0].renderOrder, 12);
  const measurement = label.measure();
  assert.ok(measurement, 'layout measurement must be available through an explicit Rust query');
  assert.equal(measurement.width, measurement.contentWidth);
  assert.equal(measurement.height, measurement.contentHeight);
  assert.ok(measurement.firstBaseline > 0);
  assert.equal(measurement.firstBaseline, measurement.lastBaseline);
  assert.equal(measurement.overflowed, false);
  assert.equal(measurement.glyphCount, 11, 'layout summary retains the non-rendering space glyph');
  assert.equal(measurement.lineCount, 1);
  assert.equal(measurement.missingGlyphCount, 0);
  assert.equal(label.measure(), measurement, 'an unchanged committed layout must reuse its queried measurement');
  const inspection = label.glyphs();
  assert.ok(inspection, 'per-glyph layout must be available only through an explicit Rust inspection query');
  assert.equal(inspection.glyphIds.length, measurement.glyphCount);
  assert.equal(inspection.glyphStableIds.length, inspection.glyphIds.length);
  assert.equal(inspection.lineGlyphCounts.length, measurement.lineCount);
  const expectedFirstX = inspection.x[0];
  inspection.x.fill(-12345);
  const repeatedInspection = label.glyphs();
  assert.notEqual(repeatedInspection, inspection, 'each inspection owns the mutable columns it exposes');
  assert.equal(repeatedInspection.x[0], expectedFirstX, 'caller mutation cannot corrupt the retained inspection');
  assert.equal(rootDraws(scene)[0], firstDraws[0]);

  const displayedGlyphs = label.measureGlyphs();
  assert.equal(displayedGlyphs?.length, measurement.glyphCount);
  assert.ok(displayedGlyphs?.every((entry) => entry.drawnOrigin.equals(entry.shapedOrigin)));
  assert.ok(displayedGlyphs?.[0].localAdvanceBounds.getSize(new THREE.Vector3()).x > 0);

  group.renderOrder = 20;
  scene.updateMatrixWorld();
  assert.equal(firstDraws[0].renderOrder, 20, 'group render order must update existing draw proxies');

  label.renderOrder = 7;
  scene.updateMatrixWorld();
  assert.equal(rootDraws(scene)[0].renderOrder, 20);
  assert.equal(firstDraws[0].geometry.instanceCount, 10, 'render-order-only updates must preserve the Rust plan');

  label.text = 'Only the final desired value';
  label.text = 'Updated';
  scene.updateMatrixWorld();
  assert.ok(rootDraws(scene).length > 0);
  assert.equal(rootDraws(scene)[0], firstDraws[0]);
  assert.equal(
    firstDraws[0].geometry.instanceCount,
    7,
    'compatible revisions must retain draws and resize live counts',
  );
  assert.notEqual(label.measure(), measurement, 'a semantic update must invalidate the measurement cache');
  assert.notEqual(label.glyphs(), inspection, 'a semantic update must invalidate the inspection cache');

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
  assert.equal(label.bound, true, 'TextGroup disposal cannot tear down its root-owned publication');
  assert.equal(label.textGroup, group, 'scene hierarchy remains authoritative until the host reparents the Text');

  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.bound, true, 'text retained by a disposed group can bind elsewhere');

  // Typography tier: first-line indent shifts the pen and the measured width;
  // paragraph spacing shifts the first baseline and carries in the block extent.
  const plainShort = three.createText({ font, text: 'Whisper' });
  const indented = three.createText({ font, text: 'Whisper', layout: { firstLineIndent: 30 } });
  const spaced = three.createText({ font, text: 'Whisper', layout: { spaceBefore: 8, spaceAfter: 6 } });
  for (const paragraph of [plainShort, indented, spaced]) scene.add(paragraph);
  scene.updateMatrixWorld();
  const plainMeasure = plainShort.measure();
  const indentedMeasure = indented.measure();
  const spacedMeasure = spaced.measure();
  assert.equal(plainMeasure.lineCount, 1);
  assert.equal(indentedMeasure.lineCount, 1);
  assert.equal(indentedMeasure.contentWidth, plainMeasure.contentWidth + 30);
  assert.equal(indented.glyphs().x[0], plainShort.glyphs().x[0] + 30);
  assert.equal(spacedMeasure.firstBaseline, plainMeasure.firstBaseline + 8);
  assert.equal(spacedMeasure.contentHeight, plainMeasure.contentHeight + 8 + 6);
  for (const paragraph of [plainShort, indented, spaced]) {
    paragraph.removeFromParent();
    paragraph.dispose();
  }

  // Justification controls: an unbounded justified last line fills the exact
  // box; capping word growth at its natural width and bounding letter gaps
  // leaves the line short by design.
  const justifyLayout = (justify, lastLine) => ({
    align: 'justify',
    ...(justify === undefined ? {} : { justify }),
    lastLine,
  });
  const justifyConstraints = { width: { mode: 'exact', size: 300 } };
  const natural = three.createText({
    font,
    text: 'pack my box',
    constraints: justifyConstraints,
    layout: justifyLayout(undefined, 'auto'),
  });
  const filled = three.createText({
    font,
    text: 'pack my box',
    constraints: justifyConstraints,
    layout: justifyLayout(undefined, 'justify'),
  });
  const capped = three.createText({
    font,
    text: 'pack my box',
    constraints: justifyConstraints,
    layout: justifyLayout({ maxWordSpaceRatio: 1, letterSpaceExpansion: 0.5 }, 'justify'),
  });
  for (const paragraph of [natural, filled, capped]) scene.add(paragraph);
  scene.updateMatrixWorld();
  const naturalMeasure = natural.measure();
  const filledMeasure = filled.measure();
  const cappedMeasure = capped.measure();
  assert.equal(naturalMeasure.lineCount, 1);
  assert.ok(naturalMeasure.contentWidth < 300, 'auto last line keeps its natural advance');
  assert.equal(filledMeasure.contentWidth, 300, 'justified last line fills the exact box');
  const cappedGaps = cappedMeasure.glyphCount - 1;
  assert.equal(
    cappedMeasure.contentWidth,
    naturalMeasure.contentWidth + cappedGaps * 0.5,
    'capped word spaces spill into bounded letter gaps',
  );
  for (const paragraph of [natural, filled, capped]) {
    paragraph.removeFromParent();
    paragraph.dispose();
  }

  // Column flow: one paragraph fills side-by-side ordered regions without
  // balancing. The column height is the flow signal, so the reference layout is
  // one column at the exact column measure; halving its height (plus a line of
  // slack) must push the tail of the text into the second column.
  const columnText = 'the quick brown fox jumps over the lazy dog and keeps running until the column turns';
  const columnMeasureWidth = (420 - 20) / 2;
  const reference = three.createText({
    font,
    text: columnText,
    constraints: { width: { mode: 'exact', size: columnMeasureWidth } },
  });
  scene.add(reference);
  scene.updateMatrixWorld();
  const referenceMeasure = reference.measure();
  assert.ok(referenceMeasure.lineCount >= 4, 'the fixture text must wrap well past two lines at the column measure');
  const columnHeight = Math.ceil(referenceMeasure.contentHeight * 0.6);
  const twoColumns = three.createText({
    font,
    text: columnText,
    constraints: { width: { mode: 'exact', size: 420 }, height: { mode: 'exact', size: columnHeight } },
    layout: { columns: { count: 2, gap: 20 } },
  });
  scene.add(twoColumns);
  scene.updateMatrixWorld();
  const doubleMeasure = twoColumns.measure();
  assert.equal(doubleMeasure.overflowed, false, 'two columns at 60% height must hold the whole text');
  assert.ok(
    doubleMeasure.contentHeight <= columnHeight,
    'the columned block extent must stay inside the column height',
  );
  const columnStarts = twoColumns.glyphs().x;
  const secondColumnStart = columnMeasureWidth + 20;
  assert.ok(
    Array.from(columnStarts).some((x) => x >= secondColumnStart),
    'glyphs must flow into the second column',
  );
  assert.throws(
    () => three.createText({ font, text: columnText, layout: { columns: { count: 2 } } }),
    /columns/,
    'columns without an exact width must be rejected',
  );
  assert.throws(
    () =>
      three.createText({
        font,
        text: columnText,
        constraints: { width: { mode: 'exact', size: 420 } },
        layout: { columns: { count: 2 } },
      }),
    /columns/,
    'columns without a bounded height must be rejected',
  );
  for (const paragraph of [reference, twoColumns]) {
    paragraph.removeFromParent();
    paragraph.dispose();
  }

  label.removeFromParent();
  label.dispose();
  font.dispose();
});

test('nested TextGroup nodes inherit presentation without creating nested publication boundaries', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const inheritedMaterial = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.name = 'outer-inherited';
    return material;
  });
  const scene = new THREE.Scene();
  const outer = three.createTextGroup({ material: inheritedMaterial, pixelSnapping: true, renderOrder: 31 });
  const inner = three.createTextGroup();
  const label = three.createText({ font, text: 'Nested hierarchy' });
  inner.add(label);
  outer.add(inner);
  scene.add(outer);
  scene.updateMatrixWorld(true);

  try {
    const draws = rootDraws(scene);
    assert.equal(draws.length, 1, 'compatible nested descendants remain in the root-wide batch stream');
    assert.equal(draws[0].material.name, 'outer-inherited');
    assert.equal(draws[0].renderOrder, 31);
    assert.equal(label.textGroup, inner, 'Text exposes its nearest hierarchy parent');
    assert.equal(inner.children.includes(label), true);
    assert.equal(outer.children.includes(inner), true);
    assert.equal(
      inner.children.some((child) => child.isMesh),
      false,
    );
    assert.equal(
      outer.children.some((child) => child.isMesh),
      false,
    );
    assert.equal(
      scene.children.filter((child) => child.name.startsWith('@pmndrs/glyph:')).length,
      1,
      'nested groups do not create draw roots',
    );
  } finally {
    label.dispose();
    inner.dispose();
    outer.dispose();
    font.dispose();
  }
});

test('renderer rejection waits for explicit invalidation and then checkpoints without copied bytes', async (t) => {
  const three = await createThreeTestHandle(t);
  const instrumented = instrumentedGlyph;
  instrumented.reset();
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  let failMaterial = true;
  let label;
  const material = defineTextMaterial((context) => {
    if (failMaterial) {
      assert.throws(() => glyph.shape(), /cannot be reentered while a borrowed render plan is active/u);
      throw new Error('deliberate material realization failure');
    }
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  label = three.createText({ font, material, text: 'Retry me' });
  const errors = [];
  group.onError = (error) => errors.push(error);
  group.add(label);
  scene.add(group);

  scene.updateMatrixWorld();
  assert.match(String(group.error), /deliberate material realization failure/u);
  assert.equal(label.error, group.error, 'group-owned failures must remain visible from the child Text');
  assert.equal(instrumented.crossings, 1);
  const rejectedGeneration = instrumented.latestUpdateGeneration;
  assert.equal(rootDraws(scene).length, 0);
  assert.equal(errors.length, 1);
  assert.ok(label.measure().glyphCount > 0, 'measurement remains independent of material realization');
  assert.equal(instrumented.crossings, 1, 'measurement must not retry or consume renderer publication');
  assert.match(String(group.error), /deliberate material realization failure/u);
  assert.ok(label.glyphs().glyphCount > 0, 'renderer-free positioned inspection survives renderer rejection');
  assert.equal(
    label.measureGlyphs(),
    undefined,
    'drawn measurements are unavailable while renderer realization failed',
  );
  assert.throws(
    () => label.breakApart(),
    /after renderer realization failed/,
    'a failed renderer publication cannot be presented as a committed detached copy',
  );
  assert.equal(instrumented.crossings, 1, 'inspection must not turn a rejected unchanged frame into a retry');

  failMaterial = false;
  scene.updateMatrixWorld();
  assert.match(String(group.error), /deliberate material realization failure/u);
  assert.equal(instrumented.crossings, 1, 'an unchanged frame must not retry a renderer implementation failure');
  assert.equal(rootDraws(scene).length, 0);

  label.material = material;
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  assert.equal(label.error, undefined);
  assert.equal(instrumented.crossings, 2, 'explicit material invalidation must request a checkpoint from the engine');
  assert.equal(
    instrumented.latestAcknowledgedGeneration,
    rejectedGeneration - 1,
    'measurement must not acknowledge the renderer-rejected publication',
  );
  assert.equal(errors.length, 1, 'a successful checkpoint must not repeat the old failure');
  assert.equal(rootDraws(scene).length, 1);

  label.text = 'New input after recovery';
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  assert.equal(label.error, undefined);
  assert.equal(instrumented.crossings, 3, 'new input after recovery must publish normally');
  assert.equal(rootDraws(scene).length, 1);

  group.dispose();
  label.dispose();
  font.dispose();
});

test('a rejected fixed-capacity candidate releases its provisional font-stack lease', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'fixed' } }));
  const registerFontStack = GlyphHandleState.prototype.registerFontStack;
  const disposeFontStack = GlyphHandleState.prototype.disposeFontStack;
  let registrations = 0;
  let disposals = 0;
  GlyphHandleState.prototype.registerFontStack = function (...args) {
    registrations += 1;
    return registerFontStack.apply(this, args);
  };
  GlyphHandleState.prototype.disposeFontStack = function (...args) {
    disposals += 1;
    return disposeFontStack.apply(this, args);
  };
  t.after(() => {
    GlyphHandleState.prototype.registerFontStack = registerFontStack;
    GlyphHandleState.prototype.disposeFontStack = disposeFontStack;
  });

  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({ font, text: 'over budget' });
  try {
    scene.add(label);
    scene.updateMatrixWorld();
    assert.deepEqual(label.commitState(), { status: 'pending' });
    label.dispose();
    assert.equal(disposals, registrations, 'a skipped candidate must not retain its compiled font stack');
  } finally {
    label.dispose();
    font.dispose();
    fontDomain.dispose();
  }
});

test('TextGroup drops disposed descendants and reuses their committed transform identities', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const survivor = three.createText({ font, text: 'A' });
  group.add(survivor);
  scene.add(group);
  scene.updateMatrixWorld();

  let retainedTransformBytes;
  for (let index = 0; index < 12; index += 1) {
    const transient = three.createText({ font, text: 'B' });
    group.add(transient);
    scene.updateMatrixWorld();
    const draw = rootDraws(scene)[0];
    assert.ok(draw);
    const transformBytes = draw.geometry.getAttribute('_pmndrsGlyphTransforms').array.byteLength;
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

  const draw = rootDraws(scene)[0];
  assert.equal(draw.geometry.instanceCount, 1);
  group.dispose();
  survivor.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('Three retires materials bound to a replaced buffer generation', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 2, policy: 'grow' } }));
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const materials = [];
  const disposed = new Set();
  const material = defineTextMaterial((context) => {
    const created = context.createDefaultMaterial();
    created.addEventListener('dispose', () => disposed.add(created));
    materials.push(created);
    return created;
  });
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({ font, material, text: 'AB' });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  const initialMaterial = rootDraws(scene)[0]?.material;
  assert.equal(initialMaterial, materials[0]);

  label.text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  scene.updateMatrixWorld();
  assert.ok(materials.length > 1, 'growing physical buffers must realize a material for the new generation');
  assert.ok(disposed.has(initialMaterial), 'the material retaining the retired generation must be disposed');

  group.dispose();
  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('one Rust plan partitions a mixed Bitmap to Slug fallback stack', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const [latin, icon] = await Promise.all([
    fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] })),
    fontDomain.loadFont({ baked: dataUrl(gunzipSync(await readFile(iconSlugFontUrl))) }, slug),
  ]);
  const realizedTechniques = [];
  const material = defineTextMaterial((context) => {
    realizedTechniques.push(context.format);
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const label = three.createText({
    font: createFontStack(latin, icon),
    material,
    text: 'Hello \uf0ac',
  });
  scene.add(label);
  scene.updateMatrixWorld();

  const draws = rootDraws(scene);
  assert.equal(label.error, undefined);
  assert.equal(draws.length, 2, 'Rust must partition fallback glyphs by renderer program and resource');
  assert.equal(
    draws.reduce((count, draw) => count + draw.geometry.instanceCount, 0),
    6,
  );
  assert.deepEqual(realizedTechniques.sort(), [bitmap.id, slug.id].sort());
  assert.deepEqual(
    draws
      .map(
        (draw) =>
          draw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.size.id)) ??
          draw.geometry.getAttribute(glyphAttribute(slugSchema.buffers.planeRect.id)),
      )
      .map((attribute) => attribute.itemSize)
      .sort(),
    [2, 4],
    'Bitmap vec2 and Slug vec4 records must coexist without a user technique selector',
  );

  const [detached] = label.breakApart();
  scene.add(detached);
  label.visible = false;
  scene.updateMatrixWorld(true);
  const detachedDraws = detached.children.filter((child) => child.isMesh);
  assert.equal(detachedDraws.length, 2, 'the detached copy must preserve both renderer-program batches');
  const transformStorages = detachedDraws.map((draw) => draw.geometry.getAttribute('_pmndrsGlyphInstanceTransforms'));
  assert.ok(transformStorages.every(Boolean));
  assert.equal(
    new Set(transformStorages).size,
    2,
    'each physical batch index space must own independent detached transform storage',
  );
  const firstBefore = new THREE.Matrix4();
  const lastBefore = new THREE.Matrix4();
  detached.getMatrixAt(0, firstBefore);
  detached.getMatrixAt(detached.count - 1, lastBefore);
  const movedFirst = firstBefore.clone();
  movedFirst.elements[12] += 13;
  detached.setMatrixAt(0, movedFirst);
  const lastAfterFirstWrite = new THREE.Matrix4();
  detached.getMatrixAt(detached.count - 1, lastAfterFirstWrite);
  assert.ok(
    lastAfterFirstWrite.equals(lastBefore),
    'record zero in a later renderer batch cannot alias record zero in the first batch',
  );
  const movedLast = lastBefore.clone();
  movedLast.elements[13] -= 7;
  detached.setMatrixAt(detached.count - 1, movedLast);
  const firstAfterLastWrite = new THREE.Matrix4();
  detached.getMatrixAt(0, firstAfterLastWrite);
  assert.ok(firstAfterLastWrite.equals(movedFirst), 'later-batch writes cannot overwrite the first batch');
  detached.dispose();

  label.dispose();
  latin.dispose();
  icon.dispose();
  fontDomain.dispose();
});

test('one Three root realizes two public Text objects as one indexed Rust draw', async (t) => {
  const three = await createThreeTestHandle(t);
  const instrumented = instrumentedGlyph;
  instrumented.reset();
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup({ renderOrder: 3 });
  const left = three.createText({ font, text: 'AB' });
  const right = three.createText({
    font,
    text: 'CD',
    constraints: { width: { mode: 'exact', size: 100 }, height: { mode: 'exact', size: 100 } },
    layout: { columns: { count: 2, gap: 10 } },
  });
  left.position.x = 2;
  right.position.x = 5;
  group.add(left, right);
  scene.add(group);
  scene.updateMatrixWorld();

  assert.equal(group.error, undefined);
  const paragraphMutations = instrumented.latestParagraphMutations();
  assert.equal(paragraphMutations.length, 2);
  assert.equal(new Set(paragraphMutations.map(({ paragraphId }) => paragraphId)).size, 2);
  assert.ok(paragraphMutations.every(({ paragraphId }) => paragraphId !== 0));
  assert.deepEqual(
    paragraphMutations.map(({ order }) => order),
    [0, 1],
    'the retained planner must publish each paragraph once in scene order',
  );
  const constraints = instrumented.latestConstraints();
  assert.deepEqual(
    constraints.map(({ paragraphId }) => paragraphId),
    paragraphMutations.map(({ paragraphId }) => paragraphId),
    'each planner-owned paragraph must produce exactly one matching constraint',
  );
  assert.equal(new Set(constraints.map(({ flowThreadId }) => flowThreadId)).size, 2);
  assert.ok(constraints.every(({ flowThreadId }) => flowThreadId !== 0));
  assert.deepEqual(
    constraints.map(({ regionStart, regionCount, resumeRegion }) => ({ regionStart, regionCount, resumeRegion })),
    [
      { regionStart: 0, regionCount: 1, resumeRegion: 0 },
      { regionStart: 1, regionCount: 2, resumeRegion: 0 },
    ],
    'planner geometry must publish one contiguous region partition per paragraph',
  );
  const regions = instrumented.latestRegions();
  assert.equal(regions.length, 3);
  assert.equal(new Set(regions.map(({ id }) => id)).size, 3);
  assert.ok(regions.every(({ id, transformIndex }) => id !== 0 && transformIndex !== 0));
  const draws = rootDraws(scene);
  assert.equal(draws.length, 1, 'compatible paragraphs must batch in Rust before Three sees the plan');
  assert.equal(draws[0].geometry.instanceCount, 4);
  const start = draws[0].userData.pmndrsGlyphRunStart;
  const indices = draws[0].geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id)).array;
  assert.deepEqual(Array.from(indices.subarray(start, start + 4)), [1, 1, 2, 2]);
  const transforms = draws[0].geometry.getAttribute('_pmndrsGlyphTransforms');
  assert.equal(transforms.array[1 * 16 + 12], 2);
  assert.equal(transforms.array[2 * 16 + 12], 5);

  const initialLeftMeasurement = left.measure();
  const initialRightMeasurement = right.measure();
  assert.ok(initialLeftMeasurement);
  assert.ok(initialRightMeasurement);
  instrumented.reset();
  left.set({});
  assert.equal(left.measure(), initialLeftMeasurement, 'an empty update must preserve the cached measurement');
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 0, 'an empty update and cached measurement must not cross into Rust');

  // Assigning `text` states the desired string. Publication derives the narrowest scalar-aligned
  // replacement from the last published string, coalescing intermediate desired states.
  left.text = 'A';
  scene.updateMatrixWorld();
  assert.deepEqual(instrumented.latestTextMutations(), [{ start: 1, deleteCount: 1, insert: '' }]);
  assert.equal(left.text, 'A');

  left.text = 'AB';
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

  left.text = 'AZ';
  left.text = 'Z';
  left.text = 'AZ';
  scene.updateMatrixWorld();
  assert.deepEqual(
    instrumented.latestTextMutations(),
    [{ start: 1, deleteCount: 1, insert: 'Z' }],
    'retained authoring coalesces desired state into one minimal edit from the published string',
  );
  assert.equal(left.text, 'AZ');

  // A whole-string assignment cannot address the inside of a scalar, so the replacement derived
  // from it is scalar-aligned by construction rather than by a range check.
  left.text = '🌍';
  scene.updateMatrixWorld();
  assert.deepEqual(instrumented.latestTextMutations(), [{ start: 0, deleteCount: 2, insert: '🌍' }]);
  assert.equal(left.text, '🌍');
  left.text = 'AB';
  scene.updateMatrixWorld();

  instrumented.reset();
  left.constraints = { width: { mode: 'exact', size: 100 } };
  left.layout = { wrap: 'word' };
  const resizedMeasurement = left.measure();
  assert.ok(resizedMeasurement, 'a pending mutation must produce its requested measurement');
  assert.notEqual(resizedMeasurement, initialLeftMeasurement);
  assert.deepEqual(
    right.measure(),
    initialRightMeasurement,
    'one requested semantic publication must populate every retained paragraph',
  );
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 1, 'mutation, render plan, and demanded measurement must share one text_update');

  const version = transforms.version;
  let forcedTextWorldUpdates = 0;
  const updateRightWorldMatrix = right.updateWorldMatrix.bind(right);
  right.updateWorldMatrix = (...arguments_) => {
    forcedTextWorldUpdates += 1;
    return updateRightWorldMatrix(...arguments_);
  };
  group.position.x = 11;
  scene.updateMatrixWorld();
  assert.equal(transforms.version, version + 1, 'moving a TextGroup must patch its descendant transforms');
  assert.equal(forcedTextWorldUpdates, 0, 'moving the shared root must not force each Text world matrix a second time');

  right.position.x = 7;
  scene.updateMatrixWorld();
  assert.equal(rootDraws(scene)[0], draws[0]);
  assert.equal(transforms.version, version + 2);
  assert.equal(transforms.array[2 * 16 + 12], 18);
  assert.equal(forcedTextWorldUpdates, 0, 'the normal Three traversal supplies current matrices to transform patches');

  const nestedParent = new THREE.Group();
  group.add(nestedParent);
  nestedParent.add(right);
  nestedParent.position.x = 3;
  scene.updateMatrixWorld();
  assert.equal(transforms.array[2 * 16 + 12], 21, 'nested parent motion patches only the affected transform path');
  nestedParent.visible = false;
  scene.updateMatrixWorld();
  assert.deepEqual(
    Array.from(transforms.array.subarray(2 * 16, 3 * 16)),
    Array(16).fill(0),
    'nested parent visibility suppresses instances whose draw proxy lives at the shared root',
  );
  nestedParent.visible = true;
  scene.updateMatrixWorld();
  right.style = { ...right.style, color: '#00ff00' };
  scene.updateMatrixWorld();

  right.style = { ...right.style, fontSize: 20 };
  scene.updateMatrixWorld();
  assert.equal(right.glyphs().glyphFontSizes[0], 20);

  instrumented.reset();
  left.text = 'ABC';
  const replacedMeasurement = left.measure();
  assert.equal(replacedMeasurement?.glyphCount, 3);
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 1, 'text replacement and demanded measurement must share one text_update');
  const replacedDraws = rootDraws(scene);
  assert.equal(replacedDraws.length, 1);
  assert.equal(replacedDraws[0].geometry.instanceCount, 5, 'the published command buffer must include the new glyph');

  const rightStableIdsBeforeCopy = Array.from(right.glyphs().glyphStableIds);
  const rightLocalMatricesBeforeCopy = right.measureGlyphs()?.map((measurement) => measurement.originalMatrix.clone());
  const [leftDetached] = left.breakApart();
  group.add(leftDetached);
  const moved = new THREE.Matrix4();
  leftDetached.getMatrixAt(0, moved);
  moved.elements[12] += 17;
  leftDetached.setMatrixAt(0, moved);
  scene.updateMatrixWorld(true);
  assert.deepEqual(
    Array.from(right.glyphs().glyphStableIds),
    rightStableIdsBeforeCopy,
    'the copied publication cannot replace or re-key a sibling paragraph',
  );
  assert.ok(
    right
      .measureGlyphs()
      ?.every((measurement, index) => measurement.originalMatrix.equals(rightLocalMatricesBeforeCopy?.[index])),
    'detached instance transforms cannot alias the sibling Text transform',
  );
  assert.equal(
    rootDraws(scene)[0],
    replacedDraws[0],
    'the live TextGroup draw remains installed after a detached copy',
  );
  leftDetached.dispose();

  group.dispose();
  left.dispose();
  right.dispose();
  font.dispose();
});

function instrumentNextGlyphEngine() {
  const abi = textShaperAbi;
  const originalInstantiate = WebAssembly.instantiate;
  let crossings = 0;
  let measureCrossings = 0;
  let latestRequest;
  let latestUpdateFlags = 0;
  let latestUpdateGeneration = 0;
  let latestBatchCount = 0;
  let latestBatchRootIds = [];
  WebAssembly.instantiate = async (source, imports) => {
    const instance = await originalInstantiate(source, imports);
    const exports = { ...instance.exports };
    const update = exports[abi.functions.textUpdate];
    assert.equal(typeof update, 'function', 'instrumented shaper must export text_update');
    exports[abi.functions.textUpdate] = (...arguments_) => {
      crossings += 1;
      latestBatchCount = 1;
      const [, pointer, length] = arguments_;
      latestRequest = new Uint8Array(exports.memory.buffer, pointer, length).slice();
      const resultPointer = update(...arguments_);
      if (resultPointer !== 0) {
        const header = new DataView(exports.memory.buffer, resultPointer, abi.layouts.engineResult.size);
        latestUpdateFlags = header.getUint32(abi.layouts.engineResult.flags, true);
        latestUpdateGeneration = header.getUint32(abi.layouts.engineResult.publicationGeneration, true);
      }
      return resultPointer;
    };
    const updateBatch = exports[abi.functions.textUpdateBatch];
    const requestPointer = exports[abi.functions.requestPointer];
    assert.equal(typeof updateBatch, 'function', 'instrumented shaper must export text_update_batch');
    assert.equal(typeof requestPointer, 'function', 'instrumented shaper must export request_ptr');
    exports[abi.functions.textUpdateBatch] = (pointer, count) => {
      crossings += 1;
      latestBatchCount = count;
      latestBatchRootIds = [];
      const entry = abi.layouts.engineUpdateBatchEntry;
      const before = new DataView(exports.memory.buffer, pointer, count * entry.size);
      for (let index = 0; index < count; index += 1) {
        const offset = index * entry.size;
        const rootId = before.getUint32(offset + entry.rootId, true);
        latestBatchRootIds.push(rootId);
        const length = before.getUint32(offset + entry.requestLength, true);
        const request = requestPointer(rootId);
        latestRequest = new Uint8Array(exports.memory.buffer, request, length).slice();
      }
      const status = updateBatch(pointer, count);
      const results = new DataView(exports.memory.buffer, pointer, count * entry.size);
      for (let index = 0; index < count; index += 1) {
        const resultPointer = results.getUint32(index * entry.size + entry.resultPointer, true);
        if (resultPointer === 0) continue;
        const header = new DataView(exports.memory.buffer, resultPointer, abi.layouts.engineResult.size);
        latestUpdateFlags = header.getUint32(abi.layouts.engineResult.flags, true);
        latestUpdateGeneration = header.getUint32(abi.layouts.engineResult.publicationGeneration, true);
      }
      return status;
    };
    const measure = exports[abi.functions.measureParagraph];
    if (typeof measure === 'function') {
      exports[abi.functions.measureParagraph] = (...arguments_) => {
        measureCrossings += 1;
        return measure(...arguments_);
      };
    }
    return { exports };
  };
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    WebAssembly.instantiate = originalInstantiate;
  };
  return {
    restoreInstantiate: restore,
    get crossings() {
      return crossings;
    },
    get measureCrossings() {
      return measureCrossings;
    },
    get latestUpdateFlags() {
      return latestUpdateFlags;
    },
    get latestUpdateGeneration() {
      return latestUpdateGeneration;
    },
    get latestBatchCount() {
      return latestBatchCount;
    },
    get latestBatchRootIds() {
      return [...latestBatchRootIds];
    },
    get latestAcknowledgedGeneration() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      return new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength).getUint32(
        request.acknowledgedPublicationGeneration,
        true,
      );
    },
    reset() {
      crossings = 0;
      measureCrossings = 0;
      latestBatchRootIds = [];
    },
    latestParagraphMutations() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      const mutation = abi.layouts.engineParagraphMutation;
      const view = new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength);
      const offset = view.getUint32(request.paragraphMutationsOffset, true);
      const count = view.getUint32(request.paragraphMutationCount, true);
      return Array.from({ length: count }, (_recordValue, index) => {
        const record = offset + index * mutation.size;
        return {
          opcode: view.getUint8(record + mutation.opcode),
          flags: view.getUint8(record + mutation.flags),
          reserved0: view.getUint16(record + mutation.reserved0, true),
          paragraphId: view.getUint32(record + mutation.paragraphId, true),
          order: view.getUint32(record + mutation.order, true),
        };
      });
    },
    latestConstraints() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      const constraint = abi.layouts.engineConstraint;
      const view = new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength);
      const offset = view.getUint32(request.constraintsOffset, true);
      const count = view.getUint32(request.constraintCount, true);
      return Array.from({ length: count }, (_recordValue, index) => {
        const record = offset + index * constraint.size;
        return {
          paragraphId: view.getUint32(record + constraint.paragraphId, true),
          flowThreadId: view.getUint32(record + constraint.flowThreadId, true),
          regionStart: view.getUint32(record + constraint.regionStart, true),
          regionCount: view.getUint16(record + constraint.regionCount, true),
          resumeRegion: view.getUint16(record + constraint.resumeRegion, true),
        };
      });
    },
    latestRegions() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      const region = abi.layouts.engineRegion;
      const view = new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength);
      const offset = view.getUint32(request.regionsOffset, true);
      const count = view.getUint32(request.regionCount, true);
      return Array.from({ length: count }, (_recordValue, index) => {
        const record = offset + index * region.size;
        return {
          id: view.getUint32(record + region.id, true),
          transformIndex: view.getUint32(record + region.transformIndex, true),
        };
      });
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
}

test('Text.measure answers attached first-frame state without traversing matrices or realizing draws', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const first = three.createText({
    font,
    text: 'measure me before the frame',
    constraints: { width: { mode: 'exact', size: 180 } },
  });
  const second = three.createText({ font, text: 'and me too' });
  first.position.set(12, 34, 0);
  second.position.set(56, 78, 0);

  assert.ok(first.measure().glyphCount > 0, 'detached Text measurement needs no matrix or render attachment');
  assert.deepEqual(first.commitState(), { status: 'unbound' });
  group.add(first, second);
  scene.add(group);
  const matricesBefore = [first, second, group, scene].map((object) => Array.from(object.matrix.elements));
  instrumentedGlyph.reset();

  const firstMeasurement = first.measure();
  const secondMeasurement = second.measure();
  assert.ok(firstMeasurement.lineCount > 0);
  assert.ok(secondMeasurement.glyphCount > 0);
  assert.equal(firstMeasurement.inkBounds, undefined, 'the fast measurement path does not position glyph ink');
  assert.equal(instrumentedGlyph.crossings, 0, 'measurement must not publish a full engine frame');
  assert.equal(instrumentedGlyph.measureCrossings, 2, 'each new paragraph uses one scoped query');
  assert.equal(group.gpuBytes, 0, 'measurement must not realize renderer buffers');
  assert.equal(group.children.length, 2, 'measurement must not add renderer draw objects');
  for (const [index, object] of [first, second, group, scene].entries()) {
    assert.deepEqual(object.matrix.elements, matricesBefore[index], 'measurement must not update local matrices');
  }
  assert.deepEqual(first.commitState(), { status: 'pending' });
  assert.deepEqual(second.commitState(), { status: 'pending' });

  scene.updateMatrixWorld(true);
  assert.equal(group.error, undefined);
  assert.equal(instrumentedGlyph.crossings, 1, 'the first traversal publishes exactly one full frame');
  assert.equal(
    instrumentedGlyph.latestUpdateFlags & textShaperAbi.engine.resultFlags.checkpoint,
    textShaperAbi.engine.resultFlags.checkpoint,
    "the planner's first render plan is necessarily its initial checkpoint",
  );
  assert.equal(instrumentedGlyph.measureCrossings, 2, 'publication must not repeat the host measurement query');
  assert.equal(first.commitState().status, 'committed');
  assert.equal(second.commitState().status, 'committed');
  assert.equal(first.boundingBox.isEmpty(), false, 'the first positioned publication must install ink bounds');
  assert.ok(first.boundingBox.max.x > first.boundingBox.min.x);
  assert.ok(first.boundingBox.max.y > first.boundingBox.min.y);
  assert.equal(
    instrumentedGlyph.measureCrossings,
    2,
    'reading first-frame bounds must reuse the measurement published beside the render plan',
  );

  group.dispose();
  first.dispose();
  second.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('root-owned Text.measure creates only its implicit measurement batch before traversal', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({ font, text: 'standalone first-frame measurement' });
  label.position.set(19, 23, 0);
  scene.add(label);
  const matricesBefore = [label, scene].map((object) => Array.from(object.matrix.elements));
  instrumentedGlyph.reset();

  assert.ok(label.measure().glyphCount > 0);
  assert.equal(instrumentedGlyph.crossings, 0);
  assert.equal(instrumentedGlyph.measureCrossings, 1);
  const inspection = label.glyphs();
  assert.ok(inspection.inkBounds, 'explicit positioned inspection provides pre-frame ink bounds');
  assert.equal(instrumentedGlyph.measureCrossings, 2);
  assert.equal(label.boundingBox.isEmpty(), false);
  assert.equal(instrumentedGlyph.measureCrossings, 2, 'the Three box reuses the positioned inspection');
  assert.equal(label.gpuBytes, 0);
  assert.equal(label.children.length, 0);
  for (const [index, object] of [label, scene].entries()) {
    assert.deepEqual(object.matrix.elements, matricesBefore[index], 'measurement must not update local matrices');
  }
  assert.deepEqual(label.commitState(), { status: 'pending' });

  scene.updateMatrixWorld(true);
  assert.equal(instrumentedGlyph.crossings, 1);
  assert.equal(
    instrumentedGlyph.measureCrossings,
    2,
    'publication adopts the explicit queries instead of repeating them',
  );
  assert.equal(label.commitState().status, 'committed');

  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('Bitmap strike changes fully initialize a replacement indexed batch', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(densityFontUrl)) },
    bitmap({ strikes: [16, 32] }),
  );
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({
    font,
    rasterPixelRatio: 2,
    text: 'AB',
    style: { fontSize: 8 },
    constraints: { width: { mode: 'exact', size: 80 } },
    layout: { wrap: 'word' },
  });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  const initialDraw = rootDraws(scene)[0];
  assert.ok(initialDraw);
  const initialStart = initialDraw.userData.pmndrsGlyphRunStart;
  const initialOrigins = initialDraw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id)).array;
  const initialAdvance = initialOrigins[(initialStart + 1) * 2] - initialOrigins[initialStart * 2];

  label.style = { ...label.style, fontSize: 16 };
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'crossing from the 16 ppem strike to 32 ppem must publish successfully');
  const draw = rootDraws(scene)[0];
  assert.ok(draw);
  const start = draw.userData.pmndrsGlyphRunStart;
  const transforms = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id)).array;
  assert.deepEqual(Array.from(transforms.subarray(start, start + draw.geometry.instanceCount)), [1, 1]);
  const scaledOrigins = draw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id)).array;
  const scaledAdvance = scaledOrigins[(start + 1) * 2] - scaledOrigins[start * 2];
  assert.ok(
    Math.abs(scaledAdvance - initialAdvance * 2) < 1e-5,
    'a metric-only font-size mutation must rebuild advances without reshaping',
  );

  label.constraints = { ...label.constraints, width: { mode: 'exact', size: 40 } };
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'width-only reflow must retain the initialized transform stream');

  group.dispose();
  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('multi-page Bitmap strikes remain one ordered texture-array draw', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(densityFontUrl)) },
    bitmap({ strikes: [16, 32] }),
  );
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({
    font,
    rasterPixelRatio: 2,
    text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !?.,;:'.repeat(24),
    style: { fontSize: 16 },
    constraints: { width: { mode: 'exact', size: 480 } },
    layout: { wrap: 'word' },
  });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  const draws = rootDraws(scene);
  assert.equal(draws.length, 1, 'atlas page changes must select texture-array layers without fragmenting draws');
  assert.ok(
    draws[0].geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.page.id)),
    'the Bitmap plan must publish a page-layer stream',
  );

  group.dispose();
  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('Rust ellipsis reshapes only the narrowed unsafe line boundary', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(amiriFontUrl)) }, bitmap({ strikes: [16] }));
  const text = 'مرحبا بالعالم';

  const scene = new THREE.Scene();
  const label = three.createText({
    font,
    text,
    style: { fontSize: 16 },
    constraints: { width: { mode: 'exact', size: 37 } },
    layout: { maxLines: 1, wrap: 'none', overflow: 'ellipsis' },
  });
  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.error, undefined);
  const inspection = label.glyphs();
  assert.ok(inspection);
  assert.equal(inspection.lineTextEnds[0], 3, 'the fixed width must preserve the unsafe-boundary fixture');
  assert.equal(inspection.clusters.at(-1), 3, 'the ellipsis is anchored at the truncation boundary');
  assert.deepEqual([...inspection.glyphIds], [61, 2613, 2598, 6597]);
  assert.deepEqual([...inspection.clusters], [2, 1, 0, 3]);
  // Re-pinned under the F16.16 layout-unit contract: the RTL alignment origin is
  // derived from the higher-resolution quantized line advance. Relative glyph
  // advances remain unchanged; only the uniform line origin moved by 0.01337 units.
  assert.deepEqual([...inspection.x], [0.23200830817222595, 10.808008193969727, 18.376008987426758, 23.91200828552246]);

  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('one Three root atomically replaces child paragraphs without multiplying retained text capacity', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 4_096, policy: 'grow' } }));
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const first = [three.createText({ font, text: 'A' }), three.createText({ font, text: 'B' })];
  group.add(...first);
  scene.add(group);
  scene.updateMatrixWorld();

  instrumentedGlyph.reset();
  const second = ['C', 'D', 'E'].map((text) => three.createText({ font, text }));
  group.remove(...first);
  group.add(...second);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  const paragraphMutations = instrumentedGlyph.latestParagraphMutations();
  const opcodes = textShaperAbi.engine.paragraphMutationOpcodes;
  assert.equal(paragraphMutations.filter(({ opcode }) => opcode === opcodes.remove).length, 2);
  assert.equal(paragraphMutations.filter(({ opcode }) => opcode === opcodes.upsert).length, 3);
  assert.ok(
    paragraphMutations.every(({ flags, reserved0 }) => flags === 0 && reserved0 === 0),
    'the retained planner owns zeroed paragraph mutation reserved fields',
  );
  assert.ok(
    paragraphMutations.filter(({ opcode }) => opcode === opcodes.remove).every(({ order }) => order === 0),
    'the retained planner owns the canonical zero order for paragraph removals',
  );
  assert.equal(rootDraws(scene).length, 1);
  assert.equal(rootDraws(scene)[0].geometry.instanceCount, 3);

  const third = ['Y', 'Z'].map((text) => three.createText({ font, text }));
  group.remove(...second);
  group.add(...third);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'a recycled Rust paragraph must not retain its previous semantic contents');
  assert.equal(rootDraws(scene).length, 1);
  assert.equal(rootDraws(scene)[0].geometry.instanceCount, 2);

  group.dispose();
  for (const text of [...first, ...second, ...third]) text.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('one Three root grows aggregate glyph storage without reserving one aggregate-sized paragraph', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 4_096, policy: 'chunk' } }));
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const labels = Array.from({ length: 684 }, (_, index) => three.createText({ font, text: `icon-${String(index)}` }));
  group.add(...labels);
  scene.add(group);
  scene.updateMatrixWorld();

  assert.equal(group.error, undefined);
  assert.equal(group.textCount, labels.length);
  assert.equal(rootDraws(scene).length, 1);

  for (let cycle = 0; cycle < 200; cycle += 1) {
    for (let offset = 0; offset < 48; offset += 1) {
      const index = (cycle * 23 + offset) % labels.length;
      labels[index].text = `recycled-${String(cycle)}-${String(index)}`;
    }
    scene.updateMatrixWorld();
    assert.equal(group.error, undefined, `recycling cycle ${String(cycle)} must remain publishable`);
  }

  group.dispose();
  for (const label of labels) label.dispose();
  font.dispose();
  fontDomain.dispose();
});

/**
 * Roadmap 11.17 layer 4: layout under a geometry-only change routes to the
 * paragraph-scoped synchronous engine query — no full planner updates, no
 * publication flips, no revision burn — and the following ordinary frame adopts the
 * speculative work without a checkpoint rebuild.
 */
test('repeated layout under changing constraints stays on the paragraph query path', async (t) => {
  const abi = textShaperAbi;
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({
    font,
    text: 'alpha beta gamma delta',
    constraints: { width: { mode: 'exact', size: 300 } },
  });
  scene.add(label);
  scene.updateMatrixWorld(true);
  assert.equal(label.error, undefined);
  const committedGeneration = instrumentedGlyph.latestUpdateGeneration;
  instrumentedGlyph.reset();

  const widths = [90, 150, 90, 240];
  for (const width of widths) {
    label.set({
      constraints: { width: { mode: 'exact', size: width } },
    });
    const measurement = label.measure();
    assert.ok(measurement, `width ${width} measures synchronously`);
    assert.ok(
      measurement.contentWidth <= width + 1e-3,
      `content width ${measurement.contentWidth} respects the queried width ${width}`,
    );
    assert.ok(measurement.lineCount >= 1, 'layout reports laid-out lines');
  }
  assert.equal(instrumentedGlyph.crossings, 0, 'measurement never drives a full engine update');
  assert.equal(instrumentedGlyph.measureCrossings, widths.length, 'each constraint change measures through one query');
  assert.equal(
    instrumentedGlyph.latestUpdateGeneration,
    committedGeneration,
    'queries never flip the publication generation',
  );

  scene.updateMatrixWorld(true);
  assert.equal(label.error, undefined);
  assert.equal(instrumentedGlyph.crossings, 1, 'one ordinary frame commits the final constraint');
  assert.equal(
    instrumentedGlyph.latestUpdateFlags & abi.engine.resultFlags.checkpoint,
    0,
    'the committing frame proceeds from pre-layout revisions without a checkpoint rebuild',
  );
  assert.equal(label.measure().contentWidth <= 240 + 1e-3, true);
  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('a standard ligature that absorbs a grapheme publishes and keeps typing', async (t) => {
  // A ligature reports one glyph at the first grapheme of the pair, so the trailing
  // grapheme's cluster owns no glyph. It still belongs to the shaped run and positioning
  // still derives a scale for it, so the cluster arena must record the owning font's
  // units-per-em for it as well. Amiri applies `liga` to Latin f-pairs; Inter as baked
  // does not, which is why every existing Latin fixture missed this.
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(amiriFontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  scene.add(group);
  const text = three.createText({
    font,
    text: '',
    style: { fontSize: 20, lineHeight: 1.25 },
    constraints: { width: { mode: 'exact', size: 600 } },
    layout: { wrap: 'word' },
  });
  group.add(text);

  const typed = 'meet office';
  for (let length = 1; length <= typed.length; length += 1) {
    text.text = typed.slice(0, length);
    scene.updateMatrixWorld(true);
    assert.equal(text.error, undefined, `typing "${typed.slice(0, length)}" must publish`);
  }
  const ligated = text.measure();
  assert.equal(ligated?.missingGlyphCount, 0, 'the ligature resolves to a real glyph');

  // The ligature genuinely absorbs graphemes: with `liga` off the same text needs more
  // glyphs, which is what makes the glyph-less trailing cluster reachable at all.
  text.style = { fontSize: 20, lineHeight: 1.25, features: [{ tag: 'liga', value: 0 }] };
  scene.updateMatrixWorld(true);
  assert.equal(text.error, undefined);
  const unligated = text.measure();
  assert.ok(
    unligated !== undefined && ligated !== undefined && unligated.glyphCount > ligated.glyphCount,
    `disabling liga must add glyphs (ligated ${ligated?.glyphCount}, unligated ${unligated?.glyphCount})`,
  );

  group.dispose();
  text.dispose();
  font.dispose();
  fontDomain.dispose();
});

function createThreeFontDomain(firstLoad, onDispose = () => {}) {
  let initial = true;
  return {
    loadFont(input, raster) {
      const load = () => loadFont(input, raster);
      if (!initial || firstLoad === undefined) return load();
      initial = false;
      return firstLoad(load);
    },
    dispose() {
      onDispose();
    },
  };
}

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}

function rootDraws(scene, name = undefined) {
  const renderObject = scene.getObjectByName(name === undefined ? '@pmndrs/glyph:anonymous' : `@pmndrs/glyph:${name}`);
  return renderObject?.children.filter((child) => child.isMesh) ?? [];
}
