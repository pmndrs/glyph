import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  Constraints,
  createFontStack,
  glyph,
  ParagraphLayout,
  TextStyle,
  txt,
  bitmap,
  msdf,
  slug,
} from '@pmndrs/glyph';
import { createFontLibrary, loadFont } from '../../dist/loader.js';
import { GlyphHandleState } from '../../dist/internal/handle-state.js';
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
import { ThreeCommandBufferRenderer } from '../../dist/three/command-buffer-renderer.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';
import { compileNodeMaterial } from '../support/node-material-shaders.mjs';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const densityFontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url);
const amiriFontUrl = new URL('../../../../benches/fixtures/rendering/amiri-bitmap-16.font.glb', import.meta.url);
const sourceSerifFontUrl = new URL(
  '../../../../benches/fixtures/rendering/source-serif-4-bitmap-16.font.glb',
  import.meta.url,
);
const iconSlugFontUrl = new URL(
  '../../../../benches/fixtures/rendering/font-awesome-free-6.7.2-slug.font.glb.gz',
  import.meta.url,
);
const interSlugFontUrl = new URL('../../../../benches/fixtures/rendering/inter-slug.font.glb.gz', import.meta.url);
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

test('host topology authority refreshes metadata and rejects changed scope or storage', async (t) => {
  const frames = [];
  let spanCalls = 0;
  const three = await createThreeTestHandle(t, {
    ...ThreeConfig,
    schema: {
      ...ThreeConfig.schema,
      preservesHostTopology: true,
      instanceSpan(boundary, input) {
        spanCalls += 1;
        return ThreeConfig.schema.instanceSpan(boundary, input);
      },
    },
    renderer(context) {
      const renderer = ThreeConfig.renderer(context);
      const decode = renderer.decode.bind(renderer);
      renderer.decode = (frame) => {
        frames.push({ kind: frame.displayList.kind, retained: frame.displayList.retainedTopology });
        const before = spanCalls;
        const prepared = decode(frame);
        if (frame.displayList.retainedTopology === true) {
          assert.equal(spanCalls, before, 'retained renderer does not force lazy schema constructors');
          const span = frame.displayList.value.children.at(0).instances.at(0);
          assert.ok(Number.isFinite(span.value.input.inlineExtent), 'fresh metadata remains lazily readable');
          assert.ok(spanCalls > before, 'explicit metadata consumption invokes the constructor');
        }
        return prepared;
      };
      return renderer;
    },
  });
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const other = three.createTextGroup();
  const label = three.createText({ font, text: '54,321' });
  group.add(label);
  scene.add(group, other);
  try {
    scene.updateMatrixWorld(true);
    assert.equal(frames.at(-1).retained, undefined, 'cold publication has no accepted topology');
    const calls = spanCalls;
    label.text = '12,345';
    scene.updateMatrixWorld(true);
    assert.deepEqual(frames.at(-1), { kind: 'replace', retained: true });
    assert.ok(spanCalls > calls, 'complete fresh metadata still passes through custom schema callbacks');
    const acceptedDraw = rootDraws(scene)[0];
    acceptedDraw.removeFromParent();
    label.text = '98,765';
    scene.updateMatrixWorld(true);
    assert.equal(frames.at(-1).retained, true);
    assert.equal(rootDraws(scene)[0], acceptedDraw, 'metadata update restores a detached accepted host mesh');
    const acceptedCount = frames.length;
    assert.throws(() => {
      label.constraints = { width: { mode: 'exact', size: NaN } };
    });
    scene.updateMatrixWorld(true);
    assert.equal(frames.length, acceptedCount, 'rejected setters do not invalidate accepted producer state');
    other.add(label);
    scene.updateMatrixWorld(true);
    assert.equal(
      frames.at(-1).retained,
      undefined,
      'changed scope/transform binding requires complete host replacement',
    );
    label.text = 'a long paragraph that forces larger instance storage '.repeat(16);
    scene.updateMatrixWorld(true);
    assert.equal(frames.at(-1).retained, undefined, 'count and storage replacement revoke topology authority');
  } finally {
    label.dispose();
    group.dispose();
    other.dispose();
    font.dispose();
  }
});

test('spread schema overrides lose inherited host topology certification', async (t) => {
  const observed = [];
  const phases = [];
  const three = await createThreeTestHandle(t, {
    ...ThreeConfig,
    schema: {
      ...ThreeConfig.schema,
      instanceSpan(boundary, input) {
        observed.push(input.inlineExtent);
        return Object.freeze({
          ...ThreeConfig.schema.instanceSpan(boundary, input),
          metadataExtent: input.inlineExtent,
        });
      },
    },
    renderer(context) {
      const renderer = ThreeConfig.renderer(context);
      const decode = renderer.decode.bind(renderer);
      renderer.decode = (frame) => {
        phases.push(frame.displayList.retainedTopology);
        return decode(frame);
      };
      return renderer;
    },
  });
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({ font, text: 'iiiiii' });
  scene.add(label);
  try {
    scene.updateMatrixWorld(true);
    const count = observed.length;
    const oldExtent = observed.at(-1);
    label.text = 'WWWWWW';
    scene.updateMatrixWorld(true);
    assert.equal(
      phases.at(-1),
      undefined,
      'spread callback override revokes inherited certification without explicit opt-out',
    );
    assert.ok(observed.length > count, 'ordinary replacement executes metadata-dependent constructors');
    assert.notEqual(observed.at(-1), oldExtent, 'the callback receives the new proportional-font bounds');
  } finally {
    label.dispose();
    font.dispose();
  }
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

test('Text renderOrder ranks grouped paragraphs while standalone Text keeps Three draw order', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup({ renderOrder: 4 });
  const labels = ['A', 'B', 'C'].map((text) => three.createText({ font, text }));
  group.add(...labels);
  scene.add(group);
  scene.updateMatrixWorld(true);

  const groupedSequence = () => {
    const draws = rootDraws(scene).filter((draw) => draw.renderOrder === 4);
    assert.equal(draws.length, 1, 'one group shares one compatible draw');
    const attribute = draws[0].geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id));
    const start = draws[0].userData.pmndrsGlyphRunStart;
    return Array.from({ length: draws[0].geometry.instanceCount }, (_, index) => attribute.getX(start + index));
  };

  const authored = groupedSequence();
  const transforms = rootDraws(scene)[0].geometry.getAttribute('_pmndrsGlyphTransforms');
  const transformVersion = transforms.version;
  const minimum = labels[0].boundingBox.min;
  const setMinimum = minimum.set;
  let boundingBoxPublications = 0;
  minimum.set = function setTrackedMinimum(x, y, z) {
    boundingBoxPublications += 1;
    return setMinimum.call(this, x, y, z);
  };
  t.after(() => {
    minimum.set = setMinimum;
  });
  labels[0].renderOrder = 2;
  labels[1].renderOrder = 1;
  labels[2].renderOrder = 0;
  instrumentedGlyph.reset();
  scene.updateMatrixWorld(true);
  assert.deepEqual(groupedSequence(), [...authored].reverse());
  assert.equal(instrumentedGlyph.crossings, 1, 'one paragraph-order transaction crosses into Rust');
  assert.deepEqual(
    instrumentedGlyph.latestPlanCounts(),
    { buffers: 0, draws: 0, patches: 9, primitives: 0, resources: 0, retirements: 0 },
    'an order-only frame publishes only writes into the existing physical buffers',
  );
  assert.equal(instrumentedGlyph.measureCrossings, 0, 'order-only publication reuses measurements');
  assert.equal(boundingBoxPublications, 0, 'order-only publication does not republish cached bounds');
  assert.equal(
    transforms.version,
    transformVersion,
    'order-only publication leaves the retained transform storage untouched',
  );
  assert.deepEqual(
    instrumentedGlyph.latestParagraphMutations(),
    [],
    'scoped rank updates do not republish unchanged base lifecycle order',
  );
  const orderMutations = instrumentedGlyph.latestParagraphOrderMutations();
  assert.equal(new Set(orderMutations.map(({ orderScope }) => orderScope)).size, 1);
  assert.ok(orderMutations[0].orderScope > 0);
  assert.deepEqual(
    orderMutations.map(({ orderRank }) => orderRank),
    [2, 1],
    'the adapter publishes only changed data-only ranks in stable order and leaves the permutation to Rust',
  );
  instrumentedGlyph.reset();
  scene.updateMatrixWorld(true);
  assert.equal(instrumentedGlyph.crossings, 0, 'an unchanged ranked group does no sorting or Wasm work');

  labels[0].renderOrder = 0;
  labels[1].renderOrder = 1;
  labels[2].renderOrder = 2;
  labels[0].position.x = 7;
  const transformVersionBeforeMixedUpdate = transforms.version;
  instrumentedGlyph.reset();
  scene.updateMatrixWorld(true);
  assert.deepEqual(groupedSequence(), authored, 'the aggregate draw survives a reverse-order round trip');
  assert.deepEqual(
    instrumentedGlyph.latestPlanCounts(),
    { buffers: 0, draws: 0, patches: 9, primitives: 0, resources: 0, retirements: 0 },
    'the reverse-order round trip also stays patch-only',
  );
  assert.equal(
    transforms.version,
    transformVersionBeforeMixedUpdate + 1,
    'the ordinary transform synchronizer uploads one mixed transform-and-order frame',
  );
  assert.equal(
    transforms.array[authored[0] * 16 + 12],
    7,
    'the order-only publication does not suppress a transform changed in the same frame',
  );

  const loose = three.createText({ font, text: 'D' });
  loose.renderOrder = 9;
  scene.add(loose);
  scene.updateMatrixWorld(true);
  assert.deepEqual(
    rootDraws(scene)
      .map((draw) => draw.renderOrder)
      .sort((left, right) => left - right),
    [4, 10],
    'standalone Text renderOrder remains the mesh-level base (plus deterministic draw offset)',
  );

  loose.dispose();
  group.dispose();
  for (const label of labels) label.dispose();
  font.dispose();
});

test('rank-only updates republish bindings when one storage batch has multiple materials', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const namedMaterial = (name) =>
    defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      material.name = name;
      return material;
    });
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const first = three.createText({ font, material: namedMaterial('first'), text: 'first' });
  const second = three.createText({ font, material: namedMaterial('second'), text: 'second' });
  group.add(first, second);
  scene.add(group);
  scene.updateMatrixWorld(true);

  try {
    assert.equal(rootDraws(scene).length, 2);
    const materialTransforms = () =>
      Object.fromEntries(
        rootDraws(scene).map((draw) => {
          const attribute = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id));
          const start = draw.userData.pmndrsGlyphRunStart;
          return [
            draw.material.name,
            Array.from({ length: draw.geometry.instanceCount }, (_, index) => attribute.getX(start + index)),
          ];
        }),
      );
    const authoredTransforms = materialTransforms();
    first.renderOrder = 1;
    second.renderOrder = 0;
    instrumentedGlyph.reset();
    scene.updateMatrixWorld(true);
    const counts = instrumentedGlyph.latestPlanCounts();
    assert.ok(counts.draws > 0, 'multiple material draws must be republished after physical reordering');
    assert.ok(counts.primitives > 0, 'multiple material spans must be republished with their draws');
    assert.deepEqual(materialTransforms(), authoredTransforms, 'each material keeps its authored transform span');
  } finally {
    first.dispose();
    second.dispose();
    group.dispose();
    font.dispose();
  }
});

test('rank-only updates republish bindings for direct paragraph transforms', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ transformMode: 'direct' }));
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const first = three.createText({ font, text: 'first' });
  const second = three.createText({ font, text: 'second' });
  first.position.x = -10;
  second.position.x = 10;
  group.add(first, second);
  scene.add(group);
  scene.updateMatrixWorld(true);

  try {
    assert.equal(rootDraws(scene).length, 2);
    first.renderOrder = 1;
    second.renderOrder = 0;
    instrumentedGlyph.reset();
    scene.updateMatrixWorld(true);
    const counts = instrumentedGlyph.latestPlanCounts();
    assert.ok(counts.draws > 0, 'direct transform draws must be republished after physical reordering');
    assert.ok(counts.primitives > 0, 'direct transform spans must be republished with their draws');
    assert.equal(rootDraws(scene).length, 2);
  } finally {
    first.dispose();
    second.dispose();
    group.dispose();
    font.dispose();
  }
});

test('patch-only publications retain direct transform synchronization', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ transformMode: 'direct' }));
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({
    constraints: { width: { mode: 'exact', size: 200 } },
    font,
    layout: { wrap: 'word' },
    text: 'one two three four',
  });
  scene.add(label);
  scene.updateMatrixWorld(true);

  try {
    const draw = rootDraws(scene)[0];
    label.position.x = 42;
    label.constraints = { ...label.constraints, width: { mode: 'exact', size: 60 } };
    instrumentedGlyph.reset();
    scene.updateMatrixWorld(true);
    assert.equal(rootDraws(scene)[0], draw, 'a width-only reflow keeps the direct draw');
    assert.equal(instrumentedGlyph.latestPlanCounts().draws, 0, 'the width-only reflow remains patch-only');
    assert.equal(draw.matrix.elements[12], 42, 'the direct draw receives the transform changed in the same frame');

    label.visible = false;
    label.constraints = { ...label.constraints, width: { mode: 'exact', size: 80 } };
    instrumentedGlyph.reset();
    scene.updateMatrixWorld(true);
    assert.equal(
      instrumentedGlyph.latestPlanCounts().draws,
      0,
      'visibility with a width-only reflow remains patch-only',
    );
    assert.equal(draw.visible, false, 'the retained direct draw receives visibility changed in the same frame');
  } finally {
    label.dispose();
    font.dispose();
  }
});

test('patch-only publications refresh a standalone Text added after the publication root', async (t) => {
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));

  try {
    for (const transformMode of ['indexed', 'direct']) {
      await t.test(transformMode, async (subtest) => {
        const three = await createThreeTestHandle(subtest, defineThreeConfig({ transformMode }));
        const scene = new THREE.Scene();
        const first = three.createText({ font, text: 'A' });
        scene.add(first);
        scene.updateMatrixWorld(true);

        const late = three.createText({
          constraints: { width: { mode: 'exact', size: 200 } },
          font,
          layout: { wrap: 'word' },
          text: 'one two three four',
        });
        late.position.x = 7;
        scene.add(late);
        scene.updateMatrixWorld(true);

        try {
          const draws = rootDraws(scene);
          let visibleX;
          if (transformMode === 'direct') {
            const draw = draws.find((candidate) => candidate.matrix.elements[12] === 7);
            assert.ok(draw, 'the late Text owns one direct draw at its accepted transform');
            visibleX = () => draw.matrix.elements[12];
          } else {
            const transforms = draws[0].geometry.getAttribute('_pmndrsGlyphTransforms');
            const transformId = Array.from({ length: transforms.array.length / 16 }, (_, index) => index).find(
              (index) => transforms.array[index * 16 + 12] === 7,
            );
            assert.notEqual(
              transformId,
              undefined,
              'the late Text owns one indexed transform at its accepted position',
            );
            visibleX = () => transforms.array[transformId * 16 + 12];
          }

          late.position.x = 42;
          late.constraints = { ...late.constraints, width: { mode: 'exact', size: 60 } };
          instrumentedGlyph.reset();
          scene.updateMatrixWorld(true);

          assert.equal(instrumentedGlyph.latestPlanCounts().draws, 0, 'the width-only reflow remains patch-only');
          assert.equal(visibleX(), 42, 'the late Text transform becomes visible in the accepting scene traversal');

          const renderObject = scene.getObjectByName('@pmndrs/glyph:anonymous');
          assert.ok(renderObject);
          scene.add(renderObject);
          assert.ok(
            scene.children.indexOf(late) < scene.children.indexOf(renderObject),
            'the late-added Text must now precede the private publication root',
          );
          late.position.x = 84;
          late.constraints = { ...late.constraints, width: { mode: 'exact', size: 80 } };
          instrumentedGlyph.reset();
          scene.updateMatrixWorld(true);
          assert.equal(
            instrumentedGlyph.latestPlanCounts().draws,
            0,
            'the second width-only reflow remains patch-only',
          );
          assert.equal(visibleX(), 84, 'a late-added Text before the private root keeps same-frame transforms');
        } finally {
          late.dispose();
          first.dispose();
        }
      });
    }
  } finally {
    font.dispose();
  }
});

test('manual shaping preserves sibling Text transforms during draw replacement', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const label = three.createText({ font, text: 'A' });
  scene.add(label);
  scene.updateMatrixWorld(true);

  try {
    scene.matrixWorldAutoUpdate = false;
    label.position.x = 11;
    label.updateMatrix();
    label.updateWorldMatrix(true, false);
    label.text = 'A much longer replacement paragraph';
    instrumentedGlyph.reset();
    glyph.shape();
    assert.ok(instrumentedGlyph.latestPlanCounts().draws > 0, 'the edit replaces the draw publication');
    const draw = rootDraws(scene)[0];
    const transformIndices = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id));
    const transformId = transformIndices.getX(draw.userData.pmndrsGlyphRunStart);
    const transforms = draw.geometry.getAttribute('_pmndrsGlyphTransforms');
    assert.equal(
      transforms.array[transformId * 16 + 12],
      11,
      'manual publication resolves visibility through the application scene rather than the private draw root',
    );
  } finally {
    label.dispose();
    font.dispose();
  }
});

test('an unstated TextGroup keeps child paragraph ranks out of Three material keys', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const labels = ['A', 'B', 'C'].map((text, rank) => {
    const label = three.createText({ font, text });
    label.renderOrder = 2 - rank;
    return label;
  });
  group.add(...labels);
  scene.add(group);
  scene.updateMatrixWorld(true);

  const draws = rootDraws(scene);
  assert.equal(draws.length, 1, 'default group presentation remains one compatible draw');
  assert.equal(draws[0].renderOrder, 0, 'the group retains Three default draw order');

  for (const label of labels) label.dispose();
  group.dispose();
  font.dispose();
});

test('Rust ranks interleaved TextGroup scopes only within their stable root slots', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const firstGroup = three.createTextGroup({ batching: 'shared', renderOrder: 4 });
  const secondGroup = three.createTextGroup({ batching: 'shared', renderOrder: 4 });
  const firstA = three.createText({ font, text: 'A' });
  const secondA = three.createText({ font, text: 'B' });
  const firstB = three.createText({ font, text: 'C' });
  const secondB = three.createText({ font, text: 'D' });
  firstGroup.add(firstA, firstB);
  secondGroup.add(secondA, secondB);
  scene.add(firstGroup, secondGroup);
  scene.updateMatrixWorld(true);

  const sequence = () => {
    const draws = rootDraws(scene).filter((draw) => draw.renderOrder === 4);
    assert.equal(draws.length, 1, 'equal group presentation remains one compatible draw');
    const attribute = draws[0].geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id));
    const start = draws[0].userData.pmndrsGlyphRunStart;
    return Array.from({ length: draws[0].geometry.instanceCount }, (_, index) => attribute.getX(start + index));
  };
  const authored = sequence();
  firstA.renderOrder = 1;
  firstA.text = 'AA';
  firstB.renderOrder = 0;
  scene.updateMatrixWorld(true);
  assert.deepEqual(
    sequence(),
    [authored[2], authored[1], authored[0], authored[0], authored[3]],
    'rank and semantic mutations share one atomic frame while scoped ranks only permute their own slots',
  );
  instrumentedGlyph.reset();
  firstA.text = 'E';
  firstB.text = 'F';
  scene.updateMatrixWorld(true);
  assert.equal(firstGroup.error, undefined);
  assert.deepEqual(
    instrumentedGlyph.latestParagraphOrderMutations(),
    [],
    'content-only edits do not republish unchanged paragraph ranks',
  );
  assert.deepEqual(
    instrumentedGlyph.latestRequestCounts(),
    {
      paragraph: 0,
      paragraphOrder: 0,
      text: 2,
      style: 1,
      constraint: 0,
      region: 0,
      exclusion: 0,
      inlineObject: 0,
    },
    'variable-length content edits publish text and root-style coverage without unchanged lifecycle or geometry',
  );
  assert.deepEqual(
    sequence(),
    [authored[2], authored[1], authored[0], authored[3]],
    'later semantic records stay in authored order after the ranked render order commits',
  );

  firstGroup.remove(firstA);
  scene.updateMatrixWorld(true);
  firstGroup.add(firstA);
  scene.updateMatrixWorld(true);
  assert.equal(firstGroup.error, undefined);
  assert.deepEqual(
    sequence(),
    [authored[2], authored[1], authored[0], authored[3]],
    'detach and reattach preserves the root membership slots used by scoped permutation',
  );
  const restagedMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  firstGroup.material = restagedMaterial;
  secondGroup.material = restagedMaterial;
  scene.updateMatrixWorld(true);
  assert.equal(firstGroup.error, undefined, 'a shared restage accepts reattached planner insertion order');
  assert.equal(secondGroup.error, undefined);
  assert.deepEqual(
    sequence(),
    [authored[2], authored[1], authored[0], authored[3]],
    'Rust consumes paragraph-keyed content independently of planner insertion order',
  );

  for (const text of [firstA, secondA, firstB, secondB]) text.dispose();
  firstGroup.dispose();
  secondGroup.dispose();
  font.dispose();
});

test('automatic sibling TextGroups own draws while shared siblings recover 0.1.0 coalescing', async (t) => {
  const three = await createThreeTestHandle(t);
  assert.throws(
    () => three.createTextGroup({ batching: 'isolated' }),
    /TextGroup batching must be "auto", "shared", or "group"/,
  );
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const first = three.createTextGroup();
  const second = three.createTextGroup();
  const firstLabel = three.createText({ font, text: 'A' });
  const secondLabel = three.createText({ font, text: 'B' });
  first.add(firstLabel);
  second.add(secondLabel);
  scene.add(first, second);
  scene.updateMatrixWorld(true);

  try {
    const automaticDraws = rootDraws(scene);
    assert.equal(automaticDraws.length, 2, 'each top-level automatic group owns one compatible draw');
    first.visible = false;
    scene.updateMatrixWorld(true);
    assert.deepEqual(
      automaticDraws.map((draw) => draw.visible),
      [false, true],
      'the first automatic sibling owns the first draw visibility scope',
    );
    first.visible = true;
    scene.updateMatrixWorld(true);
    assert.equal(automaticDraws[0].material, automaticDraws[1].material, 'split draws reuse one realized material');
    assert.deepEqual(
      automaticDraws.map((draw) => draw.renderOrder),
      [0, 1],
      'split draws receive stable authored-order submission ranks',
    );

    first.batching = 'shared';
    second.batching = 'shared';
    scene.updateMatrixWorld(true);
    assert.equal(rootDraws(scene).length, 1, 'shared restores the globally coalesced 0.1.0 draw topology');
  } finally {
    firstLabel.dispose();
    secondLabel.dispose();
    first.dispose();
    second.dispose();
    font.dispose();
  }
});

test('TextGroup batching resolves automatic roots, shared structure, and explicit nested boundaries', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const first = three.createTextGroup();
  const nestedAuto = three.createTextGroup();
  const nestedGroup = three.createTextGroup({ batching: 'group' });
  const second = three.createTextGroup();
  const sharedA = three.createTextGroup({ batching: 'shared' });
  const sharedB = three.createTextGroup({ batching: 'shared' });
  const labels = Array.from({ length: 6 }, (_, index) => three.createText({ font, text: String(index) }));
  nestedAuto.add(labels[1]);
  nestedGroup.add(labels[2]);
  first.add(labels[0], nestedAuto, nestedGroup);
  second.add(labels[3]);
  sharedA.add(labels[4]);
  sharedB.add(labels[5]);
  scene.add(first, second, sharedA, sharedB);
  scene.updateMatrixWorld(true);

  try {
    const initialDraws = rootDraws(scene);
    assert.equal(
      initialDraws.length,
      4,
      'two automatic roots, one explicit nested group, and one implicit shared scope own four draws',
    );
    assert.equal(first.batching, 'auto');
    instrumentedGlyph.reset();
    first.visible = false;
    scene.updateMatrixWorld(true);
    const firstBoundaryDraws = initialDraws.filter((draw) => !draw.visible);
    assert.equal(firstBoundaryDraws.length, 2, 'the automatic root and explicit descendant own separate draw scopes');
    assert.equal(instrumentedGlyph.crossings, 0, 'group visibility does not enter Wasm or rebuild the display list');
    assert.deepEqual(rootDraws(scene), initialDraws, 'group visibility preserves every realized mesh');
    assert.ok(
      firstBoundaryDraws.every((draw) => !draw.visible),
      'ancestor visibility suppresses owned draw scopes',
    );
    assert.equal(
      rootDraws(scene).filter((draw) => draw.visible).length,
      2,
      'hiding an automatic root suppresses its draw and every explicit descendant boundary',
    );
    instrumentedGlyph.reset();
    first.visible = true;
    scene.updateMatrixWorld(true);
    assert.equal(instrumentedGlyph.crossings, 0, 'restoring group visibility remains renderer-owned');
    assert.deepEqual(rootDraws(scene), initialDraws, 'restoring visibility reuses the same meshes and buffers');
    assert.ok(
      firstBoundaryDraws.every((draw) => draw.visible),
      'restoring the ancestor restores each owned draw scope',
    );
    nestedGroup.batching = 'shared';
    scene.updateMatrixWorld(true);
    assert.equal(rootDraws(scene).length, 3, 'a shared nested group rejoins its automatic root draw scope');
  } finally {
    for (const label of labels) label.dispose();
    for (const group of [nestedAuto, nestedGroup, first, second, sharedA, sharedB]) group.dispose();
    font.dispose();
  }
});

test('0.2 manual visibility retains 1,000 labels across row and ancestor changes', async (t) => {
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const rowCount = 10;
  const labelsPerRow = 100;

  try {
    for (const transformMode of ['indexed', 'direct']) {
      await t.test(transformMode, async (subtest) => {
        const configured = defineThreeConfig({
          capacity: { size: 2_048, policy: 'grow' },
          transformMode,
        });
        let rendererPublications = 0;
        const three = await createThreeTestHandle(subtest, {
          ...configured,
          renderer(context) {
            const renderer = configured.renderer(context);
            const decode = renderer.decode.bind(renderer);
            renderer.decode = (frame) => {
              rendererPublications += 1;
              return decode(frame);
            };
            return renderer;
          },
        });
        const scene = new THREE.Scene();
        const ancestor = new THREE.Group();
        const rows = [];
        const labels = [];
        let editedLabel;

        try {
          for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
            const batching = rowIndex % 2 === 0 ? 'auto' : 'group';
            const row = three.createTextGroup({ batching });
            row.position.y = -rowIndex * 18;
            for (let column = 0; column < labelsPerRow; column += 1) {
              const edited = rowIndex === 3 && column === 0;
              const label = three.createText({
                font,
                text: edited ? 'A A' : 'A',
                ...(edited
                  ? {
                      constraints: { width: { mode: 'exact', size: 240 } },
                      layout: { wrap: 'word' },
                    }
                  : {}),
              });
              label.position.x = column * 12;
              row.add(label);
              labels.push(label);
              if (edited) editedLabel = label;
            }
            rows.push(row);
            ancestor.add(row);
          }
          scene.add(ancestor);
          scene.updateMatrixWorld(true);

          assert.ok(editedLabel);
          assert.equal(three.textCount, 1_000, 'the retained root accepts the complete release-scale label set');
          assert.deepEqual(
            rows.map((row) => row.batching),
            Array.from({ length: rowCount }, (_, index) => (index % 2 === 0 ? 'auto' : 'group')),
            'the public batching policy partitions alternating automatic and explicit row boundaries',
          );
          const initialDraws = rootDraws(scene);
          assert.ok(initialDraws.length >= rowCount, 'every retained row owns at least one draw scope');
          assert.ok(
            initialDraws.every((draw) => draw.visible),
            'the accepted initial publication is fully visible',
          );
          assert.ok(rendererPublications > 0, 'the initial traversal reaches renderer acceptance');
          const acceptedPublications = rendererPublications;
          const initialMeasurement = editedLabel.measure();
          assert.ok(initialMeasurement);
          assert.equal(initialMeasurement.lineCount, 1, 'the editable label begins on one wide line');
          const retainedDrawResources = initialDraws.map((draw) => ({
            draw,
            geometry: draw.geometry,
            index: draw.geometry.index,
            attributes: Object.entries(draw.geometry.attributes),
          }));
          const assertRetainedDrawResources = (stage) => {
            const current = rootDraws(scene);
            assert.equal(current.length, retainedDrawResources.length, `${stage} retains the accepted draw count`);
            for (let index = 0; index < current.length; index += 1) {
              const retained = retainedDrawResources[index];
              assert.equal(current[index], retained.draw, `${stage} retains mesh ${String(index)}`);
              assert.equal(current[index].geometry, retained.geometry, `${stage} retains geometry ${String(index)}`);
              assert.equal(
                current[index].geometry.index,
                retained.index,
                `${stage} retains index buffer ${String(index)}`,
              );
              assert.deepEqual(
                Object.keys(current[index].geometry.attributes),
                retained.attributes.map(([name]) => name),
                `${stage} retains the buffer set for draw ${String(index)}`,
              );
              for (const [name, attribute] of retained.attributes) {
                assert.equal(
                  current[index].geometry.getAttribute(name),
                  attribute,
                  `${stage} retains ${name} for draw ${String(index)}`,
                );
              }
            }
          };

          const automaticRow = rows[2];
          instrumentedGlyph.reset();
          automaticRow.visible = false;
          scene.updateMatrixWorld(true);
          const automaticOwnedDraws = initialDraws.filter((draw) => !draw.visible);
          assert.ok(automaticOwnedDraws.length > 0, 'the hidden automatic row suppresses its owned draw scopes');
          assert.ok(
            initialDraws.some((draw) => draw.visible),
            'hiding one automatic row leaves unrelated row draws visible',
          );
          assert.equal(instrumentedGlyph.crossings, 0, 'manual row visibility does not cross into Wasm');
          assert.equal(rendererPublications, acceptedPublications, 'manual row visibility does not publish');
          assertRetainedDrawResources('automatic row hide');

          instrumentedGlyph.reset();
          automaticRow.visible = true;
          scene.updateMatrixWorld(true);
          assert.ok(
            initialDraws.every((draw) => draw.visible),
            'restoring the automatic row restores every owned draw',
          );
          assert.equal(instrumentedGlyph.crossings, 0, 'automatic row restoration does not cross into Wasm');
          assert.equal(rendererPublications, acceptedPublications, 'automatic row restoration does not publish');
          assertRetainedDrawResources('automatic row restoration');

          instrumentedGlyph.reset();
          ancestor.visible = false;
          scene.updateMatrixWorld(true);
          assert.ok(
            initialDraws.every((draw) => !draw.visible),
            'ancestor visibility suppresses every retained row',
          );
          assert.equal(instrumentedGlyph.crossings, 0, 'ancestor visibility does not cross into Wasm');
          assert.equal(rendererPublications, acceptedPublications, 'ancestor visibility does not publish');
          assertRetainedDrawResources('ancestor hide');

          instrumentedGlyph.reset();
          ancestor.visible = true;
          scene.updateMatrixWorld(true);
          assert.ok(
            initialDraws.every((draw) => draw.visible),
            'restoring the ancestor restores every retained row',
          );
          assert.equal(instrumentedGlyph.crossings, 0, 'ancestor restoration does not cross into Wasm');
          assert.equal(rendererPublications, acceptedPublications, 'ancestor restoration does not publish');
          assertRetainedDrawResources('ancestor restoration');

          const explicitRow = rows[3];
          instrumentedGlyph.reset();
          explicitRow.visible = false;
          scene.updateMatrixWorld(true);
          const explicitOwnedDraws = initialDraws.filter((draw) => !draw.visible);
          assert.ok(explicitOwnedDraws.length > 0, 'the hidden explicit row suppresses its owned draw scopes');
          assert.ok(
            explicitOwnedDraws.every((draw) => !automaticOwnedDraws.includes(draw)),
            'automatic and explicit rows own disjoint draw scopes',
          );
          assert.ok(
            initialDraws.some((draw) => draw.visible),
            'the hidden explicit row leaves unrelated rows visible',
          );
          assert.equal(instrumentedGlyph.crossings, 0, 'explicit row visibility does not cross into Wasm');
          assert.equal(rendererPublications, acceptedPublications, 'explicit row visibility does not publish');
          assertRetainedDrawResources('explicit row hide');

          const editedDrawableGlyphCount = 12;
          const editedText = Array.from({ length: editedDrawableGlyphCount }, () => 'A').join(' ');
          editedLabel.set({
            text: editedText,
            constraints: { width: { mode: 'exact', size: 24 } },
            layout: { wrap: 'word' },
          });
          instrumentedGlyph.reset();
          const beforeEditPublications = rendererPublications;
          scene.updateMatrixWorld(true);
          assert.equal(
            instrumentedGlyph.crossings,
            1,
            'the hidden semantic edit publishes through the normal root path',
          );
          assert.equal(
            rendererPublications,
            beforeEditPublications + 1,
            'the hidden edit and reflow produce one accepted renderer publication',
          );
          const editedMeasurement = editedLabel.measure();
          assert.ok(
            editedMeasurement && editedMeasurement.lineCount > initialMeasurement.lineCount,
            'the accepted hidden edit exposes the current narrower reflow through the public measurement',
          );
          assert.equal(editedLabel.text, editedText, 'the retained Text exposes the accepted edited source');
          assert.equal(
            instrumentedGlyph.measureCrossings,
            0,
            'reading the accepted hidden reflow uses its cached result',
          );
          const editedDraws = rootDraws(scene);
          const editedOwnedDraws = editedDraws.filter((draw) => !draw.visible);
          assert.ok(editedOwnedDraws.length > 0, 'replacement preparation preserves the hidden row state');
          assert.ok(
            editedDraws.some((draw) => draw.visible),
            'the hidden edit leaves unrelated rows visible',
          );
          assert.equal(
            editedOwnedDraws.reduce((count, draw) => count + draw.geometry.instanceCount, 0),
            labelsPerRow - 1 + editedDrawableGlyphCount,
            'the hidden row contains the current drawable A glyphs rather than its initial output',
          );
          assertRetainedDrawResources('hidden row edit and reflow');

          instrumentedGlyph.reset();
          const acceptedEditPublications = rendererPublications;
          explicitRow.visible = true;
          scene.updateMatrixWorld(true);
          assert.ok(
            editedOwnedDraws.every((draw) => draw.visible),
            'restoring the edited row reveals its current draws',
          );
          assert.ok(
            rootDraws(scene).every((draw) => draw.visible),
            'the restored retained workload is fully visible',
          );
          assert.equal(
            editedOwnedDraws.reduce((count, draw) => count + draw.geometry.instanceCount, 0),
            labelsPerRow - 1 + editedDrawableGlyphCount,
            'restoration keeps the accepted edited output current',
          );
          assert.equal(instrumentedGlyph.crossings, 0, 'restoring edited output does not cross into Wasm');
          assert.equal(rendererPublications, acceptedEditPublications, 'restoring edited output does not publish');
          assert.equal(editedLabel.measure(), editedMeasurement, 'restoration preserves the accepted reflow snapshot');
          assertRetainedDrawResources('edited row restoration');
        } finally {
          for (const label of labels) label.dispose();
          for (const row of rows) row.dispose();
        }
      });
    }
  } finally {
    font.dispose();
  }
});

test('groups without a committed batch scope skip scope visibility synchronization', async (t) => {
  const synchronizeBatchVisibility = ThreeCommandBufferRenderer.prototype.synchronizeBatchVisibility;
  let synchronizations = 0;
  ThreeCommandBufferRenderer.prototype.synchronizeBatchVisibility = function (...args) {
    synchronizations += 1;
    return synchronizeBatchVisibility.apply(this, args);
  };
  t.after(() => {
    ThreeCommandBufferRenderer.prototype.synchronizeBatchVisibility = synchronizeBatchVisibility;
  });
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const cases = [
    { transformMode: 'indexed', batching: 'auto', expected: 1 },
    { transformMode: 'indexed', batching: 'shared', expected: 0 },
    { transformMode: 'direct', batching: 'auto', expected: 0 },
  ];

  try {
    for (const scenario of cases) {
      await t.test(`${scenario.transformMode}-${scenario.batching}`, async (subtest) => {
        const three = await createThreeTestHandle(
          subtest,
          defineThreeConfig({ transformMode: scenario.transformMode }),
        );
        const scene = new THREE.Scene();
        const group = three.createTextGroup({ batching: scenario.batching });
        const label = three.createText({ font, text: `${scenario.transformMode} ${scenario.batching}` });
        group.add(label);
        scene.add(group);
        scene.updateMatrixWorld(true);

        synchronizations = 0;
        group.visible = false;
        scene.updateMatrixWorld(true);
        assert.equal(
          synchronizations,
          scenario.expected,
          'only an indexed group with an owned committed scope performs batch visibility work',
        );
        label.dispose();
        group.dispose();
      });
    }
  } finally {
    font.dispose();
  }
});

test('clean transform synchronization skips committed draw metadata and updates only changed batch scopes', async (t) => {
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));

  try {
    for (const transformMode of ['indexed', 'direct']) {
      await t.test(transformMode, async (subtest) => {
        const three = await createThreeTestHandle(subtest, defineThreeConfig({ transformMode }));
        const scene = new THREE.Scene();
        const parent = new THREE.Group();
        const groups = Array.from({ length: 3 }, () => three.createTextGroup());
        const labels = groups.map((group, index) => {
          const label = three.createText({ font, text: `scope ${String(index)}` });
          group.add(label);
          return label;
        });
        parent.add(...groups);
        scene.add(parent);
        scene.updateMatrixWorld(true);

        try {
          const draws = groups.map((group) => singleDrawAffectedByGroupVisibility(scene, group));
          const writes = draws.map((draw) => observeDrawMetadataWrites(draw));
          const resetWrites = () => {
            for (const write of writes) {
              write.renderOrder = 0;
              write.visible = 0;
            }
          };

          resetWrites();
          scene.updateMatrixWorld(true);
          assert.deepEqual(
            writes,
            writes.map(() => ({ renderOrder: 0, visible: 0 })),
            'an unchanged traversal must not rewrite committed draw metadata',
          );

          labels[1].style = { ...labels[1].style, color: '#00ff00' };
          scene.updateMatrixWorld(true);
          assert.deepEqual(
            writes,
            writes.map(() => ({ renderOrder: 0, visible: 0 })),
            'a patch-only paint publication must not rescan unchanged draw bindings',
          );

          groups[1].visible = false;
          scene.updateMatrixWorld(true);
          assert.deepEqual(
            writes,
            [
              { renderOrder: 0, visible: 0 },
              { renderOrder: 0, visible: 1 },
              { renderOrder: 0, visible: 0 },
            ],
            'one group visibility change must touch only its retained draw scope',
          );
          assert.equal(draws[1].visible, false);

          resetWrites();
          parent.visible = false;
          scene.updateMatrixWorld(true);
          assert.deepEqual(
            writes.map(({ visible }) => visible),
            [1, 0, 1],
            'ancestor visibility must touch each newly hidden descendant scope and skip the already hidden scope',
          );
          assert.ok(draws.every((draw) => !draw.visible));

          resetWrites();
          parent.visible = true;
          groups[1].visible = true;
          scene.updateMatrixWorld(true);
          assert.deepEqual(
            writes.map(({ visible }) => visible),
            [1, 1, 1],
            'restoring ancestor and local visibility must update exactly the affected scopes',
          );
          assert.ok(draws.every((draw) => draw.visible));

          if (transformMode === 'direct') {
            const renderObject = scene.getObjectByName('@pmndrs/glyph:anonymous');
            assert.ok(renderObject);
            scene.add(parent);
            assert.ok(
              scene.children.indexOf(renderObject) < scene.children.indexOf(parent),
              'the private publication root must precede the authored direct transforms',
            );
            labels[1].visible = false;
            groups[1].visible = false;
            scene.updateMatrixWorld(true);
            groups[1].visible = true;
            scene.updateMatrixWorld(true);
            assert.equal(
              draws[1].visible,
              false,
              'late group visibility observation must not override an already traversed hidden direct Text',
            );
          }
        } finally {
          for (const label of labels) label.dispose();
          for (const group of groups) group.dispose();
        }
      });
    }
  } finally {
    font.dispose();
  }
});

test('deterministic retained renderer mutations match cold checkpoints in indexed and direct modes', async (t) => {
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));

  try {
    for (const transformMode of ['indexed', 'direct']) {
      await t.test(transformMode, async (subtest) => {
        const three = await createThreeTestHandle(
          subtest,
          defineThreeConfig({ capacity: { size: 2, policy: 'grow' }, transformMode }),
        );
        const scene = new THREE.Scene();
        const parent = new THREE.Group();
        const entries = [];
        const mounted = new Map();
        let nextId = 0;
        let randomState = transformMode === 'indexed' ? 0x247_1d : 0x247_d1;
        const random = () => {
          randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
          return randomState;
        };
        const insert = () => {
          const id = nextId++;
          const entry = {
            id,
            batching: 'auto',
            color: '#ffffff',
            renderOrder: 0,
            text: `label ${String(id)}`,
            visible: true,
            x: id * 3,
          };
          entries.splice(random() % (entries.length + 1), 0, entry);
          mounted.set(id, mountRendererDifferentialEntry(three, font, parent, entry));
          parent.add(...entries.map(({ id: entryId }) => mounted.get(entryId).group));
        };
        insert();
        insert();
        scene.add(parent);
        scene.updateMatrixWorld(true);
        const storageGenerations = new Set(
          rootDraws(scene).map((draw) => draw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id))),
        );
        let storageGenerationChanged = false;

        try {
          for (let step = 0; step < 30; step += 1) {
            const selected = entries[random() % entries.length];
            assert.ok(selected);
            const live = mounted.get(selected.id);
            assert.ok(live);
            switch (step % 10) {
              case 0: {
                if (entries.length < 5) insert();
                else {
                  selected.text += ' growing';
                  live.label.text = selected.text;
                }
                break;
              }
              case 1: {
                selected.text = `${selected.text} ${'growth '.repeat((step % 4) + 1)}`;
                live.label.text = selected.text;
                break;
              }
              case 2: {
                selected.color = (random() & 1) === 0 ? '#00ff00' : '#ff00ff';
                live.label.style = { ...live.label.style, color: selected.color };
                break;
              }
              case 3: {
                selected.x = (random() % 31) - 15;
                live.group.position.x = selected.x;
                break;
              }
              case 4: {
                selected.visible = !selected.visible;
                live.group.visible = selected.visible;
                break;
              }
              case 5: {
                entries.push(...entries.splice(random() % entries.length, 1));
                selected.renderOrder = (random() % 7) - 3;
                live.group.renderOrder = selected.renderOrder;
                parent.add(...entries.map(({ id }) => mounted.get(id).group));
                break;
              }
              case 6: {
                selected.text = selected.text.length === 0 ? `restored ${String(selected.id)}` : '';
                live.label.text = selected.text;
                break;
              }
              case 7: {
                selected.batching = selected.batching === 'auto' ? 'shared' : 'auto';
                live.group.batching = selected.batching;
                break;
              }
              case 8: {
                if (entries.length > 1) {
                  const removed = entries.splice(random() % entries.length, 1)[0];
                  const removedLive = mounted.get(removed.id);
                  removedLive.label.dispose();
                  removedLive.label.removeFromParent();
                  removedLive.group.dispose();
                  removedLive.group.removeFromParent();
                  mounted.delete(removed.id);
                }
                break;
              }
              case 9: {
                parent.visible = !parent.visible;
                break;
              }
            }

            const renderObject = scene.getObjectByName('@pmndrs/glyph:anonymous');
            assert.ok(renderObject);
            if ((step & 1) === 0) scene.add(parent);
            else scene.add(renderObject);
            scene.updateMatrixWorld(true);
            for (const draw of rootDraws(scene)) {
              const storage = draw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id));
              if (storageGenerations.has(storage)) continue;
              storageGenerations.add(storage);
              storageGenerationChanged = true;
            }

            const retained = rendererDifferentialSnapshot(scene, undefined, entries, mounted);
            const coldName = `cold-${transformMode}-${String(step)}`;
            const coldRoot = three(coldName);
            const coldScene = new THREE.Scene();
            const coldParent = new THREE.Group();
            coldParent.visible = parent.visible;
            const coldMounted = new Map();
            for (const entry of [...entries].sort((left, right) => left.id - right.id)) {
              coldMounted.set(entry.id, mountRendererDifferentialEntry(coldRoot, font, coldParent, entry));
            }
            coldParent.add(...entries.map(({ id }) => coldMounted.get(id).group));
            coldScene.add(coldParent);
            coldScene.updateMatrixWorld(true);
            try {
              assert.deepEqual(
                retained,
                rendererDifferentialSnapshot(coldScene, coldName, entries, coldMounted),
                `retained step ${String(step)} must match a cold full checkpoint`,
              );
            } finally {
              for (const { group, label } of coldMounted.values()) {
                label.dispose();
                group.dispose();
              }
              coldRoot.dispose();
            }
          }
          assert.equal(
            storageGenerationChanged,
            true,
            'the mutation sequence must cross a retained storage generation',
          );
        } finally {
          for (const { group, label } of mounted.values()) {
            label.dispose();
            group.dispose();
          }
        }
      });
    }
  } finally {
    font.dispose();
  }
});

test('a hidden automatic TextGroup never exposes its first realized draw', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({ font, text: 'hidden' });
  group.visible = false;
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld(true);

  try {
    const draws = rootDraws(scene);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].visible, false, 'the first publication observes authored ancestor visibility');
  } finally {
    label.dispose();
    group.dispose();
    font.dispose();
  }
});

test('a reused hidden boundary draw becomes visible after joining the shared pool', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({ font, text: 'reused' });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld(true);

  try {
    const [draw] = rootDraws(scene);
    assert.ok(draw);
    group.visible = false;
    scene.updateMatrixWorld(true);
    assert.equal(draw.visible, false);

    group.batching = 'shared';
    group.visible = true;
    scene.updateMatrixWorld(true);
    const [reused] = rootDraws(scene);
    assert.equal(reused, draw, 'changing scope reuses the compatible mesh');
    assert.equal(reused.visible, true, 'a scope-less reused draw cannot retain hidden boundary state');
  } finally {
    label.dispose();
    group.dispose();
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
    [ParagraphLayout, { centered: { align: 'center', dropCap: { lines: 3, marginInline: 4 } } }],
    [Constraints, { card: { width: { mode: 'at-most', size: 320 } } }],
  ]) {
    const created = registry.create(rules);
    assert.ok(Object.isFrozen(created));
    assert.ok(Object.isFrozen(Object.values(created)[0]));
  }
  assert.throws(() => Constraints.create({ broken: { width: { mode: 'exact', size: Number.NaN } } }), /size/);
  assert.throws(() => ParagraphLayout.create({ broken: { dropCap: { lines: 0 } } }), /dropCap lines/);
  assert.throws(
    () => ParagraphLayout.create({ broken: { dropCap: { lines: 2, marginInline: -1 } } }),
    /dropCap marginInline/,
  );
  ParagraphLayout.create({
    contoured: {
      dropCap: {
        lines: 3,
        contour: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      },
    },
  });
  assert.throws(
    () =>
      ParagraphLayout.create({
        broken: {
          dropCap: {
            lines: 2,
            contour: [
              [0, 0],
              [1.1, 0],
              [0, 1],
            ],
          },
        },
      }),
    /within \[0, 1\]/,
  );
});

test('public 2D flow accepts keyed polygons and composes around multiple exclusions', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());
  const text = three.createText({
    font,
    text: 'iiiiiiiiiiiiiiiiiiii',
    layout: { wrap: 'word', dropCap: { lines: 3, marginInline: 4 } },
    constraints: {
      width: { mode: 'exact', size: 120 },
      height: { mode: 'exact', size: 80 },
    },
    flow: {
      regions: [
        {
          key: 'body',
          shape: {
            kind: 'polygon',
            vertices: [
              [0, 0],
              [120, 0],
              [120, 80],
              [0, 80],
            ],
          },
          exclusions: [
            { key: 'first', shape: { kind: 'rectangle', bounds: [24 + 2 ** -30, 0, 34, 80] } },
            { key: 'second', shape: { kind: 'rectangle', bounds: [64, 0, 74, 80] } },
          ],
        },
      ],
    },
  });
  t.after(() => text.dispose());

  const layout = text.glyphs();
  assert.deepEqual(instrumentedGlyph.latestMeasurementRequestCounts(), {
    paragraph: 1,
    paragraphOrder: 0,
    text: 1,
    style: 1,
    constraint: 1,
    region: 1,
    exclusion: 2,
    inlineObject: 0,
  });
  assert.equal(layout.lineCount, 1, 'the three disjoint slots remain one logical line');
  const inlineJumps = [...layout.x]
    .slice(1)
    .map((x, index) => x - layout.x[index])
    .filter((advance) => advance > 8);
  assert.equal(inlineJumps.length, 2, 'the exclusions introduce two cross-slot x jumps');
  assert.ok(Object.isFrozen(text.flow));
  assert.ok(Object.isFrozen(text.flow.regions[0].shape.vertices));
  assert.equal(
    text.flow.regions[0].exclusions[0].shape.bounds[0],
    24,
    'public flow coordinates normalize to their exact f32 wire value before revision comparison',
  );

  assert.throws(() => {
    text.flow = {
      regions: [
        { key: 'duplicate', shape: { kind: 'rectangle', bounds: [0, 0, 20, 20] } },
        { key: 'duplicate', shape: { kind: 'rectangle', bounds: [20, 0, 40, 20] } },
      ],
    };
  }, /region key "duplicate" is duplicated/);
  assert.throws(() => {
    text.flow = {
      regions: [
        {
          key: 'crossed',
          shape: {
            kind: 'polygon',
            vertices: [
              [0, 0],
              [20, 20],
              [0, 20],
              [20, 0],
            ],
          },
        },
      ],
    };
  }, /nonzero finite area|must not self-intersect/);
});

test('moving multiple exclusions matches cold LTR, RTL, and mixed-direction flow', async (t) => {
  const three = await createThreeTestHandle(t);
  const [inter, amiri] = await Promise.all([
    loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] })),
    loadFont({ baked: { bytes: await readFile(amiriFontUrl) } }, bitmap({ strikes: [16] })),
  ]);
  const mixed = createFontStack(inter, amiri);
  t.after(() => {
    inter.dispose();
    amiri.dispose();
  });
  const flowAt = (moved) => ({
    regions: [
      {
        key: 'body',
        shape: { kind: 'rectangle', bounds: [0, 0, 220, 400] },
        exclusions: [
          {
            key: 'upper',
            shape: { kind: 'rectangle', bounds: moved ? [46, 20, 104, 80] : [18, 20, 76, 80] },
          },
          {
            key: 'lower',
            shape: {
              kind: 'polygon',
              vertices: moved
                ? [
                    [116, 84],
                    [182, 80],
                    [174, 144],
                    [108, 140],
                  ]
                : [
                    [140, 84],
                    [206, 80],
                    [198, 144],
                    [132, 140],
                  ],
            },
          },
        ],
      },
    ],
  });
  const cases = [
    {
      name: 'LTR',
      font: inter,
      text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau '.repeat(
        2,
      ),
      style: { direction: 'ltr', language: 'en' },
    },
    {
      name: 'RTL',
      font: amiri,
      text: 'النص العربي يتدفق بوضوح حول العوائق ويتابع القراءة بين الأعمدة دون فقدان ترتيب الكلمات '.repeat(2),
      style: { direction: 'rtl', language: 'ar' },
    },
    {
      name: 'mixed',
      font: mixed,
      text: 'النصPMNDRS2026العربي يتدفق حول object42 ثم يعود إلى العمود التالي مع Latintext واضح '.repeat(2),
      style: { direction: 'rtl', language: 'ar' },
    },
  ];
  const layoutFields = [
    'glyphIds',
    'clusters',
    'glyphFontSlots',
    'glyphBidiLevels',
    'glyphFontSizes',
    'x',
    'y',
    'glyphAdvances',
    'glyphInkX',
    'glyphInkY',
    'glyphInkWidths',
    'glyphInkHeights',
    'glyphFlags',
    'lineTextStarts',
    'lineTextEnds',
    'lineGlyphStarts',
    'lineGlyphCounts',
    'lineBaselines',
    'lineAdvances',
  ];

  for (const fixture of cases) {
    const properties = {
      font: fixture.font,
      text: fixture.text,
      style: { fontSize: 16, lineHeight: 1.25, ...fixture.style },
      constraints: {
        width: { mode: 'exact', size: 220 },
        height: { mode: 'exact', size: 400 },
      },
      layout: { align: 'justify', wrap: 'word' },
    };
    const retained = three.createText({ ...properties, flow: flowAt(false) });
    const initial = retained.glyphs();
    retained.flow = flowAt(true);
    const incremental = retained.glyphs();
    const cold = three.createText({ ...properties, flow: flowAt(true) });
    const rebuilt = cold.glyphs();
    try {
      assert.equal(retained.error, undefined, `${fixture.name} retained flow must publish`);
      assert.equal(cold.error, undefined, `${fixture.name} cold flow must publish`);
      assert.ok(incremental.lineCount > 2, `${fixture.name} must exercise multiple exclusion bands`);
      assert.ok(
        incremental.lineBaselines.some((baseline) => baseline >= 20 && baseline < 80),
        `${fixture.name} must cross the upper exclusion band`,
      );
      assert.ok(
        incremental.lineBaselines.some((baseline) => baseline >= 80 && baseline < 144),
        `${fixture.name} must cross the lower exclusion band`,
      );
      assert.notDeepEqual(
        Array.from(incremental.x),
        Array.from(initial.x),
        `${fixture.name} exclusions must move glyphs`,
      );
      if (fixture.name === 'LTR') {
        assert.ok(
          incremental.glyphBidiLevels.every((level) => (level & 1) === 0),
          'the LTR fixture must remain visually even-level',
        );
      } else if (fixture.name === 'RTL') {
        assert.ok(
          incremental.glyphBidiLevels.every((level) => (level & 1) === 1),
          'the RTL fixture must remain visually odd-level',
        );
      } else {
        assert.ok(new Set(incremental.glyphBidiLevels).size > 1, 'the mixed fixture must resolve multiple bidi levels');
      }
      assert.deepEqual(
        Array.from(incremental.glyphStableIds).sort((left, right) => left - right),
        Array.from(initial.glyphStableIds).sort((left, right) => left - right),
        `${fixture.name} exclusion movement must retain glyph identities`,
      );
      for (const field of layoutFields) {
        assert.deepEqual(
          Array.from(incremental[field]),
          Array.from(rebuilt[field]),
          `${fixture.name} ${field} must match cold flow`,
        );
      }
      assert.deepEqual(retained.measure(), cold.measure(), `${fixture.name} measurement must match cold flow`);
    } finally {
      retained.dispose();
      cold.dispose();
    }
  }
});

test('same-source drop caps preserve source ownership and flow body lines beside the cap', async (t) => {
  const three = await createThreeTestHandle(t);
  const [font, capFont] = await Promise.all([
    loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] })),
    loadFont({ baked: { bytes: gunzipSync(await readFile(interSlugFontUrl)) } }, slug),
  ]);
  const cap = textSpan(capFont, { fontSize: 48 });
  const source = 'f\u0301ollow brown fox jumps over the lazy dog and keeps running through the narrow column';
  const properties = {
    font,
    text: txt`${cap`f\u0301`}ollow brown fox jumps over the lazy dog and keeps running through the narrow column`,
    style: { fontSize: 16, lineHeight: 20 },
    constraints: { width: { mode: 'exact', size: 180 } },
    layout: {
      wrap: 'word',
      dropCap: {
        lines: 3,
        marginInline: 4,
        contour: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      },
    },
  };
  const label = three.createText(properties);
  const scene = new THREE.Scene();
  scene.add(label);
  scene.updateMatrixWorld();
  t.after(() => {
    label.dispose();
    font.dispose();
    capFont.dispose();
  });

  const measurement = label.measure();
  assert.equal(label.error, undefined);
  assert.ok(measurement.lineCount > 0, 'the combined flow must compose at least one body line');
  const layout = label.glyphs();
  assert.equal(layout.glyphCount, source.length, 'the source glyph stream has no duplicated or omitted unit');
  assert.deepEqual(
    Array.from(layout.clusters),
    [0, 0, ...Array.from({ length: source.length - 2 }, (_, index) => index + 2)],
    'the complete combining-mark grapheme stays in the cap and every later source unit stays in the body',
  );
  assert.ok(layout.lineCount > 3, 'the fixture must extend beyond the reserved body-line span');
  assert.equal(layout.lineTextStarts[0], 0, 'the first line owns the cap source prefix');

  const capIndex = layout.clusters.indexOf(0);
  const firstBodyIndex = layout.clusters.indexOf(2);
  assert.equal(capIndex, 0);
  assert.equal(firstBodyIndex, 2);
  assert.ok(layout.x[firstBodyIndex] > layout.x[capIndex] + 20, 'the first body line starts beside the cap');
  assert.ok(
    layout.x[layout.lineGlyphStarts[1]] < layout.x[firstBodyIndex],
    'the caller-authored triangular contour gives the next body line more inline space',
  );
  const firstUncutLineGlyph = layout.lineGlyphStarts[3];
  assert.ok(
    layout.x[firstUncutLineGlyph] < layout.x[firstBodyIndex],
    'body flow returns to the region start after the requested line span',
  );
  assert.ok(
    label.measureGlyphs()?.every((measuredGlyph) => measuredGlyph.drawnOrigin.equals(measuredGlyph.shapedOrigin)),
  );
  assert.equal(rootDraws(scene).length, 2, 'the Slug cap and Bitmap body remain two raster batches');

  label.text = txt`${cap`g\u0301`}ollow brown fox jumps over the lazy dog and keeps running through the narrow column`;
  scene.updateMatrixWorld(true);
  const incremental = label.glyphs();
  assert.equal(rootDraws(scene).length, 2, 'a retained cap edit preserves mixed-raster draw topology');
  const cold = three.createText({
    ...properties,
    text: txt`${cap`g\u0301`}ollow brown fox jumps over the lazy dog and keeps running through the narrow column`,
  });
  t.after(() => cold.dispose());
  const coldLayout = cold.glyphs();
  for (const field of ['glyphIds', 'clusters', 'lineGlyphStarts', 'lineGlyphCounts', 'x', 'y']) {
    assert.deepEqual(
      Array.from(incremental[field]),
      Array.from(coldLayout[field]),
      `${field} must match cold cap edit`,
    );
  }
});

test('same-source drop caps compose through an explicit multi-line flow region', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const cap = textSpan({ fontSize: 48 });
  const source = 'f\u0301ollow brown fox jumps over the lazy dog and keeps running through the narrow column';
  const formatted = txt`${cap`f\u0301`}ollow brown fox jumps over the lazy dog and keeps running through the narrow column`;
  const flowAt = (inlineStart) => ({
    regions: [
      {
        key: 'body',
        shape: { kind: 'rectangle', bounds: [0, 0, 180, 180] },
        exclusions: [{ key: 'lower-float', shape: { kind: 'rectangle', bounds: [inlineStart, 70, 175, 110] } }],
      },
    ],
  });
  const initialFlow = flowAt(130);
  const movedFlow = flowAt(105);
  const properties = {
    font,
    text: formatted,
    style: { fontSize: 16, lineHeight: 1.25 },
    constraints: {
      width: { mode: 'exact', size: 180 },
      height: { mode: 'exact', size: 180 },
    },
    layout: { wrap: 'word', dropCap: { lines: 3, marginInline: 4 } },
  };
  const label = three.createText({
    ...properties,
    flow: initialFlow,
  });
  scene.add(label);
  scene.updateMatrixWorld(true);
  t.after(() => {
    label.dispose();
    font.dispose();
  });

  const layout = label.glyphs();
  assert.equal(label.error, undefined);
  assert.ok(layout.lineCount > 3);
  assert.equal(layout.glyphCount, source.length);

  label.flow = movedFlow;
  scene.updateMatrixWorld(true);
  const incremental = label.glyphs();
  const cold = three.createText({ ...properties, flow: movedFlow });
  scene.add(cold);
  scene.updateMatrixWorld(true);
  t.after(() => cold.dispose());
  const coldLayout = cold.glyphs();
  assert.notDeepEqual(Array.from(incremental.x), Array.from(layout.x));
  assert.deepEqual(
    Array.from(incremental.glyphStableIds),
    Array.from(layout.glyphStableIds),
    'moving the exclusion must retain the paragraph glyph identities',
  );
  for (const field of ['clusters', 'lineGlyphStarts', 'lineGlyphCounts', 'x', 'y']) {
    assert.deepEqual(Array.from(incremental[field]), Array.from(coldLayout[field]), `${field} must match cold flow`);
  }
  const interactionSnapshot = (text) => {
    const inspected = text.glyphs();
    const bodyLine = 3;
    const bodyGlyph = inspected.lineGlyphStarts[bodyLine];
    const caret = (glyphIndex, line) => {
      const result = text.caretAt(inspected.x[glyphIndex], inspected.lineBaselines[line]);
      return result === undefined
        ? undefined
        : {
            offset: result.offset,
            leading: result.leading,
            rect: [result.rect.x, result.rect.y, result.rect.width, result.rect.height],
          };
    };
    const selection = (start, end) =>
      text.selectionRects(start, end)?.map((rect) => [rect.x, rect.y, rect.width, rect.height]);
    return {
      capCaret: caret(0, 0),
      bodyCaret: caret(bodyGlyph, bodyLine),
      capSelection: selection(0, 2),
      bodySelection: selection(2, source.length),
      measurements: text.measureGlyphs()?.map((placement) => ({
        index: placement.index,
        shapedOrigin: placement.shapedOrigin.toArray(),
        drawnOrigin: placement.drawnOrigin.toArray(),
        matrix: placement.originalMatrix.toArray(),
        ink: [...placement.localInkBounds.min.toArray(), ...placement.localInkBounds.max.toArray()],
        advance: [...placement.localAdvanceBounds.min.toArray(), ...placement.localAdvanceBounds.max.toArray()],
      })),
    };
  };
  const incrementalInteractions = interactionSnapshot(label);
  assert.ok(incrementalInteractions.capSelection?.length === 1, 'the complete cap grapheme has one selection rect');
  assert.ok(incrementalInteractions.bodySelection?.length > 1, 'the body selection spans several composed lines');
  assert.ok(incrementalInteractions.capCaret !== undefined, 'the cap owns a reachable caret');
  assert.ok(incrementalInteractions.bodyCaret !== undefined, 'the resumed body owns a reachable caret');
  assert.deepEqual(
    incrementalInteractions,
    interactionSnapshot(cold),
    'drop-cap measurement, caret, and selection queries must match cold flow',
  );
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

test('Text.split imports a planner-assisted copy with exact world alignment and full matrices', async (t) => {
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
    'the fixture must leave the source local matrix stale before split',
  );

  let detached;
  try {
    [detached] = label.split();
    assert.deepEqual(
      detached.matrix.elements,
      label.matrix.elements,
      'the detached root must compose and copy the current source-local transform without ancestor traversal',
    );
    assert.equal(detached.position.x, 9, 'the copy must include local TRS changes made after the last traversal');
    sourceParent.add(detached);
    label.visible = false;

    assert.ok(detached.count > 0);
    const entries = Array.from({ length: detached.count }, (_, index) => detached.glyphAt(index));
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
    assert.ok(detached.count < label.glyphs().glyphCount, 'count excludes semantic-only spaces');
    assert.deepEqual(
      entries.map((entry) => entry.index),
      entries.map((_, index) => index),
      'indices are dense over drawable glyphs',
    );
    assert.ok(
      detached.measurements.every(({ localInkBounds }) => localInkBounds.max.x > localInkBounds.min.x),
      'every detached entry in this fixture has visible ink',
    );
    assert.ok(entries.every((entry) => !('sourceIndex' in entry)));
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
    assert.equal(comparedRecords, detached.count, 'every detached glyph owns one record');
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
    assert.ok(transforms.count / 4 >= comparedRecords, 'storage covers the copied plan physical record capacity');
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
  const [detached] = label.split();
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

test('Text.split returns a paragraph-scoped independent decoration plan when one exists', async (t) => {
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
    [detached, decorations] = label.split();
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
    const plainParts = plain.split();
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

test('Text.split preserves TextGroup paint order across detached roots', async (t) => {
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
    [glyphs, decorations] = label.split();
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

test('Text.split preserves per-span material routing with independently owned instances', async (t) => {
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
    [detached] = label.split();
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
  scene.updateMatrixWorld(true);
  assert.equal(firstDraws[0].renderOrder, 20, 'scene traversal must update grouped draw proxies');

  group.renderOrder = 21;
  group.updateMatrixWorld(true);
  assert.equal(firstDraws[0].renderOrder, 21, 'direct group traversal must update existing draw proxies');

  label.renderOrder = 7;
  scene.updateMatrixWorld();
  assert.equal(rootDraws(scene)[0].renderOrder, 21);
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

  // An unbounded justified last line fills the box; bounded word and letter growth may leave it short.
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

  // Ordered columns do not balance: reducing the height must move the paragraph tail into the second region.
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
    () => label.split(),
    /after renderer realization failed/,
    'a failed renderer publication cannot be presented as a committed detached copy',
  );
  assert.equal(instrumented.crossings, 1, 'inspection must not turn a rejected unchanged frame into a retry');

  failMaterial = false;
  group.visible = false;
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
  assert.equal(rootDraws(scene)[0].visible, false, 'retry must publish the current hidden batch scope');

  group.visible = true;
  scene.updateMatrixWorld();
  assert.equal(rootDraws(scene)[0].visible, true, 'the accepted retry must install live scope synchronization');

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

test('rejected draw replacement retains the accepted scope index and retry matches a cold preparation', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  let failReplacement = false;
  const replacementMaterial = defineTextMaterial((context) => {
    if (failReplacement) throw new Error('deliberate replacement failure');
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({ font, text: 'Accepted before retry' });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld(true);
  const accepted = rootDraws(scene)[0];
  assert.ok(accepted);

  failReplacement = true;
  label.material = replacementMaterial;
  scene.updateMatrixWorld(true);
  assert.match(String(label.error), /deliberate replacement failure/u);
  assert.equal(rootDraws(scene)[0], accepted, 'rejection must keep the accepted draw branch');

  group.visible = false;
  scene.updateMatrixWorld(true);
  assert.equal(accepted.visible, false, 'the accepted scope index remains live after rejection');
  group.visible = true;
  scene.updateMatrixWorld(true);
  assert.equal(accepted.visible, true, 'the accepted scope can be restored before retry');

  failReplacement = false;
  label.material = replacementMaterial;
  scene.updateMatrixWorld(true);
  assert.equal(label.error, undefined);

  const entry = {
    id: 0,
    batching: 'auto',
    color: '#ffffff',
    material: replacementMaterial,
    renderOrder: 0,
    text: label.text,
    visible: true,
    x: 0,
  };
  const mounted = new Map([[entry.id, { group, label }]]);
  const coldName = 'cold-replacement-retry';
  const coldRoot = three(coldName);
  const coldScene = new THREE.Scene();
  const coldParent = new THREE.Group();
  const coldMounted = new Map([[entry.id, mountRendererDifferentialEntry(coldRoot, font, coldParent, entry)]]);
  coldScene.add(coldParent);
  coldScene.updateMatrixWorld(true);
  try {
    assert.deepEqual(
      rendererDifferentialSnapshot(scene, undefined, [entry], mounted),
      rendererDifferentialSnapshot(coldScene, coldName, [entry], coldMounted),
      'the accepted retry must match a cold full preparation',
    );
  } finally {
    for (const cold of coldMounted.values()) {
      cold.label.dispose();
      cold.group.dispose();
    }
    coldRoot.dispose();
  }

  label.dispose();
  group.dispose();
  scene.updateMatrixWorld(true);
  assert.equal(rootDraws(scene).length, 0, 'disposing the accepted branch clears its scope index and draws');
  font.dispose();
});

test('material preparation rejection preserves the last accepted Three branch and core revision', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({ font, text: 'accepted before preparation failure' });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld(true);
  const acceptedDraw = rootDraws(scene)[0];
  assert.ok(acceptedDraw);
  assert.deepEqual(label.commitState(), { status: 'committed', revision: 0 });

  const preparationError = new Error('deliberate replacement material failure');
  let rejectReplacement = true;
  const replacementMaterial = defineTextMaterial((context) => {
    if (rejectReplacement) throw preparationError;
    return context.createDefaultMaterial();
  });
  group.material = replacementMaterial;
  assert.throws(
    () => glyph.shape(),
    (error) => error === preparationError,
    'the material factory failure must reject before host publication',
  );
  assert.equal(rootDraws(scene)[0], acceptedDraw, 'preparation failure must retain the accepted draw branch');
  assert.deepEqual(label.commitState(), { status: 'failed', error: preparationError });

  group.visible = false;
  scene.updateMatrixWorld(true);
  assert.equal(rootDraws(scene)[0], acceptedDraw, 'transform synchronization cannot publish the rejected branch');
  assert.equal(acceptedDraw.visible, false, 'the last accepted branch remains live for visibility changes');

  rejectReplacement = false;
  group.material = replacementMaterial;
  scene.updateMatrixWorld(true);
  assert.deepEqual(
    label.commitState(),
    { status: 'committed', revision: 0 },
    'retry keeps the accepted core revision paired with the newly accepted renderer branch',
  );
  assert.equal(label.error, undefined);

  label.dispose();
  group.dispose();
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

test('Three disposes superseded and final indexed-transform storage', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const root = three('transform-storage-lifetime');
  const scene = new THREE.Scene();
  const group = root.createTextGroup();
  const labels = [root.createText({ font, text: 'A' })];
  group.add(...labels);
  scene.add(group);
  scene.updateMatrixWorld();

  const initial = rootDraws(scene, 'transform-storage-lifetime')[0].geometry.getAttribute('_pmndrsGlyphTransforms');
  let initialDisposals = 0;
  initial.addEventListener('dispose', () => {
    initialDisposals += 1;
  });

  const added = Array.from({ length: 8 }, (_, index) => root.createText({ font, text: String(index) }));
  labels.push(...added);
  group.add(...added);
  scene.updateMatrixWorld();
  const grown = rootDraws(scene, 'transform-storage-lifetime')[0].geometry.getAttribute('_pmndrsGlyphTransforms');
  assert.notEqual(grown, initial, 'additional transform identities must grow the indexed table');
  assert.equal(initialDisposals, 1, 'the superseded transform table must be released after publication');

  let finalDisposals = 0;
  grown.addEventListener('dispose', () => {
    finalDisposals += 1;
  });
  root.dispose();
  assert.equal(finalDisposals, 1, 'disposing the root must release its final transform table');

  for (const label of labels) label.dispose();
  group.dispose();
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

test('throwing Three retirement callbacks preserve the accepted publication', async (t) => {
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());

  for (const resource of ['material', 'geometry']) {
    await t.test(resource, async (subtest) => {
      const config = defineThreeConfig({ capacity: { size: 1, policy: 'grow' } });
      const three = await createThreeTestHandle(subtest, config);
      const scene = new THREE.Scene();
      const group = three.createTextGroup({ renderOrder: 3 });
      const disposalError = new Error(`application ${resource} dispose listener failure`);
      let disposalEvents = 0;
      const acceptedMaterials = [];
      const acceptedMaterial = defineTextMaterial((context) => {
        const realized = context.createDefaultMaterial();
        acceptedMaterials.push(realized);
        if (resource === 'material') {
          realized.addEventListener('dispose', () => {
            disposalEvents += 1;
            throw disposalError;
          });
        }
        return realized;
      });
      const replacementMaterials = [];
      const replacementMaterial = defineTextMaterial((context) => {
        const realized = context.createDefaultMaterial();
        replacementMaterials.push(realized);
        return realized;
      });
      const label = three.createText({ font, material: acceptedMaterial, text: 'A' });
      group.add(label);
      scene.add(group);
      scene.updateMatrixWorld(true);
      const acceptedDraw = rootDraws(scene)[0];
      assert.ok(acceptedDraw);
      assert.equal(acceptedDraw.material, acceptedMaterials[0], 'the accepted draw must use its realized material');
      const acceptedRevision = label.commitState();
      assert.deepEqual(acceptedRevision, { status: 'committed', revision: 0 });
      if (resource === 'geometry') {
        acceptedDraw.geometry.addEventListener('dispose', () => {
          disposalEvents += 1;
          group.visible = false;
          scene.updateMatrixWorld(true);
          throw disposalError;
        });
      }

      label.material = replacementMaterial;
      label.text = 'replacement text forces retained storage growth';
      assert.throws(
        () => glyph.shape(),
        (error) => error === disposalError,
        'the caller-owned throw must surface',
      );

      const replacementDraw = rootDraws(scene)[0];
      assert.notEqual(replacementDraw, acceptedDraw, 'the replacement draw must be the published host branch');
      assert.equal(
        replacementDraw.material,
        replacementMaterials[0],
        'the replacement draw must use the newly realized material',
      );
      assert.notEqual(
        replacementDraw.material,
        acceptedDraw.material,
        'the retired material must not remain installed',
      );
      assert.equal(disposalEvents, 1, `the retired ${resource} must be disposed exactly once`);
      if (resource === 'geometry') {
        assert.equal(group.visible, false, 'the geometry callback must mutate the accepted scope');
        assert.equal(replacementDraw.visible, false, 'callback traversal must update the candidate draw');
        scene.updateMatrixWorld(true);
        assert.equal(replacementDraw.visible, false, 'an unchanged later traversal must preserve candidate visibility');
      }
      assert.deepEqual(
        label.commitState(),
        { status: 'committed', revision: 2 },
        'core and Three must accept the same publication before surfacing cleanup failure',
      );
      assert.equal(label.error, disposalError, 'scene-owned error reporting retains the caller failure');

      const entry = {
        id: 0,
        batching: 'auto',
        color: '#ffffff',
        material: replacementMaterial,
        renderOrder: 3,
        text: label.text,
        visible: group.visible,
        x: 0,
      };
      const mounted = new Map([[entry.id, { group, label }]]);
      const cold = await createThreeTestHandle(subtest, config);
      const coldScene = new THREE.Scene();
      const coldMounted = new Map([[entry.id, mountRendererDifferentialEntry(cold, font, coldScene, entry)]]);
      const { group: coldGroup, label: coldLabel } = coldMounted.get(entry.id);
      coldScene.updateMatrixWorld(true);
      const assertMatchesCold = (message) =>
        assert.deepEqual(
          rendererDifferentialSnapshot(scene, undefined, [entry], mounted),
          rendererDifferentialSnapshot(coldScene, undefined, [entry], coldMounted),
          message,
        );
      assertMatchesCold('the accepted retirement publication must match a cold full preparation');

      label.position.set(23, -7, 0);
      coldLabel.position.copy(label.position);
      scene.updateMatrixWorld(true);
      coldScene.updateMatrixWorld(true);
      assertMatchesCold('later transforms must match a cold full preparation');
      assert.equal(label.error, disposalError, 'transform synchronization does not erase the attributed failure');

      group.visible = false;
      coldGroup.visible = false;
      scene.updateMatrixWorld(true);
      coldScene.updateMatrixWorld(true);
      assertMatchesCold('later visibility must match a cold full preparation');

      group.visible = true;
      coldGroup.visible = true;
      group.renderOrder = 17;
      coldGroup.renderOrder = 17;
      scene.updateMatrixWorld(true);
      coldScene.updateMatrixWorld(true);
      assert.equal(label.error, undefined, 'a later accepted publication clears the attributed cleanup error');
      assertMatchesCold('the recovered publication must match a cold full preparation');

      coldLabel.dispose();
      coldGroup.dispose();
      label.dispose();
      group.dispose();
    });
  }
});

test('irreversible Three callback windows preserve primary notification precedence', async (t) => {
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());

  for (const { callbackWindow, primaryFailure } of [
    { callbackWindow: 'material disposal', primaryFailure: undefined },
    { callbackWindow: 'geometry disposal', primaryFailure: null },
    { callbackWindow: 'draw addition', primaryFailure: 0 },
    { callbackWindow: 'draw removal', primaryFailure: new Error('primary draw removal failure') },
  ]) {
    await t.test(callbackWindow, async (subtest) => {
      const three = await createThreeTestHandle(subtest, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
      const scene = new THREE.Scene();
      const group = three.createTextGroup();
      const secondaryFailure = new Error(`secondary ${callbackWindow} transform failure`);
      let transformMustFail = false;
      let failingTransformUpdates = 0;
      let successfulTransformUpdates = 0;
      class ThrowingTransformParent extends THREE.Object3D {
        updateWorldMatrix(updateParents, updateChildren) {
          if (transformMustFail) {
            failingTransformUpdates += 1;
            throw secondaryFailure;
          }
          successfulTransformUpdates += 1;
          return super.updateWorldMatrix(updateParents, updateChildren);
        }
      }
      const throwingParent = new ThrowingTransformParent();
      group.add(throwingParent);
      let runRetirementCallback = () => {};
      const acceptedMaterial = defineTextMaterial((context) => {
        const material = context.createDefaultMaterial();
        if (callbackWindow === 'material disposal') {
          material.addEventListener('dispose', () => runRetirementCallback());
        }
        return material;
      });
      const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
      const label = three.createText({ font, material: acceptedMaterial, text: 'A' });
      group.add(label);
      scene.add(group);
      scene.updateMatrixWorld(true);
      const acceptedDraw = rootDraws(scene)[0];
      assert.ok(acceptedDraw);
      const publicationObject = acceptedDraw.parent;
      assert.ok(publicationObject);

      scene.add(group);
      scene.updateMatrixWorld(true);
      assert.ok(
        scene.children.indexOf(publicationObject) < scene.children.indexOf(group),
        'the publication object must traverse before the authored group',
      );

      const notifications = [];
      label.onError = (error) => notifications.push(error);
      let callbackInvocations = 0;
      runRetirementCallback = () => {
        callbackInvocations += 1;
        throwingParent.add(label);
        transformMustFail = true;
        scene.updateMatrixWorld(true);
        throw primaryFailure;
      };
      let publicationEvent;
      if (callbackWindow === 'geometry disposal') {
        acceptedDraw.geometry.addEventListener('dispose', runRetirementCallback);
      } else if (callbackWindow === 'draw addition') {
        publicationEvent = 'childadded';
        publicationObject.addEventListener(publicationEvent, runRetirementCallback);
      } else if (callbackWindow === 'draw removal') {
        publicationEvent = 'childremoved';
        publicationObject.addEventListener(publicationEvent, runRetirementCallback);
      }

      label.set({ material: replacementMaterial, text: `replacement for ${callbackWindow}` });
      const publicationThrow = captureThrown(() => glyph.shape());
      if (publicationEvent !== undefined) {
        publicationObject.removeEventListener(publicationEvent, runRetirementCallback);
      }
      assert.equal(publicationThrow.present, true);
      assert.ok(Object.is(publicationThrow.error, primaryFailure));
      assert.equal(callbackInvocations, 1, 'the selected irreversible callback window must run once');
      assert.ok(failingTransformUpdates > 0, 'callback traversal must enter the throwing updateWorldMatrix override');
      assert.equal(notifications.length, 1);
      assert.ok(Object.is(notifications[0], primaryFailure), 'only the raw primary failure may be notified');
      assert.deepEqual(label.commitState(), { status: 'committed', revision: 1 });
      assert.ok(Object.is(label.error, primaryFailure));
      assert.equal(rootDraws(scene).length, 1, 'the accepted candidate draw must remain published');

      const successfulUpdatesBeforeRecovery = successfulTransformUpdates;
      transformMustFail = false;
      label.text = `recovered ${callbackWindow}`;
      glyph.shape();
      scene.updateMatrixWorld(true);
      assert.ok(successfulTransformUpdates > successfulUpdatesBeforeRecovery);
      assert.deepEqual(label.commitState(), { status: 'committed', revision: 2 });
      assert.equal(label.error, undefined);
      assert.equal(notifications.length, 1);

      label.dispose();
      group.dispose();
    });
  }
});

test('a traversal failure deferred during successful retirement commit surfaces through accepted settlement', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const deferredFailure = new Error('deferred in-commit transform failure');
  let transformMustFail = false;
  let failingTransformUpdates = 0;
  let successfulTransformUpdates = 0;
  class ThrowingTransformParent extends THREE.Object3D {
    updateWorldMatrix(updateParents, updateChildren) {
      if (transformMustFail) {
        failingTransformUpdates += 1;
        throw deferredFailure;
      }
      successfulTransformUpdates += 1;
      return super.updateWorldMatrix(updateParents, updateChildren);
    }
  }
  const throwingParent = new ThrowingTransformParent();
  group.add(throwingParent);
  let runRetirementCallback = () => {};
  const retiringMaterial = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.addEventListener('dispose', () => runRetirementCallback());
    return material;
  });
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const label = three.createText({ font, material: retiringMaterial, text: 'A' });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld(true);
  const publicationObject = rootDraws(scene)[0]?.parent;
  assert.ok(publicationObject);
  scene.add(group);
  scene.updateMatrixWorld(true);

  const notifications = [];
  label.onError = (error) => notifications.push(error);
  let callbackInvocations = 0;
  runRetirementCallback = () => {
    callbackInvocations += 1;
    throwingParent.add(label);
    transformMustFail = true;
    scene.updateMatrixWorld(true);
  };
  label.set({ material: replacementMaterial, text: 'accepted despite deferred traversal failure' });
  const publicationThrow = captureThrown(() => glyph.shape());
  assert.deepEqual(publicationThrow, { present: true, error: deferredFailure });
  assert.equal(callbackInvocations, 1);
  assert.ok(failingTransformUpdates > 0, 'the successful disposer must encounter the deferred transform failure');
  assert.deepEqual(notifications, [deferredFailure]);
  assert.deepEqual(label.commitState(), { status: 'committed', revision: 1 });
  assert.equal(label.error, deferredFailure);
  assert.equal(rootDraws(scene).length, 1, 'the renderer commit itself must remain accepted');

  const successfulUpdatesBeforeRecovery = successfulTransformUpdates;
  transformMustFail = false;
  label.text = 'deferred traversal recovery';
  glyph.shape();
  scene.updateMatrixWorld(true);
  assert.ok(successfulTransformUpdates > successfulUpdatesBeforeRecovery);
  assert.deepEqual(label.commitState(), { status: 'committed', revision: 2 });
  assert.equal(label.error, undefined);
  assert.deepEqual(notifications, [deferredFailure]);

  label.dispose();
  group.dispose();
  font.dispose();
});

test('retirement callbacks reject reentrant Text and root disposal before lifecycle mutation', async (t) => {
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());

  for (const { resource, target } of [
    { resource: 'material', target: 'Text' },
    { resource: 'geometry', target: 'root' },
  ]) {
    await t.test(`${resource} disposes ${target}`, async (subtest) => {
      const three = await createThreeTestHandle(subtest, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
      const root = three(`reentrant-${resource}`);
      const scene = new THREE.Scene();
      const group = root.createTextGroup();
      let label;
      let disposalAttempt = { present: false };
      const retiringMaterial = defineTextMaterial((context) => {
        const material = context.createDefaultMaterial();
        if (resource === 'material') {
          material.addEventListener('dispose', () => {
            try {
              if (target === 'Text') label.dispose();
              else root.dispose();
            } catch (error) {
              disposalAttempt = { present: true, error };
              throw error;
            }
            throw new Error(`reentrant ${target} disposal unexpectedly succeeded`);
          });
        }
        return material;
      });
      const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
      label = root.createText({ font, material: retiringMaterial, text: 'A' });
      group.add(label);
      scene.add(group);
      scene.updateMatrixWorld(true);
      const acceptedDraw = rootDraws(scene, `reentrant-${resource}`)[0];
      assert.ok(acceptedDraw);
      if (resource === 'geometry') {
        acceptedDraw.geometry.addEventListener('dispose', () => {
          try {
            if (target === 'Text') label.dispose();
            else root.dispose();
          } catch (error) {
            disposalAttempt = { present: true, error };
            throw error;
          }
          throw new Error(`reentrant ${target} disposal unexpectedly succeeded`);
        });
      }

      label.material = replacementMaterial;
      label.text = 'replacement text forces retained storage growth';
      const publicationThrow = captureThrown(() => glyph.shape());
      assert.equal(disposalAttempt.present, true, 'the nested disposal call must reject synchronously');
      assert.equal(publicationThrow.present, true);
      assert.equal(publicationThrow.error, disposalAttempt.error, 'the exact disposal rejection must surface');
      assert.match(String(disposalAttempt.error), /borrowed render plan is active/u);
      assert.equal(root.disposed, false, 'rejected disposal must leave the root live');
      assert.equal(label.disposed, false, 'rejected disposal must leave the Text live');
      assert.equal(root.textCount, 1, 'rejected disposal must preserve root membership');
      assert.equal(label.bound, true, 'rejected disposal must preserve the Text binding');
      assert.deepEqual(label.commitState(), { status: 'committed', revision: 2 });
      assert.notEqual(rootDraws(scene, `reentrant-${resource}`)[0], acceptedDraw);

      const rejectionError = new Error(`later ${resource} realization rejection`);
      const rejectingMaterial = defineTextMaterial(() => {
        throw rejectionError;
      });
      label.material = rejectingMaterial;
      const rejectionThrow = captureThrown(() => glyph.shape());
      assert.deepEqual(rejectionThrow, { present: true, error: rejectionError });
      assert.deepEqual(label.commitState(), { status: 'failed', error: rejectionError });

      label.material = replacementMaterial;
      glyph.shape();
      assert.deepEqual(label.commitState(), { status: 'committed', revision: 4 });
      assert.equal(label.error, undefined);

      label.dispose();
      group.dispose();
      root.dispose();
    });
  }
});

test('one root cannot unregister another root during borrowed retirement', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const left = three('reentrant-left');
  const right = three('reentrant-right');
  const leftScene = new THREE.Scene();
  const rightScene = new THREE.Scene();
  const leftGroup = left.createTextGroup();
  const rightGroup = right.createTextGroup();
  let disposalAttempt = { present: false };
  const retiringMaterial = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.addEventListener('dispose', () => {
      try {
        right.dispose();
      } catch (error) {
        disposalAttempt = { present: true, error };
        throw error;
      }
      throw new Error('cross-root disposal unexpectedly succeeded');
    });
    return material;
  });
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const leftLabel = left.createText({ font, material: retiringMaterial, text: 'left' });
  const rightLabel = right.createText({ font, text: 'right' });
  leftGroup.add(leftLabel);
  rightGroup.add(rightLabel);
  leftScene.add(leftGroup);
  rightScene.add(rightGroup);
  leftScene.updateMatrixWorld(true);
  rightScene.updateMatrixWorld(true);

  leftLabel.material = replacementMaterial;
  leftLabel.text = 'left replacement grows';
  rightLabel.text = 'right accepted in the same batch';
  const publicationThrow = captureThrown(() => glyph.shape());
  assert.equal(disposalAttempt.present, true);
  assert.equal(publicationThrow.error, disposalAttempt.error);
  assert.equal(right.disposed, false, 'the other root must remain registered and live');
  assert.equal(right.textCount, 1);
  assert.equal(rightLabel.disposed, false);
  assert.equal(rightLabel.bound, true);
  assert.deepEqual(leftLabel.commitState(), { status: 'committed', revision: 2 });
  assert.deepEqual(rightLabel.commitState(), { status: 'committed', revision: 1 });

  rightLabel.text = 'right still publishes later';
  glyph.shape();
  assert.deepEqual(rightLabel.commitState(), { status: 'committed', revision: 2 });

  leftLabel.dispose();
  rightLabel.dispose();
  leftGroup.dispose();
  rightGroup.dispose();
  left.dispose();
  right.dispose();
  font.dispose();
});

test('accepted cleanup attribution snapshots participants before guarded onError callbacks', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const primaryError = new Error('primary retirement failure');
  const notificationError = new Error('secondary onError failure');
  const retiringMaterial = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.addEventListener('dispose', () => {
      throw primaryError;
    });
    return material;
  });
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const first = three.createText({ font, material: retiringMaterial, text: 'first' });
  const second = three.createText({ font, material: retiringMaterial, text: 'second' });
  const notifications = [];
  first.onError = (error) => {
    notifications.push(['first', error]);
    scene.add(second);
    throw notificationError;
  };
  second.onError = (error) => notifications.push(['second', error]);
  group.onError = (error) => notifications.push(['group', error]);
  group.add(first, second);
  scene.add(group);
  scene.updateMatrixWorld(true);

  first.material = replacementMaterial;
  second.material = replacementMaterial;
  first.text = 'first replacement grows retained storage';
  second.text = 'second replacement grows retained storage';
  const publicationThrow = captureThrown(() => glyph.shape());
  assert.deepEqual(publicationThrow, { present: true, error: primaryError });
  assert.equal(second.parent, scene, 'the first callback may reparent after ownership was snapshotted');
  assert.deepEqual(first.commitState(), { status: 'committed', revision: 2 });
  assert.deepEqual(second.commitState(), { status: 'committed', revision: 2 });
  assert.equal(first.error, primaryError);
  assert.equal(second.error, primaryError);
  assert.equal(group.error, primaryError, 'the original group must retain attribution after reparenting');
  assert.deepEqual(
    notifications,
    [
      ['first', primaryError],
      ['second', primaryError],
      ['group', primaryError],
    ],
    'one throwing notification cannot interrupt or duplicate the attribution pass',
  );

  first.onError = undefined;
  second.onError = undefined;
  group.onError = undefined;
  const rejectionError = new Error('ordinary renderer rejection after accepted cleanup failure');
  const rejectingMaterial = defineTextMaterial(() => {
    throw rejectionError;
  });
  first.material = rejectingMaterial;
  const rejectionThrow = captureThrown(() => glyph.shape());
  assert.deepEqual(rejectionThrow, { present: true, error: rejectionError });
  assert.deepEqual(first.commitState(), { status: 'failed', error: rejectionError });
  assert.deepEqual(second.commitState(), { status: 'failed', error: rejectionError });

  first.material = replacementMaterial;
  glyph.shape();
  assert.deepEqual(first.commitState(), { status: 'committed', revision: 4 });
  assert.deepEqual(second.commitState(), { status: 'committed', revision: 2 });
  assert.equal(first.error, undefined);
  assert.equal(second.error, undefined);

  first.dispose();
  second.dispose();
  group.dispose();
  font.dispose();
});

test('accepted cleanup preserves arbitrary thrown values through notification and shape', async (t) => {
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());

  for (const [name, thrownValue] of [
    ['undefined', undefined],
    ['null', null],
    ['zero', 0],
  ]) {
    await t.test(name, async (subtest) => {
      const three = await createThreeTestHandle(subtest, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
      const scene = new THREE.Scene();
      const group = three.createTextGroup();
      const retiringMaterial = defineTextMaterial((context) => {
        const material = context.createDefaultMaterial();
        material.addEventListener('dispose', () => {
          throw thrownValue;
        });
        return material;
      });
      const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
      const label = three.createText({ font, material: retiringMaterial, text: name });
      const notifications = [];
      label.onError = (error) => notifications.push(error);
      group.add(label);
      scene.add(group);
      scene.updateMatrixWorld(true);

      label.material = replacementMaterial;
      label.text = `${name} replacement grows retained storage`;
      const cleanupThrow = captureThrown(() => glyph.shape());
      assert.equal(cleanupThrow.present, true);
      assert.ok(Object.is(cleanupThrow.error, thrownValue), 'glyph.shape() must throw the exact callback value');
      assert.equal(notifications.length, 1);
      assert.ok(Object.is(notifications[0], thrownValue), 'onError must receive the exact callback value');
      assert.deepEqual(label.commitState(), { status: 'committed', revision: 2 });
      if (thrownValue === undefined) {
        assert.equal(label.error, undefined, 'the public getter reserves undefined for its historical no-error shape');
      } else {
        assert.ok(Object.is(label.error, thrownValue));
      }

      const rejectionError = new Error(`rejection after ${name}`);
      const rejectingMaterial = defineTextMaterial(() => {
        throw rejectionError;
      });
      label.onError = undefined;
      label.material = rejectingMaterial;
      const rejectionThrow = captureThrown(() => glyph.shape());
      assert.deepEqual(rejectionThrow, { present: true, error: rejectionError });
      assert.deepEqual(label.commitState(), { status: 'failed', error: rejectionError });

      label.material = replacementMaterial;
      glyph.shape();
      assert.deepEqual(label.commitState(), { status: 'committed', revision: 4 });
      assert.equal(label.error, undefined);

      label.dispose();
      group.dispose();
    });
  }
});

test('two-root cleanup failures settle every root despite a throwing notification', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const roots = [three('arbitrary-left'), three('arbitrary-right')];
  const scenes = [new THREE.Scene(), new THREE.Scene()];
  const values = [undefined, 0];
  const notifications = [];
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const groups = [];
  const labels = [];
  for (let index = 0; index < roots.length; index += 1) {
    const value = values[index];
    const retiringMaterial = defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      material.addEventListener('dispose', () => {
        throw value;
      });
      return material;
    });
    const group = roots[index].createTextGroup();
    const label = roots[index].createText({ font, material: retiringMaterial, text: String(index) });
    label.onError = (error) => {
      notifications.push([index, error]);
      if (index === 0) throw new Error('secondary two-root notification failure');
    };
    group.add(label);
    scenes[index].add(group);
    scenes[index].updateMatrixWorld(true);
    groups.push(group);
    labels.push(label);
  }

  for (const [index, label] of labels.entries()) {
    label.material = replacementMaterial;
    label.text = `replacement ${String(index)} grows retained storage`;
  }
  const cleanupThrow = captureThrown(() => glyph.shape());
  assert.equal(cleanupThrow.present, true);
  assert.ok(cleanupThrow.error instanceof AggregateError);
  assert.equal(cleanupThrow.error.errors.length, 2);
  assert.ok(Object.is(cleanupThrow.error.errors[0], undefined));
  assert.ok(Object.is(cleanupThrow.error.errors[1], 0));
  assert.deepEqual(notifications, [
    [0, undefined],
    [1, 0],
  ]);
  assert.deepEqual(labels[0].commitState(), { status: 'committed', revision: 2 });
  assert.deepEqual(labels[1].commitState(), { status: 'committed', revision: 2 });

  for (const label of labels) label.dispose();
  for (const group of groups) group.dispose();
  for (const root of roots) root.dispose();
  font.dispose();
});

test('accepted retirement failures outrank reentrant notification traversal and transform synchronization', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const thrownValues = [undefined, null, 0];
  const roots = thrownValues.map((_, index) => three(`transform-precedence-${String(index)}`));
  const initialScenes = roots.map(() => new THREE.Scene());
  const movedScene = new THREE.Scene();
  const groups = roots.map((root) => root.createTextGroup());
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const transformFailure = new Error('secondary initial transform synchronization failure');
  let transformMustFail = true;
  let successfulTransformUpdates = 0;
  class ThrowingTransformParent extends THREE.Object3D {
    updateWorldMatrix(updateParents, updateChildren) {
      if (transformMustFail) throw transformFailure;
      successfulTransformUpdates += 1;
      return super.updateWorldMatrix(updateParents, updateChildren);
    }
  }
  const throwingParent = new ThrowingTransformParent();
  movedScene.add(throwingParent);
  const notifications = [];
  let notificationTraversalStarted = false;
  let notificationTraversalCompleted = false;
  const labels = thrownValues.map((thrownValue, index) => {
    const retiringMaterial = defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      material.addEventListener('dispose', () => {
        throw thrownValue;
      });
      return material;
    });
    const label = roots[index].createText({ font, material: retiringMaterial, text: String(index) });
    label.onError = (error) => {
      notifications.push([index, error]);
      if (index === 0 && !notificationTraversalStarted) {
        notificationTraversalStarted = true;
        throwingParent.add(label);
        movedScene.updateMatrixWorld(true);
        notificationTraversalCompleted = true;
      }
    };
    groups[index].add(label);
    return label;
  });
  for (const [index, scene] of initialScenes.entries()) {
    scene.add(groups[index]);
    scene.updateMatrixWorld(true);
  }

  movedScene.add(groups[0]);
  for (const [index, label] of labels.entries()) {
    label.material = replacementMaterial;
    label.text = `transform precedence replacement ${String(index)} grows retained storage`;
  }
  const cleanupThrow = captureThrown(() => glyph.shape());
  assert.equal(cleanupThrow.present, true);
  assert.ok(cleanupThrow.error instanceof AggregateError);
  assert.equal(cleanupThrow.error.errors.length, 3);
  assert.ok(Object.is(cleanupThrow.error.errors[0], undefined));
  assert.ok(Object.is(cleanupThrow.error.errors[1], null));
  assert.ok(Object.is(cleanupThrow.error.errors[2], 0));
  assert.equal(cleanupThrow.error.errors.includes(transformFailure), false);
  assert.deepEqual(notifications, [
    [0, undefined],
    [1, null],
    [2, 0],
  ]);
  assert.equal(notificationTraversalCompleted, true, 'the first public onError callback must traverse the moved scene');
  assert.equal(labels[0].parent, throwingParent, 'the first notification must install the throwing parent');
  for (const [index, label] of labels.entries()) {
    assert.deepEqual(label.commitState(), { status: 'committed', revision: 2 });
    assert.ok(Object.is(label.error, thrownValues[index]), 'Text must retain its exact accepted retirement value');
    assert.ok(Object.is(groups[index].error, thrownValues[index]), 'TextGroup must retain the same attributed value');
  }
  for (const [index, root] of roots.entries()) {
    assert.equal(root.disposed, false);
    assert.equal(root.textCount, 1);
    assert.equal(labels[index].disposed, false);
    assert.equal(labels[index].bound, true);
  }

  transformMustFail = false;
  for (const [index, label] of labels.entries()) {
    label.text = `transform precedence recovery ${String(index)}`;
  }
  glyph.shape();
  assert.ok(successfulTransformUpdates > 0, 'the pending transform synchronization must recover deterministically');
  for (let index = 0; index < labels.length; index += 1) {
    assert.deepEqual(labels[index].commitState(), { status: 'committed', revision: 3 });
    assert.equal(labels[index].error, undefined);
    assert.equal(groups[index].error, undefined);
  }
  assert.deepEqual(notifications, [
    [0, undefined],
    [1, null],
    [2, 0],
  ]);

  for (const label of labels) label.dispose();
  for (const group of groups) group.dispose();
  for (const root of roots) root.dispose();
  font.dispose();
});

test('a captured later root defers callback traversal until its own retirement outcome is known', async (t) => {
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());

  for (const laterOutcome of [
    { name: 'primary zero', present: true, error: 0 },
    { name: 'no primary', present: false },
  ]) {
    await t.test(laterOutcome.name, async (subtest) => {
      const three = await createThreeTestHandle(subtest, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
      const rootNames = [`full-cycle-left-${laterOutcome.name}`, `full-cycle-right-${laterOutcome.name}`];
      const roots = rootNames.map((name) => three(name));
      const scenes = roots.map(() => new THREE.Scene());
      const groups = roots.map((root) => root.createTextGroup());
      const primaryFailure = new Error(`left retirement failure before ${laterOutcome.name}`);
      const secondaryFailure = new Error(`right pre-commit traversal failure before ${laterOutcome.name}`);
      let transformMustFail = false;
      let failingTransformUpdates = 0;
      let laterCommitCallbackStarted = false;
      let traversalRanBeforeLaterCommitCallback = false;
      class ThrowingTransformParent extends THREE.Object3D {
        updateWorldMatrix(updateParents, updateChildren) {
          if (transformMustFail) {
            transformMustFail = false;
            failingTransformUpdates += 1;
            traversalRanBeforeLaterCommitCallback ||= !laterCommitCallbackStarted;
            throw secondaryFailure;
          }
          return super.updateWorldMatrix(updateParents, updateChildren);
        }
      }
      const throwingParent = new ThrowingTransformParent();
      groups[1].add(throwingParent);
      let runEarlierRetirement = () => {};
      const earlierMaterial = defineTextMaterial((context) => {
        const material = context.createDefaultMaterial();
        material.addEventListener('dispose', () => runEarlierRetirement());
        return material;
      });
      const laterMaterial = defineTextMaterial((context) => {
        const material = context.createDefaultMaterial();
        material.addEventListener('dispose', () => {
          if (laterCommitCallbackStarted) return;
          laterCommitCallbackStarted = true;
          if (laterOutcome.present) throw laterOutcome.error;
        });
        return material;
      });
      const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
      const labels = [
        roots[0].createText({ font, material: earlierMaterial, text: 'A' }),
        roots[1].createText({ font, material: laterMaterial, text: 'B' }),
      ];
      groups[0].add(labels[0]);
      groups[1].add(labels[1]);
      scenes[0].add(groups[0]);
      scenes[1].add(groups[1]);
      for (const scene of scenes) scene.updateMatrixWorld(true);
      const laterPublicationObject = rootDraws(scenes[1], rootNames[1])[0]?.parent;
      assert.ok(laterPublicationObject);
      scenes[1].add(groups[1]);
      scenes[1].updateMatrixWorld(true);
      assert.ok(
        scenes[1].children.indexOf(laterPublicationObject) < scenes[1].children.indexOf(groups[1]),
        'the later publication object must traverse before its authored group',
      );

      const laterNotifications = [];
      labels[1].onError = (error) => laterNotifications.push(error);
      let earlierCallbackInvocations = 0;
      runEarlierRetirement = () => {
        earlierCallbackInvocations += 1;
        throwingParent.add(labels[1]);
        transformMustFail = true;
        scenes[1].updateMatrixWorld(true);
        throw primaryFailure;
      };
      labels[0].set({
        material: replacementMaterial,
        text: 'candidate 0 forces retained storage growth for retirement',
      });
      labels[1].set({
        material: replacementMaterial,
        text: 'candidate 1 forces retained storage growth for retirement',
      });

      const publicationThrow = captureThrown(() => glyph.shape());
      assert.equal(earlierCallbackInvocations, 1, 'the earlier material retirement callback must run once');
      assert.ok(failingTransformUpdates > 0, 'the callback must enter the later root throwing transform override');
      assert.equal(
        traversalRanBeforeLaterCommitCallback,
        true,
        'the later transform failure must precede its renderer commit callback',
      );
      assert.equal(publicationThrow.present, true);
      assert.ok(publicationThrow.error instanceof AggregateError);
      const expectedLaterFailure = laterOutcome.present ? laterOutcome.error : secondaryFailure;
      assert.deepEqual(publicationThrow.error.errors, [primaryFailure, expectedLaterFailure]);
      assert.equal(laterCommitCallbackStarted, true, 'the later renderer commit must reach its public callback');
      assert.equal(laterNotifications.length, 1, 'the later root must notify only its final owned failure');
      assert.ok(Object.is(laterNotifications[0], expectedLaterFailure));
      assert.deepEqual(labels[0].commitState(), { status: 'committed', revision: 1 });
      assert.deepEqual(labels[1].commitState(), { status: 'committed', revision: 1 });
      assert.ok(Object.is(labels[1].error, expectedLaterFailure));
      assert.ok(Object.is(groups[1].error, expectedLaterFailure));

      transformMustFail = false;
      labels[1].text = `recovered ${laterOutcome.name}`;
      glyph.shape();
      scenes[1].updateMatrixWorld(true);
      assert.deepEqual(labels[1].commitState(), { status: 'committed', revision: 2 });
      assert.equal(labels[1].error, undefined);
      assert.equal(groups[1].error, undefined);
      assert.deepEqual(laterNotifications, [expectedLaterFailure]);

      for (const label of labels) label.dispose();
      for (const group of groups) group.dispose();
      for (const root of roots) root.dispose();
    });
  }
});

test('a committed later root defers onError traversal until its accepted hook', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const rootNames = ['post-commit-left', 'post-commit-right'];
  const roots = rootNames.map((name) => three(name));
  const scenes = roots.map(() => new THREE.Scene());
  const groups = roots.map((root) => root.createTextGroup());
  const primaryFailure = new Error('earlier accepted retirement failure');
  const secondaryFailure = new Error('later post-commit traversal failure');
  let transformMustFail = false;
  let failingTransformUpdates = 0;
  let laterCommitCallbackCompleted = false;
  let traversalObservedLaterCommit = false;
  class ThrowingTransformParent extends THREE.Object3D {
    updateWorldMatrix(updateParents, updateChildren) {
      if (transformMustFail) {
        failingTransformUpdates += 1;
        traversalObservedLaterCommit ||= laterCommitCallbackCompleted;
        throw secondaryFailure;
      }
      return super.updateWorldMatrix(updateParents, updateChildren);
    }
  }
  const throwingParent = new ThrowingTransformParent();
  groups[1].add(throwingParent);
  const earlierMaterial = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.addEventListener('dispose', () => {
      throw primaryFailure;
    });
    return material;
  });
  const laterMaterial = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.addEventListener('dispose', () => {
      laterCommitCallbackCompleted = true;
    });
    return material;
  });
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const labels = [
    roots[0].createText({ font, material: earlierMaterial, text: 'A' }),
    roots[1].createText({ font, material: laterMaterial, text: 'B' }),
  ];
  groups[0].add(labels[0]);
  groups[1].add(labels[1]);
  scenes[0].add(groups[0]);
  scenes[1].add(groups[1]);
  for (const scene of scenes) scene.updateMatrixWorld(true);
  const laterPublicationObject = rootDraws(scenes[1], rootNames[1])[0]?.parent;
  assert.ok(laterPublicationObject);
  scenes[1].add(groups[1]);
  scenes[1].updateMatrixWorld(true);

  const laterNotifications = [];
  labels[0].onError = () => {
    throwingParent.add(labels[1]);
    transformMustFail = true;
    scenes[1].updateMatrixWorld(true);
  };
  labels[1].onError = (error) => laterNotifications.push(error);
  labels[0].set({
    material: replacementMaterial,
    text: 'post-commit candidate 0 forces retained storage growth for retirement',
  });
  labels[1].set({
    material: replacementMaterial,
    text: 'post-commit candidate 1 forces retained storage growth for retirement',
  });

  const publicationThrow = captureThrown(() => glyph.shape());
  assert.equal(
    laterCommitCallbackCompleted,
    true,
    'the later renderer commit must finish before the earlier onError hook',
  );
  assert.ok(failingTransformUpdates > 0, 'the earlier onError hook must enter the later throwing transform override');
  assert.equal(traversalObservedLaterCommit, true, 'the traversal must occur after the later renderer commit');
  assert.equal(publicationThrow.present, true);
  assert.ok(publicationThrow.error instanceof AggregateError);
  assert.deepEqual(publicationThrow.error.errors, [primaryFailure, secondaryFailure]);
  assert.deepEqual(laterNotifications, [secondaryFailure]);
  assert.deepEqual(labels[0].commitState(), { status: 'committed', revision: 1 });
  assert.deepEqual(labels[1].commitState(), { status: 'committed', revision: 1 });
  assert.equal(labels[1].error, secondaryFailure);
  assert.equal(groups[1].error, secondaryFailure);

  transformMustFail = false;
  labels[1].text = 'post-commit recovery';
  glyph.shape();
  scenes[1].updateMatrixWorld(true);
  assert.deepEqual(labels[1].commitState(), { status: 'committed', revision: 2 });
  assert.equal(labels[1].error, undefined);
  assert.equal(groups[1].error, undefined);
  assert.deepEqual(laterNotifications, [secondaryFailure]);

  for (const label of labels) label.dispose();
  for (const group of groups) group.dispose();
  for (const root of roots) root.dispose();
  font.dispose();
});

test('a later root keeps its prepared revision and primary retirement failure through cross-root traversal', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const rootNames = ['cross-root-left', 'cross-root-right'];
  const roots = rootNames.map((name) => three(name));
  const scenes = roots.map(() => new THREE.Scene());
  const groups = roots.map((root) => root.createTextGroup());
  const primaryFailures = [undefined, 0];
  const candidateText = 'candidate publication';
  const callbackText = 'callback update remains pending until the next shape';
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const transformFailure = new Error('secondary cross-root transform failure');
  let transformMustFail = false;
  let failedTransformUpdates = 0;
  let successfulTransformUpdates = 0;
  class ThrowingTransformParent extends THREE.Object3D {
    updateWorldMatrix(updateParents, updateChildren) {
      if (transformMustFail) {
        failedTransformUpdates += 1;
        throw transformFailure;
      }
      successfulTransformUpdates += 1;
      return super.updateWorldMatrix(updateParents, updateChildren);
    }
  }
  const throwingParent = new ThrowingTransformParent();
  groups[1].add(throwingParent);
  const labels = primaryFailures.map((primaryFailure, index) => {
    const retiringMaterial = defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      material.addEventListener('dispose', () => {
        throw primaryFailure;
      });
      return material;
    });
    const label = roots[index].createText({ font, material: retiringMaterial, text: `initial ${String(index)}` });
    groups[index].add(label);
    scenes[index].add(groups[index]);
    return label;
  });
  for (const scene of scenes) scene.updateMatrixWorld(true);
  scenes[1].add(groups[1]);
  scenes[1].updateMatrixWorld(true);

  const candidateEntry = {
    id: 0,
    batching: 'auto',
    color: '#ffffff',
    material: replacementMaterial,
    renderOrder: 0,
    text: candidateText,
    visible: true,
    x: 0,
  };
  const callbackEntry = { ...candidateEntry, text: callbackText };
  const coldCandidateName = 'cross-root-candidate-cold';
  const coldCandidate = three(coldCandidateName);
  const coldCandidateScene = new THREE.Scene();
  const coldCandidateMounted = new Map([
    [candidateEntry.id, mountRendererDifferentialEntry(coldCandidate, font, coldCandidateScene, candidateEntry)],
  ]);
  coldCandidateScene.updateMatrixWorld(true);
  const candidateSnapshot = rendererDifferentialSnapshot(
    coldCandidateScene,
    coldCandidateName,
    [candidateEntry],
    coldCandidateMounted,
  );
  const coldCallbackName = 'cross-root-callback-cold';
  const coldCallback = three(coldCallbackName);
  const coldCallbackScene = new THREE.Scene();
  const coldCallbackMounted = new Map([
    [callbackEntry.id, mountRendererDifferentialEntry(coldCallback, font, coldCallbackScene, callbackEntry)],
  ]);
  coldCallbackScene.updateMatrixWorld(true);
  const callbackSnapshot = rendererDifferentialSnapshot(
    coldCallbackScene,
    coldCallbackName,
    [callbackEntry],
    coldCallbackMounted,
  );
  assert.notDeepEqual(candidateSnapshot.draws, callbackSnapshot.draws, 'the cold renderer oracles must discriminate');

  const notifications = [];
  let callbackTraversalCompleted = false;
  labels[0].onError = (error) => {
    notifications.push([0, error]);
    labels[1].text = callbackText;
    throwingParent.add(labels[1]);
    transformMustFail = true;
    scenes[1].updateMatrixWorld(true);
    callbackTraversalCompleted = true;
  };
  labels[1].onError = (error) => notifications.push([1, error]);
  for (const label of labels) label.set({ material: replacementMaterial, text: candidateText });

  const publicationThrow = captureThrown(() => glyph.shape());
  assert.equal(publicationThrow.present, true);
  assert.ok(publicationThrow.error instanceof AggregateError);
  assert.equal(publicationThrow.error.errors.length, 2);
  assert.ok(Object.is(publicationThrow.error.errors[0], undefined));
  assert.ok(Object.is(publicationThrow.error.errors[1], 0));
  assert.equal(publicationThrow.error.errors.includes(transformFailure), false);
  assert.equal(callbackTraversalCompleted, true, 'the first root callback must traverse the later root');
  assert.ok(failedTransformUpdates > 0, 'the callback traversal must enter the throwing updateWorldMatrix override');
  assert.equal(labels[1].parent, throwingParent, 'the callback must install the throwing transform ancestor');
  assert.deepEqual(notifications, [
    [0, undefined],
    [1, 0],
  ]);
  assert.deepEqual(labels[0].commitState(), { status: 'committed', revision: 1 });
  assert.deepEqual(labels[1].commitState(), { status: 'pending' });
  for (const [index, label] of labels.entries()) {
    assert.ok(Object.is(label.error, primaryFailures[index]));
    assert.ok(Object.is(groups[index].error, primaryFailures[index]));
  }
  const acceptedDrawSnapshot = rendererDifferentialSnapshot(scenes[1], rootNames[1], [], new Map()).draws;
  assert.deepEqual(
    acceptedDrawSnapshot,
    candidateSnapshot.draws,
    'the later root renderer must retain the exact prepared candidate while its callback update stays pending',
  );
  assert.notDeepEqual(acceptedDrawSnapshot, callbackSnapshot.draws);

  const successfulUpdatesBeforeRecovery = successfulTransformUpdates;
  transformMustFail = false;
  glyph.shape();
  assert.deepEqual(labels[1].commitState(), { status: 'committed', revision: 2 });
  assert.equal(labels[1].error, undefined);
  assert.equal(groups[1].error, undefined);
  const recoveredSnapshot = rendererDifferentialSnapshot(
    scenes[1],
    rootNames[1],
    [callbackEntry],
    new Map([[callbackEntry.id, { group: groups[1], label: labels[1] }]]),
  );
  assert.deepEqual(
    recoveredSnapshot,
    callbackSnapshot,
    'the later callback update must recover to the full cold renderer',
  );
  assert.ok(
    successfulTransformUpdates > successfulUpdatesBeforeRecovery,
    'the guarded transform traversal must recover deterministically',
  );
  assert.deepEqual(notifications, [
    [0, undefined],
    [1, 0],
  ]);

  for (const label of labels) label.dispose();
  for (const group of groups) group.dispose();
  for (const root of roots) root.dispose();
  for (const { label, group } of coldCandidateMounted.values()) {
    label.dispose();
    group.dispose();
  }
  for (const { label, group } of coldCallbackMounted.values()) {
    label.dispose();
    group.dispose();
  }
  coldCandidate.dispose();
  coldCallback.dispose();
  font.dispose();
});

test('shape settlement rejects lifecycle disposal until every captured root consumes its failure', async (t) => {
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());

  for (const target of ['second root', 'handle']) {
    await t.test(target, async (subtest) => {
      const three = await createThreeTestHandle(subtest, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
      const roots = [three(`settlement-left-${target}`), three(`settlement-right-${target}`)];
      const scenes = [new THREE.Scene(), new THREE.Scene()];
      const groups = [];
      const labels = [];
      const thrownValues = [undefined, 0];
      const notifications = [];
      const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
      let disposalAttempt = { present: false };

      for (let index = 0; index < roots.length; index += 1) {
        const thrownValue = thrownValues[index];
        const retiringMaterial = defineTextMaterial((context) => {
          const material = context.createDefaultMaterial();
          material.addEventListener('dispose', () => {
            throw thrownValue;
          });
          return material;
        });
        const group = roots[index].createTextGroup();
        const label = roots[index].createText({ font, material: retiringMaterial, text: String(index) });
        label.onError = (error) => {
          notifications.push([index, error]);
          if (index !== 0) return;
          try {
            if (target === 'second root') roots[1].dispose();
            else three.dispose();
          } catch (disposalError) {
            disposalAttempt = { present: true, error: disposalError };
          }
        };
        group.add(label);
        scenes[index].add(group);
        scenes[index].updateMatrixWorld(true);
        groups.push(group);
        labels.push(label);
      }

      for (const [index, label] of labels.entries()) {
        label.material = replacementMaterial;
        label.text = `settlement replacement ${String(index)} grows retained storage`;
      }
      const cleanupThrow = captureThrown(() => glyph.shape());
      assert.equal(disposalAttempt.present, true, 'lifecycle mutation must reject during participant settlement');
      assert.match(String(disposalAttempt.error), /shape participants are settling/u);
      assert.equal(cleanupThrow.present, true);
      assert.ok(cleanupThrow.error instanceof AggregateError);
      assert.equal(cleanupThrow.error.errors.length, 2);
      assert.ok(Object.is(cleanupThrow.error.errors[0], undefined));
      assert.ok(Object.is(cleanupThrow.error.errors[1], 0));
      assert.deepEqual(notifications, [
        [0, undefined],
        [1, 0],
      ]);
      assert.equal(three.disposed, false);
      assert.equal(roots[0].disposed, false);
      assert.equal(roots[1].disposed, false);
      assert.deepEqual(labels[0].commitState(), { status: 'committed', revision: 2 });
      assert.deepEqual(labels[1].commitState(), { status: 'committed', revision: 2 });

      for (const label of labels) label.dispose();
      for (const group of groups) group.dispose();
      for (const root of roots) root.dispose();
      three.dispose();
      assert.equal(three.disposed, true, 'ordinary disposal succeeds after settlement releases the gate');
    });
  }
});

test('shape settlement rejects disposal of a detached unbound Text before local mutation', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const fontBytes = await readFile(fontUrl);
  const font = await loadFont({ baked: dataUrl(fontBytes) }, bitmap({ strikes: [16] }));
  const face = glyph.fontFace(new Blob([fontBytes], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  await face.bitmap.load();
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const retirementValue = undefined;
  const retiringMaterial = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.addEventListener('dispose', () => {
      throw retirementValue;
    });
    return material;
  });
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const active = three.createText({ font, material: retiringMaterial, text: 'active' });
  const detached = three.createText({ font: face.bitmap, text: 'detached' });
  let disposalAttempt = { present: false };
  active.onError = () => {
    disposalAttempt = captureThrown(() => detached.dispose());
  };
  group.add(active);
  scene.add(group);
  scene.updateMatrixWorld(true);
  assert.equal(detached.bound, false, 'the counterexample requires a registered Text with no publication entry');
  assert.equal(three.textCount, 2);

  active.material = replacementMaterial;
  active.text = 'active replacement grows retained storage';
  const cleanupThrow = captureThrown(() => glyph.shape());
  assert.equal(disposalAttempt.present, true, 'detached lifecycle mutation must use the settlement gate');
  assert.match(String(disposalAttempt.error), /shape participants are settling/u);
  assert.equal(detached.disposed, false, 'rejected disposal must not set the public disposed flag');
  assert.equal(detached.bound, false, 'rejected disposal must not create a publication entry');
  assert.equal(three.textCount, 2, 'rejected disposal must preserve root membership');
  assert.ok(detached.measure().glyphCount > 0, 'rejected disposal must preserve its owned font lease and reads');
  assert.equal(cleanupThrow.present, true);
  assert.ok(Object.is(cleanupThrow.error, retirementValue), 'the outer call must retain the raw thrown value');
  assert.deepEqual(active.commitState(), { status: 'committed', revision: 2 });

  detached.dispose();
  assert.equal(detached.disposed, true, 'ordinary disposal succeeds after settlement releases the gate');
  assert.equal(three.textCount, 1);
  active.dispose();
  group.dispose();
  face.dispose();
  font.dispose();
});

test('accepted group attribution follows the snapshotted owner until replacement or clear', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const primaryError = new Error('sole-member accepted retirement failure');
  const retiringMaterial = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.addEventListener('dispose', () => {
      throw primaryError;
    });
    return material;
  });
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const original = three.createText({ font, material: retiringMaterial, text: 'original' });
  const fresh = three.createText({ font, material: replacementMaterial, text: 'fresh' });
  const notifications = [];
  original.onError = (error) => {
    notifications.push(['original', error]);
    scene.add(original);
    group.add(fresh);
  };
  fresh.onError = (error) => notifications.push(['fresh', error]);
  group.onError = (error) => notifications.push(['group', error]);
  group.add(original);
  scene.add(group);
  scene.updateMatrixWorld(true);

  original.material = replacementMaterial;
  original.text = 'original replacement grows retained storage';
  const cleanupThrow = captureThrown(() => glyph.shape());
  assert.deepEqual(cleanupThrow, { present: true, error: primaryError });
  assert.equal(original.parent, scene);
  assert.equal(fresh.parent, group);
  fresh.measure();
  assert.equal(group.error, primaryError);
  assert.equal(fresh.error, primaryError);
  assert.deepEqual(fresh.commitState(), { status: 'pending' }, 'a new member must inherit accepted attribution');
  assert.deepEqual(notifications, [
    ['original', primaryError],
    ['group', primaryError],
  ]);

  scene.add(fresh);
  original.text = 'successful publication clears snapshotted ownership';
  glyph.shape();
  assert.equal(group.error, undefined, 'success clears the group retained by the error snapshot');
  assert.equal(original.error, undefined);
  assert.equal(fresh.error, undefined);
  assert.deepEqual(original.commitState(), { status: 'committed', revision: 3 });
  assert.deepEqual(fresh.commitState(), { status: 'committed', revision: 0 });

  original.onError = undefined;
  fresh.onError = undefined;
  group.onError = undefined;
  group.add(fresh);
  const rejectionError = new Error('ordinary rejection after accepted group attribution');
  fresh.material = defineTextMaterial(() => {
    throw rejectionError;
  });
  const rejectionThrow = captureThrown(() => glyph.shape());
  assert.deepEqual(rejectionThrow, { present: true, error: rejectionError });
  assert.deepEqual(original.commitState(), { status: 'failed', error: rejectionError });
  assert.deepEqual(fresh.commitState(), { status: 'failed', error: rejectionError });
  assert.equal(group.error, rejectionError);

  original.dispose();
  fresh.dispose();
  group.dispose();
  font.dispose();
});

test('disposing an attributed TextGroup releases root-owned error state', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 1, policy: 'grow' } }));
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const replacementMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
  const firstError = new Error('disposed group accepted retirement failure');
  const firstRetiringMaterial = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.addEventListener('dispose', () => {
      throw firstError;
    });
    return material;
  });
  const firstGroup = three.createTextGroup();
  const first = three.createText({ font, material: firstRetiringMaterial, text: 'first' });
  firstGroup.add(first);
  scene.add(firstGroup);
  scene.updateMatrixWorld(true);

  first.material = replacementMaterial;
  first.text = 'first replacement grows retained storage';
  assert.deepEqual(
    captureThrown(() => glyph.shape()),
    { present: true, error: firstError },
  );
  assert.equal(firstGroup.error, firstError);

  scene.remove(firstGroup);
  firstGroup.dispose();
  assert.equal(firstGroup.disposed, true);
  assert.equal(firstGroup.error, undefined, 'disposal clears the terminal group state and releases root ownership');
  let disposedGroupNotifications = 0;
  firstGroup.onError = () => {
    disposedGroupNotifications += 1;
  };
  scene.add(firstGroup);
  first.measure();

  const secondError = new Error('unrelated group preparation failure');
  const rejectingMaterial = defineTextMaterial(() => {
    throw secondError;
  });
  const secondGroup = three.createTextGroup();
  const second = three.createText({ font, material: replacementMaterial, text: 'second' });
  secondGroup.add(second);
  scene.add(secondGroup);
  scene.updateMatrixWorld(true);
  assert.deepEqual(second.commitState(), { status: 'committed', revision: 0 });

  second.material = rejectingMaterial;
  assert.deepEqual(
    captureThrown(() => glyph.shape()),
    { present: true, error: secondError },
  );
  assert.equal(secondGroup.error, secondError);
  assert.equal(firstGroup.error, undefined, 'a later attribution cannot mutate disposed group state');
  assert.equal(disposedGroupNotifications, 0, 'a disposed group cannot be reacquired for error notification');

  second.material = replacementMaterial;
  glyph.shape();
  assert.equal(secondGroup.error, undefined);
  assert.equal(firstGroup.error, undefined, 'a later clear cannot mutate disposed group state');
  assert.equal(disposedGroupNotifications, 0);

  first.dispose();
  second.dispose();
  secondGroup.dispose();
  font.dispose();
});

test('Three reflow patches only host placement while retaining raster geometry, draws, and materials', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  const materials = [];
  const material = defineTextMaterial((context) => {
    const created = context.createDefaultMaterial();
    materials.push(created);
    return created;
  });
  const scene = new THREE.Scene();
  const label = three.createText({
    font,
    material,
    text: 'alpha beta gamma delta epsilon zeta eta theta',
    constraints: { width: { mode: 'exact', size: 300 } },
  });
  scene.add(label);
  scene.updateMatrixWorld(true);
  const draw = rootDraws(scene)[0];
  assert.ok(draw);
  const origins = draw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id));
  const originalOrigins = origins.array.slice();
  const placementSlots = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.placementSlot.id));
  const originalPlacementSlots = placementSlots.array.slice();
  const originalY = [...label.glyphs().y];

  label.set({ constraints: { width: { mode: 'exact', size: 90 } } });
  scene.updateMatrixWorld(true);
  const reflowed = rootDraws(scene);
  assert.equal(reflowed.length, 1);
  assert.equal(reflowed[0], draw, 'same-capacity origin patches retain the realized draw');
  assert.equal(reflowed[0].material, materials[0], 'the material remains reusable across reflow');
  assert.equal(materials.length, 1, 'reflow does not realize a second material');
  assert.deepEqual(origins.array, originalOrigins, 'break changes preserve glyph-local raster geometry');
  assert.deepEqual(
    placementSlots.array,
    originalPlacementSlots,
    'break changes retain each glyph-to-segment assignment',
  );
  assert.notDeepEqual([...label.glyphs().y], originalY, 'the public positioned layout still moves between lines');

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
  const inspection = label.glyphs();
  assert.equal(new Set(inspection.glyphFontSlots).size, 2, 'the fallback paragraph must retain both resolved fonts');
  assert.ok(
    inspection.glyphFontSlots.every((slot) => slot < inspection.fontHandles.length),
    'every package-produced glyph font slot must resolve through the published font table',
  );
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
  const slugDraw = draws.find((draw) => draw.geometry.getAttribute(glyphAttribute(slugSchema.buffers.planeRect.id)));
  assert.ok(slugDraw);
  const slugVertex = compileNodeMaterial(slugDraw).vertex;
  const slugStorageBindings = slugVertex.match(/var<storage/g) ?? [];
  assert.ok(
    slugStorageBindings.length <= 8,
    `Slug needs ${String(slugStorageBindings.length)} WebGPU vertex storage buffers`,
  );

  const [detached] = label.split();
  scene.add(detached);
  label.visible = false;
  scene.updateMatrixWorld(true);
  const detachedDraws = detached.children.filter((child) => child.isMesh);
  assert.equal(detachedDraws.length, 2, 'the detached copy must preserve both renderer-program batches');
  const detachedSlugDraw = detachedDraws.find((draw) =>
    draw.geometry.getAttribute(glyphAttribute(slugSchema.buffers.planeRect.id)),
  );
  assert.ok(detachedSlugDraw);
  const detachedSlugVertex = compileNodeMaterial(detachedSlugDraw).vertex;
  const detachedSlugStorageDeclarations = detachedSlugVertex.match(/^.*var<storage.*$/gm) ?? [];
  assert.ok(
    detachedSlugStorageDeclarations.length <= 8,
    `detached Slug storage bindings:\n${detachedSlugStorageDeclarations.join('\n')}`,
  );
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

test('explicit line height follows the font-stack primary across fallback scripts', async (t) => {
  const three = await createThreeTestHandle(t);
  const fontDomain = createThreeFontDomain();
  const [primary, fallback] = await Promise.all([
    fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] })),
    fontDomain.loadFont({ baked: dataUrl(await readFile(amiriFontUrl)) }, bitmap({ strikes: [16] })),
  ]);
  const scene = new THREE.Scene();
  const label = three.createText({
    font: createFontStack(primary, fallback),
    style: { fontSize: 10, lineHeight: 0.92 },
    text: 'Latin',
  });
  scene.add(label);
  scene.updateMatrixWorld(true);

  const latin = label.measure().lines[0];
  label.text = 'مرحبا';
  scene.updateMatrixWorld(true);
  const arabic = label.measure().lines[0];

  assert.ok(latin !== undefined && arabic !== undefined);
  assert.ok(Math.abs(latin.lineHeight - 9.2) < 1e-4, 'lineHeight below 1 is authoritative');
  assert.ok(
    Math.abs(arabic.lineHeight - latin.lineHeight) < 1e-4,
    'fallback glyph metrics cannot change the authored line box',
  );

  label.dispose();
  primary.dispose();
  fallback.dispose();
  fontDomain.dispose();
});

test('one Text coalesces interleaved font spans without crossing decoration paint layers', async (t) => {
  const three = await createThreeTestHandle(t);
  const [latin, serif] = await Promise.all([
    loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] })),
    loadFont({ baked: dataUrl(await readFile(sourceSerifFontUrl)) }, bitmap({ strikes: [16] })),
  ]);
  const latinSpan = textSpan(latin);
  const serifSpan = textSpan(serif);
  const label = three.createText({
    font: latin,
    text: txt`${latinSpan`A`}${serifSpan`B`}${latinSpan`C`}`,
    style: { decoration: { underline: true, lineThrough: true } },
  });
  const scene = new THREE.Scene();
  scene.add(label);
  scene.updateMatrixWorld(true);

  const draws = rootDraws(scene);
  const depthKeys = draws.map((draw) => draw.userData.pmndrsGlyphDepthKey);
  assert.equal(
    depthKeys.filter((depth) => depth === 1).length,
    2,
    'the repeated Latin resource and intervening serif resource become one draw each',
  );
  assert.ok(depthKeys.indexOf(0) < depthKeys.indexOf(1), 'under decorations precede glyph draws');
  assert.ok(depthKeys.lastIndexOf(2) > depthKeys.lastIndexOf(1), 'over decorations follow glyph draws');

  label.dispose();
  latin.dispose();
  serif.dispose();
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
  const indices = draws[0].geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id));
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => indices.getX(start + index)),
    [1, 1, 2, 2],
  );
  const transforms = draws[0].geometry.getAttribute('_pmndrsGlyphTransforms');
  assert.equal(transforms.array[1 * 16 + 12], 2);
  assert.equal(transforms.array[2 * 16 + 12], 5);

  const initialLeftMeasurement = left.measure();
  const initialRightMeasurement = right.measure();
  assert.ok(initialLeftMeasurement);
  assert.ok(initialRightMeasurement);

  const pendingSibling = three.createText({ font, text: 'EF' });
  group.add(pendingSibling);
  instrumented.reset();
  assert.equal(
    left.measure(),
    initialLeftMeasurement,
    'a cached paragraph measurement must not reconcile unrelated pending siblings',
  );
  assert.equal(instrumented.crossings, 0, 'a cached paragraph measurement must remain local to its retained entry');
  group.remove(pendingSibling);
  pendingSibling.dispose();

  instrumented.reset();
  left.set({});
  assert.equal(left.measure(), initialLeftMeasurement, 'an empty update must preserve the cached measurement');
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 0, 'an empty update and cached measurement must not cross into Rust');

  instrumented.reset();
  const unchangedText = left.text;
  left.text = unchangedText;
  assert.equal(left.measure(), initialLeftMeasurement, 'an unchanged plain string must preserve cached measurement');
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 0, 'an unchanged plain string must not cross into Rust');

  instrumented.reset();
  const unchangedCommit = left.commitState();
  left.style = { ...left.style };
  left.layout = { ...left.layout };
  left.constraints = { ...left.constraints };
  assert.equal(
    left.measure(),
    initialLeftMeasurement,
    'equivalent normalized properties must preserve cached measurement',
  );
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 0, 'equivalent normalized properties must not cross into Rust');
  assert.deepEqual(left.commitState(), unchangedCommit, 'a semantic no-op must preserve the committed revision');

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
  assert.deepEqual(
    instrumented.latestRequestCounts(),
    {
      paragraph: 0,
      paragraphOrder: 0,
      text: 1,
      style: 0,
      constraint: 0,
      region: 0,
      exclusion: 0,
      inlineObject: 0,
    },
    'equal-length plain content publishes no unchanged retained state',
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
  instrumented.reset();
  const paintDraw = rootDraws(scene)[0];
  right.style = { ...right.style, color: '#00ff00' };
  scene.updateMatrixWorld();
  assert.equal(
    instrumented.latestRequestFlags & textShaperAbi.engine.frameFlags.compositingIndependent,
    textShaperAbi.engine.frameFlags.compositingIndependent,
    'the public paint assignment must retain the production independent-compositing policy',
  );
  assert.equal(instrumented.latestPlanCounts().draws, 0, 'the retained paint edit publishes no replacement draws');
  assert.equal(rootDraws(scene)[0], paintDraw, 'the renderer keeps the accepted independent-compositing draw');
  assert.deepEqual(
    instrumented.latestRequestCounts(),
    {
      paragraph: 0,
      paragraphOrder: 0,
      text: 0,
      style: 1,
      constraint: 0,
      region: 0,
      exclusion: 0,
      inlineObject: 0,
    },
    'paint-only style updates publish no unchanged lifecycle, text, or geometry',
  );

  instrumented.reset();
  right.style = { ...right.style, fontSize: 20 };
  scene.updateMatrixWorld();
  assert.equal(right.glyphs().glyphFontSizes[0], 20);
  assert.deepEqual(
    instrumented.latestRequestCounts(),
    {
      paragraph: 0,
      paragraphOrder: 0,
      text: 0,
      style: 1,
      constraint: 0,
      region: 0,
      exclusion: 0,
      inlineObject: 0,
    },
    'font-size updates publish only style while Rust derives shaping and layout invalidation',
  );

  const mutableWidth = { mode: 'exact', size: 120 };
  right.constraints = { ...right.constraints, width: mutableWidth };
  const widerMeasurement = right.measure();
  scene.updateMatrixWorld();
  mutableWidth.size = 60;
  instrumented.reset();
  right.constraints = { ...right.constraints, width: mutableWidth };
  const narrowerMeasurement = right.measure();
  scene.updateMatrixWorld();
  assert.notEqual(
    narrowerMeasurement.width,
    widerMeasurement.width,
    'reassigning a full field after mutating nested caller input must publish the new owned snapshot',
  );
  assert.deepEqual(
    instrumented.latestRequestCounts(),
    {
      paragraph: 0,
      paragraphOrder: 0,
      text: 0,
      style: 0,
      constraint: 1,
      region: 2,
      exclusion: 0,
      inlineObject: 0,
    },
    'a nested constraint change publishes geometry without unchanged semantic sections',
  );

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
  const [leftDetached] = left.split();
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

test('full assignments publish one replacement spanning distant character edits', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());
  const scene = new THREE.Scene();
  const text = three.createText({ font, text: 'alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet' });
  scene.add(text);
  scene.updateMatrixWorld();
  text.set({ text: 'Alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|JulieT' });
  scene.updateMatrixWorld();
  assert.equal(text.commitState().status, 'committed');
  assert.deepEqual(instrumentedGlyph.latestTextMutations(), [
    { start: 0, deleteCount: 62, insert: 'Alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|JulieT' },
  ]);
});

test('sibling measurement terminates after expansion sparse replacement and shrink assignments', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: dataUrl(await readFile(fontUrl)) }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const left = three.createText({ font, text: 'AB' });
  const right = three.createText({
    font,
    text: 'CD',
    constraints: { width: { mode: 'exact', size: 100 }, height: { mode: 'exact', size: 100 } },
    layout: { columns: { count: 2, gap: 10 } },
  });
  group.add(left, right);
  scene.add(group);
  scene.updateMatrixWorld(true);
  const initialRight = right.measure();
  const initialRightJson = JSON.stringify(initialRight);
  const publishLeft = (text) => {
    left.set({ text });
    scene.updateMatrixWorld(true);
    assert.equal(left.commitState().status, 'committed', `left must publish ${JSON.stringify(text)}`);
  };
  const original = 'alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet';
  const sparse = 'Alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|JulieT';

  for (const value of ['A', 'AB', 'AY', original, sparse, 'AY', 'AZ', '🌍', 'AB']) publishLeft(value);

  left.set({
    constraints: { width: { mode: 'exact', size: 100 } },
    layout: { wrap: 'word' },
  });
  const resized = left.measure();
  assert.equal(resized.glyphCount, 2, 'the resized changed paragraph must complete first');
  const measuredRight = right.measure();
  assert.equal(measuredRight.glyphCount, initialRight.glyphCount, 'the unchanged sibling retains its glyph count');
  assert.equal(JSON.stringify(measuredRight), initialRightJson, 'the unchanged sibling retains its scalar measurement');

  scene.updateMatrixWorld(true);
  assert.equal(left.commitState().status, 'committed');
  assert.equal(right.commitState().status, 'committed');
  assert.equal(group.error, undefined);
  assert.equal(rootDraws(scene).length, 1);

  group.dispose();
  left.dispose();
  right.dispose();
});

function instrumentNextGlyphEngine() {
  const abi = textShaperAbi;
  const originalInstantiate = WebAssembly.instantiate;
  let crossings = 0;
  let measureCrossings = 0;
  let latestRequest;
  let latestMeasurementRequest;
  let latestUpdateFlags = 0;
  let latestUpdateGeneration = 0;
  let latestSemanticByteLength = 0;
  let latestSemanticRecordCount = 0;
  let latestSemanticParagraphCount = 0;
  let latestPlanCounts;
  let borrowedGlyphReads = 0;
  let latestBatchCount = 0;
  let latestBatchRootIds = [];
  WebAssembly.instantiate = async (source, imports) => {
    const instance = await originalInstantiate(source, imports);
    const exports = { ...instance.exports };
    const update = exports[abi.functions.textUpdate];
    assert.equal(typeof update, 'function', 'instrumented shaper must export text_update');
    const captureResult = (resultPointer) => {
      const result = abi.layouts.engineResult;
      const semantic = abi.layouts.engineSemanticView;
      const memory = new DataView(exports.memory.buffer);
      latestUpdateFlags = memory.getUint32(resultPointer + result.flags, true);
      latestUpdateGeneration = memory.getUint32(resultPointer + result.publicationGeneration, true);
      latestSemanticRecordCount = memory.getUint32(resultPointer + result.semanticViewCount, true);
      latestSemanticByteLength = latestSemanticRecordCount * semantic.size;
      latestSemanticParagraphCount = 0;
      latestPlanCounts = {
        buffers: memory.getUint32(resultPointer + result.bufferCount, true),
        draws: memory.getUint32(resultPointer + result.drawCount, true),
        patches: memory.getUint32(resultPointer + result.patchCount, true),
        primitives: memory.getUint32(resultPointer + result.primitiveCount, true),
        resources: memory.getUint32(resultPointer + result.resourceCount, true),
        retirements: memory.getUint32(resultPointer + result.retirementCount, true),
      };
      const semanticOffset = memory.getUint32(resultPointer + result.semanticViewsOffset, true);
      for (let index = 0; index < latestSemanticRecordCount; index += 1) {
        const record = resultPointer + semanticOffset + index * semantic.size;
        const kind = memory.getUint16(record + semantic.kind, true);
        if (kind === abi.engine.semanticKinds.paragraphMeasurement) latestSemanticParagraphCount += 1;
      }
    };
    exports[abi.functions.textUpdate] = (...arguments_) => {
      crossings += 1;
      latestBatchCount = 1;
      const [, pointer, length] = arguments_;
      latestRequest = new Uint8Array(exports.memory.buffer, pointer, length).slice();
      const resultPointer = update(...arguments_);
      if (resultPointer !== 0) captureResult(resultPointer);
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
        captureResult(resultPointer);
      }
      return status;
    };
    const measure = exports[abi.functions.measureParagraph];
    if (typeof measure === 'function') {
      exports[abi.functions.measureParagraph] = (...arguments_) => {
        measureCrossings += 1;
        const [, pointer, length] = arguments_;
        latestMeasurementRequest = new Uint8Array(exports.memory.buffer, pointer, length).slice();
        const resultPointer = measure(...arguments_);
        if (resultPointer !== 0) captureResult(resultPointer);
        return resultPointer;
      };
    }
    const borrowGlyph = exports[abi.functions.borrowParagraphGlyph];
    exports[abi.functions.borrowParagraphGlyph] = (...arguments_) => {
      borrowedGlyphReads += 1;
      return borrowGlyph(...arguments_);
    };
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
    get latestRequestFlags() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      return new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength).getUint32(
        request.flags,
        true,
      );
    },
    get latestSemanticByteLength() {
      return latestSemanticByteLength;
    },
    get latestSemanticRecordCount() {
      return latestSemanticRecordCount;
    },
    get latestSemanticParagraphCount() {
      return latestSemanticParagraphCount;
    },
    get borrowedGlyphReads() {
      return borrowedGlyphReads;
    },
    get latestBatchCount() {
      return latestBatchCount;
    },
    get latestBatchRootIds() {
      return [...latestBatchRootIds];
    },
    latestPlanCounts() {
      assert.ok(latestPlanCounts, 'a render-plan result must have been captured');
      return { ...latestPlanCounts };
    },
    get latestAcknowledgedGeneration() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      return new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength).getUint32(
        request.acknowledgedPublicationGeneration,
        true,
      );
    },
    latestRequestCounts() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      const view = new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength);
      return {
        paragraph: view.getUint32(request.paragraphMutationCount, true),
        paragraphOrder: view.getUint32(request.paragraphOrderMutationCount, true),
        text: view.getUint32(request.textMutationCount, true),
        style: view.getUint32(request.styleMutationCount, true),
        constraint: view.getUint32(request.constraintCount, true),
        region: view.getUint32(request.regionCount, true),
        exclusion: view.getUint32(request.exclusionCount, true),
        inlineObject: view.getUint32(request.inlineObjectCount, true),
      };
    },
    latestMeasurementRequestCounts() {
      assert.ok(latestMeasurementRequest, 'a paragraph measurement request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      const view = new DataView(
        latestMeasurementRequest.buffer,
        latestMeasurementRequest.byteOffset,
        latestMeasurementRequest.byteLength,
      );
      return {
        paragraph: view.getUint32(request.paragraphMutationCount, true),
        paragraphOrder: view.getUint32(request.paragraphOrderMutationCount, true),
        text: view.getUint32(request.textMutationCount, true),
        style: view.getUint32(request.styleMutationCount, true),
        constraint: view.getUint32(request.constraintCount, true),
        region: view.getUint32(request.regionCount, true),
        exclusion: view.getUint32(request.exclusionCount, true),
        inlineObject: view.getUint32(request.inlineObjectCount, true),
      };
    },
    reset() {
      crossings = 0;
      measureCrossings = 0;
      borrowedGlyphReads = 0;
      latestBatchRootIds = [];
      latestMeasurementRequest = undefined;
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
    latestParagraphOrderMutations() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      const mutation = abi.layouts.engineParagraphOrderMutation;
      const view = new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength);
      const offset = view.getUint32(request.paragraphOrderMutationsOffset, true);
      const count = view.getUint32(request.paragraphOrderMutationCount, true);
      return Array.from({ length: count }, (_recordValue, index) => {
        const record = offset + index * mutation.size;
        return {
          paragraphId: view.getUint32(record + mutation.paragraphId, true),
          orderScope: view.getUint32(record + mutation.orderScope, true),
          orderRank: view.getFloat64(record + mutation.orderRank, true),
        };
      });
    },
    latestMeasurementParagraphOrderMutations() {
      assert.ok(latestMeasurementRequest, 'a paragraph measurement request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      const mutation = abi.layouts.engineParagraphOrderMutation;
      const view = new DataView(
        latestMeasurementRequest.buffer,
        latestMeasurementRequest.byteOffset,
        latestMeasurementRequest.byteLength,
      );
      const offset = view.getUint32(request.paragraphOrderMutationsOffset, true);
      const count = view.getUint32(request.paragraphOrderMutationCount, true);
      return Array.from({ length: count }, (_recordValue, index) => {
        const record = offset + index * mutation.size;
        return {
          paragraphId: view.getUint32(record + mutation.paragraphId, true),
          orderScope: view.getUint32(record + mutation.orderScope, true),
          orderRank: view.getFloat64(record + mutation.orderRank, true),
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

test('repeated public Text.set assignments match freshly published semantic glyph output', async (t) => {
  const three = await createThreeTestHandle(t);
  const [inter, amiri] = await Promise.all([
    loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] })),
    loadFont({ baked: { bytes: await readFile(amiriFontUrl) } }, bitmap({ strikes: [16] })),
  ]);
  const fallback = createFontStack(inter, amiri);
  const scene = new THREE.Scene();
  t.after(() => {
    inter.dispose();
    amiri.dispose();
  });
  const fixtures = [
    {
      name: 'concat-safe RTL',
      font: amiri,
      style: { fontSize: 16, direction: 'rtl', language: 'ar' },
      values: ['مرحبا بالعالم هذا نص واضح', 'مرحبب بالعالم هذا خط واضخ', 'مرحبا بالعالم هذا نص واضح'],
      verify(layout) {
        assert.ok(
          layout.glyphBidiLevels.every((level) => (level & 1) === 1),
          'RTL glyphs must remain odd-level',
        );
      },
    },
    {
      name: 'ligature combining bidi and surrogate risk',
      font: fallback,
      style: { fontSize: 16, direction: 'ltr', language: 'en' },
      values: [
        'office a\u0301 مرحبا 😀 affine',
        'ofXice a\u0301 مرحبا 😀 affinE',
        'ofXice a\u0300 مرحبى 😃 affinE',
        'office a\u0301 مرحبا 😀 affine!',
        'office a\u0301 مرحبا 😀 affine',
      ],
      verify(layout) {
        assert.ok(new Set(layout.glyphBidiLevels).size > 1, 'mixed text must retain multiple bidi levels');
      },
    },
    {
      name: 'fallback entry and exit',
      font: fallback,
      style: { fontSize: 16, direction: 'ltr', language: 'en' },
      values: ['alpha bravo', 'alpha مرحبا', 'alpha bravo'],
      expectedFontCounts: [2, 1],
    },
  ];

  for (const fixture of fixtures) {
    const properties = {
      font: fixture.font,
      text: fixture.values[0],
      style: fixture.style,
      constraints: { width: { mode: 'exact', size: 240 } },
      layout: { wrap: 'word' },
    };
    const warm = three.createText(properties);
    scene.add(warm);
    scene.updateMatrixWorld(true);
    try {
      for (const [index, value] of fixture.values.slice(1).entries()) {
        warm.set({ text: value });
        scene.updateMatrixWorld(true);
        assert.equal(warm.error, undefined, `${fixture.name} warm publication ${String(index)} must succeed`);

        const fresh = three.createText({ ...properties, text: value });
        scene.add(fresh);
        scene.updateMatrixWorld(true);
        try {
          assert.equal(fresh.error, undefined, `${fixture.name} fresh publication ${String(index)} must succeed`);
          assertPublicSemanticLayoutEqual(warm, fresh, `${fixture.name} assignment ${String(index)}`);
          fixture.verify?.(warm.glyphs());
          if (fixture.expectedFontCounts !== undefined) {
            assert.equal(
              new Set(warm.glyphs().glyphFontSlots).size,
              fixture.expectedFontCounts[index],
              `${fixture.name} assignment ${String(index)} must select the expected font count`,
            );
          }
        } finally {
          scene.remove(fresh);
          fresh.dispose();
        }
      }
    } finally {
      scene.remove(warm);
      warm.dispose();
    }
  }
});

test('renderer rejection preserves Text.set semantic output through explicit retry', async (t) => {
  const warmThree = await createThreeTestHandle(t);
  const freshThree = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());
  let rejectMaterial = true;
  const material = defineTextMaterial((context) => {
    if (rejectMaterial) throw new Error('deliberate sparse assignment publication rejection');
    return context.createDefaultMaterial();
  });
  const warmScene = new THREE.Scene();
  const freshScene = new THREE.Scene();
  const group = warmThree.createTextGroup();
  const warm = warmThree.createText({
    font,
    text: 'alpha|bravo|charlie|delta|echo|foxtrot',
    constraints: { width: { mode: 'exact', size: 220 } },
    layout: { wrap: 'word' },
  });
  group.add(warm);
  warmScene.add(group);
  warmScene.updateMatrixWorld(true);
  const next = 'Alpha|bravo|charlie|delta|echo|foxtroT';
  warm.set({ text: next, material });
  warmScene.updateMatrixWorld(true);
  assert.match(String(group.error), /deliberate sparse assignment publication rejection/u);

  const fresh = freshThree.createText({
    font,
    text: next,
    constraints: { width: { mode: 'exact', size: 220 } },
    layout: { wrap: 'word' },
  });
  freshScene.add(fresh);
  freshScene.updateMatrixWorld(true);
  assertPublicSemanticLayoutEqual(warm, fresh, 'renderer-rejected assignment');

  rejectMaterial = false;
  warm.set({ material });
  warmScene.updateMatrixWorld(true);
  assert.equal(group.error, undefined, 'explicit material invalidation must retry the rejected publication');
  assert.equal(rootDraws(warmScene).length, 1, 'the successful retry must realize the retained paragraph');
  assertPublicSemanticLayoutEqual(warm, fresh, 'explicit retry');

  group.dispose();
  warm.dispose();
  fresh.dispose();
});

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

test('Text.measure retains unpublished lifecycle but skips published paragraph upserts', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const first = three.createText({ font, text: 'first query' });
  const second = three.createText({ font, text: 'second query' });
  group.add(first, second);
  scene.add(group);
  scene.updateMatrixWorld(true);

  first.text = 'first unchanged-order query';
  instrumentedGlyph.reset();
  assert.ok(first.measure().glyphCount > 0);
  const semanticQueryCounts = instrumentedGlyph.latestMeasurementRequestCounts();
  assert.equal(semanticQueryCounts.paragraph, 0, 'a published target needs no repeated paragraph lifecycle rows');
  assert.equal(semanticQueryCounts.paragraphOrder, 0, 'a semantic query does not resend stable rank rows');

  first.renderOrder = 2;
  second.renderOrder = 1;
  first.text = 'first ranked query';
  second.text = 'second ranked query';
  instrumentedGlyph.reset();
  assert.ok(first.measure().glyphCount > 0);
  assert.deepEqual(
    instrumentedGlyph.latestMeasurementParagraphOrderMutations().map(({ orderRank }) => orderRank),
    [2, 1],
    'a scoped query serializes every rank still pending publication',
  );
  assert.ok(second.measure().glyphCount > 0);
  assert.deepEqual(
    instrumentedGlyph.latestMeasurementParagraphOrderMutations().map(({ orderRank }) => orderRank),
    [2, 1],
    'successive speculative queries retain the same pending rank transaction',
  );
  assert.equal(instrumentedGlyph.crossings, 0, 'queries do not publish a full frame');
  assert.equal(instrumentedGlyph.measureCrossings, 2);

  scene.updateMatrixWorld(true);
  group.dispose();
  first.dispose();
  second.dispose();
  font.dispose();
});

test('Text.readGlyphs demand-reads scalar records only inside one synchronous borrow', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const label = three.createText({ font, text: 'Borrowed glyph records wrap across two lines' });
  label.constraints = { width: { mode: 'exact', size: 140 } };
  instrumentedGlyph.reset();
  let escaped;
  let glyphCount = 0;
  const selected = [];
  const answer = Object.freeze({ answer: 42 });
  const returned = label.readGlyphs((layout) => {
    escaped = layout;
    glyphCount = layout.glyphCount;
    for (const index of [0, glyphCount - 1]) {
      const glyphRecord = layout.glyphAt(index);
      assert.equal(Object.isFrozen(glyphRecord), true);
      selected.push([index, glyphRecord]);
    }
    assert.throws(() => label.set({ text: 'reentrant mutation' }), /cannot be reentered/);
    assert.throws(() => label.measure(), /cannot be reentered/);
    assert.throws(() => glyph.shape(), /cannot be reentered/);
    return answer;
  });

  assert.equal(returned, answer, 'the callback result retains its identity');
  assert.equal(instrumentedGlyph.latestSemanticRecordCount, 0, 'borrow setup serializes no semantic records');
  assert.equal(instrumentedGlyph.borrowedGlyphReads, 2, 'only explicitly selected glyphs cross the Wasm ABI');
  const owned = label.glyphs();
  assert.equal(glyphCount, owned.glyphCount);
  for (const [index, glyphRecord] of selected) {
    assert.equal(glyphRecord.stableId, owned.glyphStableIds[index]);
    assert.equal(glyphRecord.fontHandle, owned.fontHandles[owned.glyphFontSlots[index]]);
    assert.equal(glyphRecord.glyphId, owned.glyphIds[index]);
    assert.equal(glyphRecord.cluster, owned.clusters[index]);
    assert.equal(glyphRecord.bidiLevel, owned.glyphBidiLevels[index]);
    assert.equal(glyphRecord.fontSize, owned.glyphFontSizes[index]);
    assert.equal(glyphRecord.x, owned.x[index]);
    assert.equal(glyphRecord.y, owned.y[index]);
    assert.equal(glyphRecord.advance, owned.glyphAdvances[index]);
    assert.equal(glyphRecord.inkX, owned.glyphInkX[index]);
    assert.equal(glyphRecord.inkY, owned.glyphInkY[index]);
    assert.equal(glyphRecord.inkWidth, owned.glyphInkWidths[index]);
    assert.equal(glyphRecord.inkHeight, owned.glyphInkHeights[index]);
    assert.equal(glyphRecord.flags, owned.glyphFlags[index]);
  }
  assert.equal(label.text, 'Borrowed glyph records wrap across two lines');
  assert.throws(() => escaped.glyphCount, /expired/);
  assert.throws(() => escaped.glyphAt(0), /expired/);

  let thrownView;
  assert.throws(
    () =>
      label.readGlyphs((layout) => {
        thrownView = layout;
        throw new Error('borrow callback failed');
      }),
    /borrow callback failed/,
  );
  assert.throws(() => thrownView.glyphCount, /expired/);
  assert.throws(() => label.readGlyphs(async () => 42), /must answer synchronously/);
  label.text = 'mutation succeeds after borrow release';
  assert.equal(label.measure().glyphCount, 38);

  label.dispose();
  font.dispose();
});

test('Text.readGlyphs promotes repeated reads to a cached callback-scoped inspection', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({ font, text: 'Committed glyph records' });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld(true);
  glyph.shape();

  instrumentedGlyph.reset();
  const firstGlyphId = label.readGlyphs((layout) => layout.glyphAt(0).glyphId);
  const secondGlyphId = label.readGlyphs((layout) => layout.glyphAt(0).glyphId);
  assert.equal(firstGlyphId, secondGlyphId);
  assert.equal(instrumentedGlyph.measureCrossings, 2, 'the second borrow promotes one canonical inspection');
  assert.equal(instrumentedGlyph.borrowedGlyphReads, 1, 'the promoted borrow reads its scalar from cached columns');

  instrumentedGlyph.reset();
  assert.equal(
    label.readGlyphs((layout) => layout.glyphAt(0).glyphId),
    firstGlyphId,
  );
  assert.equal(instrumentedGlyph.measureCrossings, 0, 'unchanged promoted borrows stay inside JS');
  assert.equal(instrumentedGlyph.borrowedGlyphReads, 0);

  label.text = 'Dirty';
  instrumentedGlyph.reset();
  assert.equal(
    label.readGlyphs((layout) => layout.glyphCount),
    5,
  );
  assert.equal(instrumentedGlyph.measureCrossings, 1, 'the first borrow after an edit remains sparse');
  assert.equal(
    label.readGlyphs((layout) => layout.glyphCount),
    5,
  );
  assert.equal(instrumentedGlyph.measureCrossings, 2, 'the second unchanged borrow promotes the new revision');
  assert.equal(
    label.readGlyphs((layout) => layout.glyphCount),
    5,
  );
  assert.equal(instrumentedGlyph.measureCrossings, 2, 'the promoted revision stays cached');

  const measurement = label.measure();
  assert.equal(measurement.x, undefined, 'measure does not expose the canonical inspection columns');
  assert.equal(measurement.glyphIds, undefined, 'measure cannot mutate the private glyph cache');

  label.renderOrder = 7;
  instrumentedGlyph.reset();
  assert.equal(
    label.readGlyphs((layout) => layout.glyphCount),
    5,
  );
  assert.equal(instrumentedGlyph.measureCrossings, 0, 'order-only changes preserve positioned glyph columns');

  group.dispose();
  label.dispose();
  font.dispose();
});

test('Text.readGlyphs keeps sparse borrowing when canonical inspection exceeds the output limit', async (t) => {
  const three = await createThreeTestHandle(t, {
    ...ThreeConfig,
    commands: {
      ...ThreeConfig.commands,
      limits: { ...ThreeConfig.commands.limits, maxOutputBytes: 4_096 },
    },
  });
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const label = three.createText({ font, text: 'capacity '.repeat(512) });

  instrumentedGlyph.reset();
  const first = label.readGlyphs((layout) => layout.glyphAt(0).glyphId);
  const second = label.readGlyphs((layout) => layout.glyphAt(0).glyphId);
  const third = label.readGlyphs((layout) => layout.glyphAt(0).glyphId);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(
    instrumentedGlyph.borrowedGlyphReads,
    3,
    'a capacity-limited canonical inspection falls back once and remains on sparse scalar reads',
  );

  label.dispose();
  font.dispose();
});

test('empty Text bounding boxes cache their valid measurement', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const label = three.createText({ font, text: '' });
  instrumentedGlyph.reset();

  assert.equal(label.computeBoundingBox().isEmpty(), true);
  assert.equal(label.computeBoundingBox().isEmpty(), true);
  assert.equal(instrumentedGlyph.measureCrossings, 1, 'a valid empty box stays current');

  label.dispose();
  font.dispose();
});

test('Three Box3 measures transformed Text and TextGroup ink without adding scene objects', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const first = three.createText({ font, text: 'Box3 first' });
  const second = three.createText({ font, text: 'Box3 second' });
  group.position.set(4, 7, 0);
  group.rotation.z = Math.PI / 8;
  group.scale.set(1.25, 0.75, 1);
  first.position.set(13, 17, 0);
  second.position.set(-11, -19, 0);
  group.add(first, second);
  scene.add(group);

  const expectedWorldBox = (text) => text.boundingBox.clone().applyMatrix4(text.matrixWorld);
  const assertSameBox = (actual, expected, message) => {
    assert.deepEqual(actual.min.toArray(), expected.min.toArray(), `${message} minimum`);
    assert.deepEqual(actual.max.toArray(), expected.max.toArray(), `${message} maximum`);
  };

  try {
    instrumentedGlyph.reset();
    const preRenderBox = new THREE.Box3().setFromObject(first);
    const preRenderMeasurement = first.measure();
    assert.equal(preRenderBox.isEmpty(), false, 'Box3 positions ink before the first rendered frame');
    assert.ok(preRenderMeasurement.inkBounds, 'the pre-render query caches authoritative ink bounds');
    assert.equal(instrumentedGlyph.measureCrossings, 1, 'Box3 uses one positioned measurement query');
    assert.equal(
      instrumentedGlyph.latestSemanticRecordCount,
      preRenderMeasurement.lineCount + 1,
      'Box3 does not serialize per-glyph inspection records',
    );
    assertSameBox(preRenderBox, expectedWorldBox(first), 'pre-render Text');

    scene.updateMatrixWorld(true);
    assert.equal(first.geometry, second.geometry, 'Text objects share one measurement geometry');
    assert.equal(first.geometry.getAttribute('position'), undefined, 'measurement geometry has no vertex payload');
    assert.equal(first.isMesh, undefined, 'the Box3 hook must not classify Text as a Mesh');
    assert.equal(first.isLine, undefined, 'the Box3 hook must not classify Text as a Line');
    assert.equal(first.isPoints, undefined, 'the Box3 hook must not classify Text as Points');
    assert.deepEqual(new THREE.Raycaster().intersectObject(first), [], 'the Box3 hook must not add raycast geometry');
    const serialized = first.toJSON();
    assert.equal(serialized.object.geometry, undefined, 'the Box3 hook must not serialize renderer geometry');
    assert.equal(serialized.geometries, undefined, 'the Box3 hook must not register a geometry resource');
    const groupChildren = [...group.children];
    const draws = rootDraws(scene);
    assert.ok(draws.length > 0, 'the fixture must realize its renderer-owned draws');
    const expectedGroup = expectedWorldBox(first).union(expectedWorldBox(second));

    for (const precise of [false, true]) {
      assertSameBox(
        new THREE.Box3().setFromObject(first, precise),
        expectedWorldBox(first),
        `Text precise=${String(precise)}`,
      );
      assertSameBox(
        new THREE.Box3().setFromObject(group, precise),
        expectedGroup,
        `TextGroup precise=${String(precise)}`,
      );
    }

    assert.deepEqual(group.children, groupChildren, 'measurement must not add authored scene children');
    assert.deepEqual(rootDraws(scene), draws, 'measurement must not replace or add renderer-owned draws');

    const beforeMutation = new THREE.Box3().setFromObject(first);
    first.text = 'Box3 first becomes substantially longer';
    scene.updateMatrixWorld(true);
    const afterMutation = new THREE.Box3().setFromObject(first);
    assertSameBox(afterMutation, expectedWorldBox(first), 'mutated Text');
    assert.ok(
      afterMutation.getSize(new THREE.Vector3()).lengthSq() > beforeMutation.getSize(new THREE.Vector3()).lengthSq(),
      'a text mutation must refresh the scene-graph box',
    );

    group.remove(first);
    first.dispose();
    scene.updateMatrixWorld(true);
    assertSameBox(
      new THREE.Box3().setFromObject(second),
      expectedWorldBox(second),
      'remaining Text after sibling disposal',
    );
  } finally {
    group.remove(first, second);
    first.dispose();
    second.dispose();
    group.dispose();
    font.dispose();
  }
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

test('layout queries do not retain unrelated detached Texts', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const detached = three.createText({ font, text: 'detached sibling' });
  const attached = three.createText({ font, text: 'attached query target' });
  group.add(detached, attached);
  scene.add(group);
  scene.updateMatrixWorld(true);
  assert.equal(detached.bound, true);
  assert.equal(attached.bound, true);

  group.remove(detached);
  scene.updateMatrixWorld(true);
  assert.equal(detached.bound, false);
  assert.equal(attached.bound, true);

  assert.ok(attached.measure().glyphCount > 0);
  assert.equal(detached.bound, false, 'measuring a sibling cannot retain an unrelated detached Text');
  assert.ok(attached.glyphs().glyphCount > 0);
  assert.equal(detached.bound, false, 'inspecting a sibling cannot retain an unrelated detached Text');

  assert.ok(detached.measure().glyphCount > 0, 'the explicitly queried detached Text remains measurable');
  assert.equal(detached.bound, true);
  scene.updateMatrixWorld(true);
  assert.equal(detached.bound, false, 'the next draw removes only the explicitly queried detached Text');
  assert.equal(attached.bound, true);

  detached.dispose();
  attached.dispose();
  group.dispose();
  font.dispose();
});

test('alternating detached measurements retire one bounded speculative lifecycle', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const first = three.createText({ font, text: 'first detached query' });
  const second = three.createText({ font, text: 'second detached query' });
  const scene = new THREE.Scene();
  scene.add(first, second);
  scene.updateMatrixWorld(true);
  scene.remove(first, second);
  first.style = { ...first.style, fontSize: 17 };
  second.style = { ...second.style, fontSize: 17 };
  instrumentedGlyph.reset();

  const firstMeasurement = first.measure();
  assert.equal(firstMeasurement.glyphCount, 20);
  assert.equal(second.bound, false, 'querying the first Text must not bind its detached sibling');
  assert.equal(second.measure().glyphCount, 21);
  assert.equal(first.bound, false, 'querying the second Text must not bind its detached sibling');
  const initialRequestCounts = instrumentedGlyph.latestMeasurementRequestCounts();
  assert.ok(initialRequestCounts.paragraph <= 2, 'the speculative lifecycle stays bounded to the two query targets');
  assert.equal(instrumentedGlyph.measureCrossings, 2, 'each paragraph incurs one initial query');
  assert.equal(first.measure(), firstMeasurement, 'returning to the first Text must reuse its controller measurement');
  assert.equal(instrumentedGlyph.measureCrossings, 2, 'alternation must not recreate the first paragraph');

  for (let iteration = 0; iteration < 8_193; iteration += 1) {
    const target = iteration % 2 === 0 ? first : second;
    const unrelated = target === first ? second : first;
    assert.equal(target.measure().glyphCount, target === first ? 20 : 21);
    assert.equal(target.bound, true, 'the explicitly queried Text remains bound to its query controller');
    assert.equal(unrelated.bound, false, 'an alternating query must leave its detached sibling unbound');
  }

  assert.equal(instrumentedGlyph.crossings, 0, 'queries must not publish renderer work');
  assert.equal(instrumentedGlyph.measureCrossings, 2, 'cached siblings must not be destroyed and remeasured');

  for (let iteration = 0; iteration < 8_193; iteration += 1) {
    const target = iteration % 2 === 0 ? first : second;
    const unrelated = target === first ? second : first;
    assert.equal(target.glyphs().glyphCount, target === first ? 20 : 21);
    assert.equal(target.bound, true, 'the explicitly inspected Text remains bound to its query controller');
    assert.equal(unrelated.bound, false, 'an alternating inspection must leave its detached sibling unbound');
  }

  assert.equal(instrumentedGlyph.measureCrossings, 4, 'each controller performs one positioning upgrade');
  assert.deepEqual(
    instrumentedGlyph.latestMeasurementRequestCounts(),
    initialRequestCounts,
    'alternation beyond the paragraph-mutation limit must not accumulate lifecycle rows',
  );
  assert.equal(three.textCount, 2, 'query alternation must preserve both root-owned Text lifetimes');

  first.text = 'first detached query changed';
  assert.equal(first.measure().glyphCount, 28, 'a semantic mutation invalidates the controller measurement');
  assert.equal(instrumentedGlyph.measureCrossings, 5, 'the changed paragraph incurs exactly one new query');
  assert.equal(second.bound, false);

  first.style = { ...first.style, fontSize: 20 };
  assert.equal(first.measure().glyphCount, 28, 'a style mutation invalidates the controller measurement');
  assert.equal(instrumentedGlyph.measureCrossings, 6, 'the changed style incurs exactly one new query');
  first.font = font;
  assert.equal(first.measure().glyphCount, 28, 'a font mutation invalidates the controller measurement');
  assert.equal(instrumentedGlyph.measureCrossings, 7, 'the changed font selection incurs exactly one new query');

  scene.add(first, second);
  scene.updateMatrixWorld(true);
  assert.equal(instrumentedGlyph.crossings, 1, 'later attachment publishes both Texts in one frame');
  assert.ok(instrumentedGlyph.latestRequestCounts().paragraph <= 3, 'publication retires at most one query paragraph');
  const paragraphMutations = instrumentedGlyph.latestParagraphMutations();
  const opcodes = textShaperAbi.engine.paragraphMutationOpcodes;
  assert.equal(
    paragraphMutations.filter(({ opcode }) => opcode === opcodes.remove).length,
    1,
    'attachment evicts exactly the one detached query-cache paragraph',
  );
  assert.equal(
    paragraphMutations.filter(({ opcode }) => opcode === opcodes.upsert).length,
    2,
    'attachment publishes exactly the two authored paragraphs',
  );
  assert.equal(first.bound, true);
  assert.equal(second.bound, true);
  assert.equal(first.commitState().status, 'committed');
  assert.equal(second.commitState().status, 'committed');

  first.dispose();
  second.dispose();
  font.dispose();
});

test('synchronous Three scene events cannot replace a live member traversal with query members', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const firstScene = new THREE.Scene();
  const secondScene = new THREE.Scene();
  const attached = three.createText({ font, text: 'attached live member' });
  const detached = three.createText({ font, text: 'detached query member' });
  firstScene.add(attached, detached);
  firstScene.updateMatrixWorld(true);
  firstScene.remove(detached);
  secondScene.add(attached);
  attached.text = 'moved attached live member';
  let nestedQueries = 0;
  const queryDuringRootAttachment = (event) => {
    if (!event.child?.name.startsWith('@pmndrs/glyph:')) return;
    nestedQueries += 1;
    detached.measure();
  };
  secondScene.addEventListener('childadded', queryDuringRootAttachment);

  try {
    glyph.shape();
    assert.equal(nestedQueries, 1, 'renderer root attachment must exercise the synchronous query reentry');
    assert.equal(attached.bound, true);
    assert.equal(detached.bound, false, 'the outer live traversal must remove the query-only detached member');
  } finally {
    secondScene.removeEventListener('childadded', queryDuringRootAttachment);
    attached.dispose();
    detached.dispose();
    font.dispose();
  }
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
  const transforms = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id));
  assert.deepEqual(
    Array.from({ length: draw.geometry.instanceCount }, (_, index) => transforms.getX(start + index)),
    [1, 1],
  );
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

test('large inspection queries grow the result arena to the reported requirement', async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 8_192, policy: 'grow' } }));
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(densityFontUrl)) },
    bitmap({ strikes: [16, 32] }),
  );
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const label = three.createText({
    font,
    text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !?.,;:'.repeat(100),
    style: { fontSize: 16 },
    constraints: { width: { mode: 'exact', size: 600 } },
    layout: { wrap: 'word' },
  });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld(true);

  assert.equal(group.error, undefined);
  const inspection = label.glyphs();
  assert.ok(inspection.glyphCount > 6_000);
  assert.equal(inspection.glyphIds.length, inspection.glyphCount);

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
  // CPU inspection and the renderer share the declared local-plus-offset f32 placement authority.
  assert.deepEqual([...inspection.x], [0.2320079803466797, 10.808008193969727, 18.376007080078125, 23.91200828552246]);

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
  assert.equal(instrumentedGlyph.latestSemanticParagraphCount, labels.length);
  const initialSemanticByteLength = instrumentedGlyph.latestSemanticByteLength;
  const measurements = labels.map((label) => label.measure());
  assert.equal(labels[48].measure(), measurements[48], 'an unchanged attached Text reuses its measurement');
  let measurementPublications = 0;
  for (const label of labels) {
    const minimum = label.boundingBox.min;
    const set = minimum.set.bind(minimum);
    minimum.set = (x, y, z) => {
      measurementPublications += 1;
      return set(x, y, z);
    };
  }

  for (let cycle = 0; cycle < 200; cycle += 1) {
    measurementPublications = 0;
    for (let offset = 0; offset < 48; offset += 1) {
      const index = (cycle * 23 + offset) % labels.length;
      labels[index].text = `recycled-${String(cycle)}-${String(index)}`;
    }
    scene.updateMatrixWorld();
    assert.equal(group.error, undefined, `recycling cycle ${String(cycle)} must remain publishable`);
    assert.equal(
      instrumentedGlyph.latestSemanticParagraphCount,
      48,
      `recycling cycle ${String(cycle)} emits only dirty paragraph measurements`,
    );
    assert.equal(
      instrumentedGlyph.latestSemanticRecordCount,
      96,
      `recycling cycle ${String(cycle)} emits one summary and line per dirty paragraph`,
    );
    assert.ok(
      instrumentedGlyph.latestSemanticByteLength < initialSemanticByteLength,
      `recycling cycle ${String(cycle)} keeps the semantic publication smaller than first publication`,
    );
    assert.equal(
      measurementPublications,
      48,
      `recycling cycle ${String(cycle)} republishes bounds only for dirty Text objects`,
    );
    if (cycle !== 0) continue;
    let publishedMeasurements = 0;
    for (const [index, label] of labels.entries()) {
      const measurement = label.measure();
      if (measurement !== measurements[index]) publishedMeasurements += 1;
      measurements[index] = measurement;
    }
    assert.equal(publishedMeasurements, 48, `recycling cycle ${String(cycle)} publishes only dirty measurements`);
  }

  group.dispose();
  for (const label of labels) label.dispose();
  font.dispose();
  fontDomain.dispose();
});

/** A geometry-only constraint change routes to the paragraph-scoped synchronous engine query — no full planner update, no publication flip — and the next ordinary frame adopts the speculative work without a checkpoint rebuild. */
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
  // A ligature's absorbed grapheme owns no glyph, but the cluster arena still records the
  // owning font's units-per-em for it. Amiri applies `liga` to Latin f-pairs; Inter as baked does not.
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

const publicSemanticLayoutFields = [
  'glyphFontSlots',
  'glyphIds',
  'clusters',
  'glyphBidiLevels',
  'glyphFontSizes',
  'x',
  'y',
  'glyphAdvances',
  'glyphInkX',
  'glyphInkY',
  'glyphInkWidths',
  'glyphInkHeights',
  'glyphFlags',
  'lineTextStarts',
  'lineTextEnds',
  'lineGlyphStarts',
  'lineGlyphCounts',
  'lineBaselines',
  'lineAdvances',
];

function assertPublicSemanticLayoutEqual(actualText, expectedText, context) {
  const actual = actualText.glyphs();
  const expected = expectedText.glyphs();
  assert.deepEqual(actualText.measure(), expectedText.measure(), `${context} measurement`);
  assert.equal(actual.glyphCount, expected.glyphCount, `${context} glyphCount`);
  assert.equal(actual.lineCount, expected.lineCount, `${context} lineCount`);
  assert.equal(actual.missingGlyphCount, expected.missingGlyphCount, `${context} missingGlyphCount`);
  assert.equal(actual.fontHandles.length, expected.fontHandles.length, `${context} font count`);
  assert.deepEqual(actual.lines, expected.lines, `${context} lines`);
  for (const field of publicSemanticLayoutFields) {
    assert.deepEqual(Array.from(actual[field]), Array.from(expected[field]), `${context} ${field}`);
  }
}

function rootDraws(scene, name = undefined) {
  const renderObject = scene.getObjectByName(name === undefined ? '@pmndrs/glyph:anonymous' : `@pmndrs/glyph:${name}`);
  return renderObject?.children.filter((child) => child.isMesh) ?? [];
}

function singleDrawAffectedByGroupVisibility(scene, group) {
  const draws = rootDraws(scene);
  assert.ok(
    draws.every((draw) => draw.visible),
    'scope discovery starts with every draw visible',
  );
  group.visible = false;
  scene.updateMatrixWorld(true);
  const affected = draws.filter((draw) => !draw.visible);
  group.visible = true;
  scene.updateMatrixWorld(true);
  assert.equal(affected.length, 1, 'one automatic TextGroup must affect one committed draw');
  assert.ok(
    draws.every((draw) => draw.visible),
    'scope discovery restores every draw',
  );
  return affected[0];
}

function observeDrawMetadataWrites(draw) {
  let renderOrder = draw.renderOrder;
  let visible = draw.visible;
  const writes = { renderOrder: 0, visible: 0 };
  Object.defineProperties(draw, {
    renderOrder: {
      configurable: true,
      enumerable: true,
      get: () => renderOrder,
      set: (value) => {
        writes.renderOrder += 1;
        renderOrder = value;
      },
    },
    visible: {
      configurable: true,
      enumerable: true,
      get: () => visible,
      set: (value) => {
        writes.visible += 1;
        visible = value;
      },
    },
  });
  return writes;
}

function mountRendererDifferentialEntry(root, font, parent, entry) {
  const group = root.createTextGroup({ batching: entry.batching, renderOrder: entry.renderOrder });
  const label = root.createText({
    font,
    ...(entry.material === undefined ? {} : { material: entry.material }),
    style: { color: entry.color },
    text: entry.text,
  });
  group.position.x = entry.x;
  group.visible = entry.visible;
  group.add(label);
  parent.add(group);
  return { group, label };
}

const rendererDifferentialLayoutColumns = [
  'glyphIds',
  'clusters',
  'glyphFontSlots',
  'glyphBidiLevels',
  'glyphFontSizes',
  'x',
  'y',
  'glyphAdvances',
  'glyphInkX',
  'glyphInkY',
  'glyphInkWidths',
  'glyphInkHeights',
  'glyphFlags',
  'lineTextStarts',
  'lineTextEnds',
  'lineGlyphStarts',
  'lineGlyphCounts',
  'lineBaselines',
  'lineAdvances',
];

function rendererDifferentialSnapshot(scene, rootName, entries, mounted) {
  const layouts = entries.map(({ id }) => {
    const layout = mounted.get(id).label.glyphs();
    return {
      id,
      columns: Object.fromEntries(rendererDifferentialLayoutColumns.map((field) => [field, Array.from(layout[field])])),
      measurement: {
        contentHeight: layout.contentHeight,
        contentWidth: layout.contentWidth,
        glyphCount: layout.glyphCount,
        height: layout.height,
        lineCount: layout.lineCount,
        maxContentWidth: layout.maxContentWidth,
        minContentWidth: layout.minContentWidth,
        width: layout.width,
      },
    };
  });
  const visibilityByEntry = entries.map(({ id }) => {
    const group = mounted.get(id).group;
    const original = group.visible;
    group.visible = false;
    scene.updateMatrixWorld(true);
    const whenHidden = rootDraws(scene, rootName).map((draw) => draw.visible);
    group.visible = true;
    scene.updateMatrixWorld(true);
    const whenVisible = rootDraws(scene, rootName).map((draw) => draw.visible);
    group.visible = original;
    scene.updateMatrixWorld(true);
    return { id, whenHidden, whenVisible };
  });
  const omittedAttributes = new Set([
    '_pmndrsGlyphInstanceTransforms',
    '_pmndrsGlyphTransforms',
    glyphAttribute(threeSystemBuffers.placementSlot.id),
    glyphAttribute(threeSystemBuffers.stableGlyphId.id),
    glyphAttribute(threeSystemBuffers.transformIndex.id),
  ]);
  const draws = rootDraws(scene, rootName).map((draw) => {
    const start = draw.userData.pmndrsGlyphRunStart;
    const count = draw.geometry.instanceCount;
    const transformIndices = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id));
    const transformTable = draw.geometry.getAttribute('_pmndrsGlyphTransforms');
    const matrices = Array.from({ length: count }, (_, index) => {
      if (transformIndices === undefined || transformTable === undefined) {
        return draw.matrix.elements.map(Math.fround);
      }
      const transformId = transformIndices.getX(start + index);
      return Array.from(transformTable.array.subarray(transformId * 16, transformId * 16 + 16));
    });
    const attributes = Object.fromEntries(
      Object.entries(draw.geometry.attributes)
        .filter(([name]) => !omittedAttributes.has(name))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, attribute]) => {
          const first = start * attribute.itemSize;
          const end = (start + count) * attribute.itemSize;
          return [
            name,
            {
              itemSize: attribute.itemSize,
              normalized: attribute.normalized,
              values: Array.from(attribute.array.subarray(first, end)),
            },
          ];
        }),
    );
    return {
      attributes,
      count,
      depthKey: draw.userData.pmndrsGlyphDepthKey,
      matrices,
      primitiveKind: draw.userData.pmndrsGlyphPrimitiveKind,
      renderOrder: draw.renderOrder,
      visible: draw.visible,
    };
  });
  return { draws, layouts, visibilityByEntry };
}

function captureThrown(call) {
  try {
    call();
  } catch (error) {
    return { present: true, error };
  }
  return { present: false };
}
