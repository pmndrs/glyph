import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  Constraints,
  createFontLibrary,
  createFontStack,
  glyph,
  loadFont,
  ParagraphLayout,
  TextStyle,
} from '@pmndrs/glyph';
import { GlyphBackend } from '@pmndrs/glyph/core';
import { PlanTransport } from '../../dist/core/backend.js';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import {
  defineTextMaterial,
  FontLoader,
  localToWorldMatrix,
  Text,
  TextGroup,
  ThreeConfig,
  worldToLocalMatrix,
} from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { bitmapSchema } from '../../dist/raster/bitmap-technique.js';
import { msdfSchema } from '../../dist/raster/msdf.js';
import { slugSchema } from '../../dist/raster/slug-technique.js';
import { threeEngineDomainReport, threeSharedRenderResourceCount } from '../../dist/three/engine-domain.js';
import { decorationSchema, threeSystemBuffers } from '../../dist/three/render-policy.js';
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

test('one initialized Glyph runtime creates independent named Three handles over immutable root fonts', async () => {
  const firstInit = glyph.init();
  const secondInit = glyph.init();
  assert.equal(firstInit, secondInit, 'concurrent initialization shares one operation');
  await firstInit;
  assert.equal(glyph.init(), firstInit, 'successful initialization keeps one settled promise forever');

  const font = await loadFont(
    { baked: { bytes: await readFile(fontUrl) } },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const first = glyph.handle('three:integration:first', ThreeConfig);
  let wrappedEncodeCalls = 0;
  let wrappedDecodeCalls = 0;
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
    decode(source, context) {
      wrappedDecodeCalls += 1;
      return ThreeConfig.decode(source, context);
    },
    resolve(context) {
      wrappedResolveCalls += 1;
      return ThreeConfig.resolve(context);
    },
    renderer(context) {
      wrappedRendererFactories += 1;
      const renderer = ThreeConfig.renderer(context);
      return {
        prepare(frame) {
          wrappedPrepareCalls += 1;
          assert.equal(frame.delivery, 'borrowed-bound');
          assert.ok(frame.group.kind === 'unchanged' || frame.group.kind === 'replace');
          return renderer.prepare(frame);
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
  const label = first.createText({ font, text: 'Handle owned', style: { fontSize: 16 } });
  const secondSceneLabel = secondSceneRoot.createText({
    font,
    text: 'Same handle, other scene',
    style: { fontSize: 16 },
  });
  const group = second.createTextGroup();
  const grouped = second.createText({ font, text: 'Independent', style: { fontSize: 16 } });
  group.add(grouped);
  scene.add(label, group);
  secondScene.add(secondSceneLabel);

  try {
    label.shape();
    secondSceneLabel.shape();
    group.shape();
    assert.equal(wrappedEncodeCalls, 1, 'a spread config participates in its handle backend construction');
    assert.equal(wrappedRendererFactories, 1, 'one config renderer is created for the TextGroup boundary');
    assert.ok(wrappedDecodeCalls > 0, 'the selected decoder handles semantic publications');
    assert.ok(wrappedResolveCalls > 0, 'the selected resolver binds acquired portable resources');
    assert.ok(wrappedPrepareCalls > 0, 'the selected renderer prepares the bound command buffer');
    assert.ok(wrappedTransformSyncCalls > 0, 'transform synchronization uses the renderer side path');
    const semanticCounts = {
      decode: wrappedDecodeCalls,
      resolve: wrappedResolveCalls,
      prepare: wrappedPrepareCalls,
      transforms: wrappedTransformSyncCalls,
    };
    grouped.position.x += 1;
    group.shape();
    assert.equal(wrappedDecodeCalls, semanticCounts.decode, 'transform-only shape does not decode');
    assert.equal(wrappedResolveCalls, semanticCounts.resolve, 'transform-only shape does not resolve');
    assert.equal(wrappedPrepareCalls, semanticCounts.prepare, 'transform-only shape does not prepare semantic state');
    assert.ok(wrappedTransformSyncCalls > semanticCounts.transforms, 'transform-only shape synchronizes the renderer');
    const firstDrawRoot = scene.getObjectByName('@pmndrs/glyph:anonymous');
    assert.ok(firstDrawRoot, 'the handle fronts one anonymous root that late-binds to the Text Scene');
    assert.equal(
      secondSceneRoot.drawRoot.parent,
      secondScene,
      'a named root gives the same handle an independent publication stream in another Scene',
    );
    assert.ok(
      firstDrawRoot.children.some((child) => child.isMesh),
      'root batches realize as renderer-owned meshes',
    );
    assert.ok(
      secondSceneRoot.drawRoot.children.some((child) => child.isMesh),
      'the second root owns its own renderer meshes',
    );
    assert.throws(() => group.add(label), /different Glyph handles/);
    assert.throws(() => glyph.handle('three:integration:first', ThreeConfig), /already exists/);
  } finally {
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

test('Text.breakApart imports a planner-assisted copy with exact world alignment and full matrices', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const scene = new THREE.Scene();
  const sourceParent = new THREE.Group();
  sourceParent.position.set(-4, 2, 3);
  sourceParent.rotation.set(0.15, -0.3, 0.25);
  sourceParent.scale.set(1.2, 0.8, 1.1);
  scene.add(sourceParent);
  const label = new Text({ font, text: 'Glyphs move', style: { fontSize: 16 } });
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
    const sourceResourceCount = threeSharedRenderResourceCount();
    assert.ok(sourceResourceCount > 0, 'the committed source realizes its atlas resource');
    [detached] = label.breakApart();
    assert.equal(
      threeSharedRenderResourceCount(),
      sourceResourceCount,
      'the detached executor leases the source atlas instead of uploading a duplicate',
    );
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
    const sourceDraw = label.children.find(
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
    assert.equal(
      threeSharedRenderResourceCount(),
      sourceResourceCount,
      'disposing the detached lease must retain the source atlas',
    );
    assert.throws(() => detached.getMatrixAt(0, new THREE.Matrix4()), /disposed/u);
    assert.throws(() => detached.setMatrixAt(0, new THREE.Matrix4()), /disposed/u);
    detached = undefined;
  } finally {
    detached?.dispose();
    label.dispose();
    font.dispose();
    loader.dispose();
  }
});

test('detached glyphs retain their engine domain after the source and font owners are disposed', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const scene = new THREE.Scene();
  const label = new Text({ font, text: 'outlives source', style: { fontSize: 16 } });
  scene.add(label);
  scene.updateMatrixWorld(true);
  const [detached] = label.breakApart();
  scene.add(detached);
  label.dispose();
  font.dispose();
  loader.dispose();
  try {
    assert.equal(threeEngineDomainReport().active, true, 'the detached object owns a domain lease');
    assert.ok(threeSharedRenderResourceCount() > 0);
    assert.ok(detached.materials.length > 0);
    detached.getMatrixAt(0, new THREE.Matrix4());
  } finally {
    detached.dispose();
  }
  assert.deepEqual(threeEngineDomainReport(), { active: false, loaders: 0, fonts: 0, leases: 0 });
  assert.equal(threeSharedRenderResourceCount(), 0);
});

test('Text.breakApart returns a paragraph-scoped independent decoration plan when one exists', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const scene = new THREE.Scene();
  const label = new Text({
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
    const sourceDraw = label.children.find(
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

    plain = new Text({ font, text: 'plain text', style: { fontSize: 16 } });
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
    loader.dispose();
  }
});

test('Text.breakApart preserves TextGroup paint order across detached roots', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const scene = new THREE.Scene();
  const layer = new THREE.Group();
  layer.renderOrder = 3;
  const group = new TextGroup({ renderOrder: 20 });
  const before = new Text({ font, text: 'earlier sibling', style: { fontSize: 16, color: '#f97316' } });
  const label = new Text({
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
    const sourceGlyphOrders = group.children
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
    loader.dispose();
  }
});

test('Text.breakApart preserves per-span material routing with independently owned instances', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const namedMaterial = (name) =>
    defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      material.name = name;
      return material;
    });
  const base = namedMaterial('detached-base');
  const accent = namedMaterial('detached-accent');
  const scene = new THREE.Scene();
  const label = new Text({
    font,
    text: 'AB',
    material: base,
    spans: [{ start: 1, end: 2, material: accent }],
  });
  scene.add(label);
  scene.updateMatrixWorld(true);

  let detached;
  try {
    const sourceNames = new Set(label.children.filter((child) => child.isMesh).map((draw) => draw.material.name));
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
    loader.dispose();
  }
});

test('one portable request returns typed resources for every declared technique', async () => {
  const [bitmapFont, msdfFont, slugFont] = await loadFont({ baked: { bytes: await readFile(multiTechniqueFontUrl) } }, [
    { technique: bitmap, options: { strikes: [32] } },
    { technique: msdf },
    { technique: slug },
  ]);
  assert.equal(bitmapFont.font, msdfFont.font);
  assert.equal(msdfFont.font, slugFont.font);
  assert.equal(bitmapFont.technique, bitmap);
  assert.equal(msdfFont.technique, msdf);
  assert.equal(slugFont.technique, slug);
  bitmapFont.dispose();
  msdfFont.dispose();
  slugFont.dispose();
});

test('Three carries supported text effects into MSDF lanes and rejects them for unsupported techniques', async () => {
  const bytes = await readFile(multiTechniqueFontUrl);
  const loader = new FontLoader();
  const [bitmapFont, msdfFont, slugFont] = await loader.loadFontsAsync({ baked: dataUrl(bytes) }, [
    { technique: bitmap, options: { strikes: [32] } },
    { technique: msdf },
    { technique: slug },
  ]);
  const effectStyle = {
    fontSize: 32,
    color: '#00ff00',
    opacity: 0.5,
    outline: { color: '#ff000080', width: 2 },
    shadow: { color: '#0000ff80', offset: [3, 4] },
  };
  assert.throws(() => new Text({ font: bitmapFont, text: 'A', style: effectStyle }), /pmndrs\.bitmap.*outline/);
  assert.throws(() => new Text({ font: slugFont, text: 'A', style: effectStyle }), /pmndrs\.slug.*outline/);

  const scene = new THREE.Scene();
  const group = new TextGroup();
  const label = new Text({
    font: msdfFont,
    text: { text: 'A', spans: [{ start: 0, end: 1, style: { fontSize: 24 } }] },
    style: effectStyle,
  });
  try {
    group.add(label);
    scene.add(group);
    scene.updateMatrixWorld(true);
    assert.equal(label.error, undefined);
    const draw = group.children.find((child) => child.isMesh);
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
    loader.dispose();
  }
});

test('Three font loading rejects malformed arguments before starting LoadingManager work', async () => {
  const manager = new THREE.LoadingManager();
  let starts = 0;
  manager.onStart = () => {
    starts += 1;
  };
  const loader = new FontLoader(manager);
  const input = { baked: 'data:model/gltf-binary;base64,' };

  assert.throws(
    () => loader.load({ input, raster: { technique: msdf }, retry: true }, () => {}),
    /only accepts input, raster, and signal/,
  );
  await assert.rejects(loader.loadAsync({ input, raster: { technique: bitmap } }), /options/);
  await assert.rejects(loader.loadFontsAsync(input, []), /at least one raster technique/);
  await assert.rejects(loader.loadFontsAsync(input, [{ technique: msdf }], { retry: true }), /only accept signal/);
  assert.equal(starts, 0);
  loader.dispose();
});

test('Three domain ownership follows immutable variants across loaders and user-font disposal', async () => {
  const library = createFontLibrary();
  const firstLoader = new FontLoader(undefined, { library });
  const secondLoader = new FontLoader(undefined, { library });
  const request = {
    input: { baked: { bytes: await readFile(fontUrl) } },
    raster: { technique: bitmap, options: { strikes: [16] } },
  };
  const [first, second] = await Promise.all([firstLoader.loadAsync(request), secondLoader.loadAsync(request)]);
  assert.notEqual(first, second, 'each caller owns an independent Font lease');
  assert.deepEqual(threeEngineDomainReport(), { active: true, loaders: 2, fonts: 1, leases: 0 });

  const label = new Text({ font: second, text: 'retained' });
  first.dispose();
  firstLoader.dispose();
  secondLoader.dispose();
  second.dispose();
  assert.ok(label.measure().glyphCount > 0, 'a live Text retains everything needed after loader and Font disposal');
  assert.deepEqual(threeEngineDomainReport(), { active: true, loaders: 0, fonts: 1, leases: 2 });

  label.dispose();
  library.dispose();
  assert.deepEqual(threeEngineDomainReport(), { active: false, loaders: 0, fonts: 0, leases: 0 });
});

test('Three Text and TextGroup late-bind, synchronize, reparent, and dispose through the scene graph', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const emptyScene = new THREE.Scene();
  const initiallyEmpty = new Text({ font, text: '' });
  emptyScene.add(initiallyEmpty);
  emptyScene.updateMatrixWorld(true);
  assert.equal(initiallyEmpty.error, undefined, 'an empty paragraph must publish without a no-op text mutation');
  initiallyEmpty.text = 'A';
  emptyScene.updateMatrixWorld(true);
  assert.equal(initiallyEmpty.error, undefined, 'an initially empty paragraph must accept its first text edit');
  assert.equal(initiallyEmpty.measure().glyphCount, 1);
  initiallyEmpty.dispose();

  const editedSpans = new Text({
    font,
    text: 'ABCD',
    spans: [
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 2, end: 4, style: { color: '#00ff00' } },
    ],
  });
  // Text and its spans are authored together. A caller that changes the string states the ranges
  // that string has, and `set` still derives the narrow engine edit from the two strings.
  editedSpans.set({
    text: 'AXBYCD',
    spans: [
      { start: 0, end: 3, style: { color: '#ff0000' } },
      { start: 4, end: 6, style: { color: '#00ff00' } },
    ],
  });
  assert.deepEqual(
    editedSpans.spans.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ],
    'authored ranges are stored as authored when every boundary is already a cluster boundary',
  );
  editedSpans.set({
    text: 'ACD',
    spans: [
      { start: 0, end: 1, style: { color: '#ff0000' } },
      { start: 1, end: 3, style: { color: '#00ff00' } },
    ],
  });
  assert.equal(editedSpans.text, 'ACD');
  assert.deepEqual(
    editedSpans.spans.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ],
  );
  // Stating `text` without `spans` clears them: replacement text carries its own formatting, and
  // retaining the previous ranges would reinterpret them against unrelated text.
  editedSpans.text = 'ACD!';
  assert.deepEqual(editedSpans.spans, []);
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
  assert.equal(group.error, undefined);
  const firstDraws = group.children.filter((child) => child.isMesh);
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
  assert.equal(group.children.filter((child) => child.isMesh)[0], firstDraws[0]);

  const displayedGlyphs = label.measureGlyphs();
  assert.equal(displayedGlyphs?.length, measurement.glyphCount);
  assert.ok(displayedGlyphs?.every((entry) => entry.drawnOrigin.equals(entry.shapedOrigin)));
  assert.ok(displayedGlyphs?.[0].localAdvanceBounds.getSize(new THREE.Vector3()).x > 0);

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
  assert.ok(group.children.some((child) => child.isMesh));
  assert.equal(group.children.filter((child) => child.isMesh)[0], firstDraws[0]);
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
  assert.equal(label.bound, false);
  assert.equal(label.textGroup, undefined);

  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.bound, true, 'text retained by a disposed group can bind elsewhere');

  // Typography tier: first-line indent shifts the pen and the measured width;
  // paragraph spacing shifts the first baseline and carries in the block extent.
  const plainShort = new Text({ font, text: 'Whisper' });
  const indented = new Text({ font, text: 'Whisper', layout: { firstLineIndent: 30 } });
  const spaced = new Text({ font, text: 'Whisper', layout: { spaceBefore: 8, spaceAfter: 6 } });
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
  const natural = new Text({
    font,
    text: 'pack my box',
    constraints: justifyConstraints,
    layout: justifyLayout(undefined, 'auto'),
  });
  const filled = new Text({
    font,
    text: 'pack my box',
    constraints: justifyConstraints,
    layout: justifyLayout(undefined, 'justify'),
  });
  const capped = new Text({
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
  const reference = new Text({
    font,
    text: columnText,
    constraints: { width: { mode: 'exact', size: columnMeasureWidth } },
  });
  scene.add(reference);
  scene.updateMatrixWorld();
  const referenceMeasure = reference.measure();
  assert.ok(referenceMeasure.lineCount >= 4, 'the fixture text must wrap well past two lines at the column measure');
  const columnHeight = Math.ceil(referenceMeasure.contentHeight * 0.6);
  const twoColumns = new Text({
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
    () => new Text({ font, text: columnText, layout: { columns: { count: 2 } } }),
    /columns/,
    'columns without an exact width must be rejected',
  );
  assert.throws(
    () =>
      new Text({
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
  loader.dispose();
});

test('renderer rejection waits for explicit invalidation and then checkpoints without copied bytes', async (t) => {
  const copyPublication = PlanTransport.prototype.copyPublication;
  let publicationCopies = 0;
  PlanTransport.prototype.copyPublication = function (publication) {
    publicationCopies += 1;
    return copyPublication.call(this, publication);
  };
  t.after(() => {
    PlanTransport.prototype.copyPublication = copyPublication;
  });
  const instrumented = await createInstrumentedEngine();
  const fontDomain = instrumented.fontDomain;
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  let failMaterial = true;
  let label;
  const material = defineTextMaterial((context) => {
    if (failMaterial) {
      assert.throws(() => label.measure(), /cannot reenter Three render-plan application/u);
      throw new Error('deliberate material realization failure');
    }
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const group = new TextGroup();
  label = new Text({ font, material, text: 'Retry me' });
  const errors = [];
  group.onError = (error) => errors.push(error);
  group.add(label);
  scene.add(group);

  scene.updateMatrixWorld();
  assert.match(String(group.error), /deliberate material realization failure/u);
  assert.equal(label.error, group.error, 'group-owned failures must remain visible from the child Text');
  assert.equal(instrumented.crossings, 1);
  const rejectedGeneration = instrumented.latestUpdateGeneration;
  assert.equal(group.children.filter((child) => child.isMesh).length, 0);
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
  assert.equal(group.children.filter((child) => child.isMesh).length, 0);

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
  assert.equal(publicationCopies, 0, 'Three must not copy a borrowed publication for renderer recovery');
  assert.equal(errors.length, 1, 'a successful checkpoint must not repeat the old failure');
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);

  label.text = 'New input after recovery';
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  assert.equal(label.error, undefined);
  assert.equal(instrumented.crossings, 3, 'new input after recovery must publish normally');
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);

  group.dispose();
  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('a rejected fixed-capacity candidate releases its provisional font-stack lease', async (t) => {
  const registerFontStack = GlyphBackend.prototype.registerFontStack;
  const disposeFontStack = GlyphBackend.prototype.disposeFontStack;
  let registrations = 0;
  let disposals = 0;
  GlyphBackend.prototype.registerFontStack = function (...args) {
    registrations += 1;
    return registerFontStack.apply(this, args);
  };
  GlyphBackend.prototype.disposeFontStack = function (...args) {
    disposals += 1;
    return disposeFontStack.apply(this, args);
  };
  t.after(() => {
    GlyphBackend.prototype.registerFontStack = registerFontStack;
    GlyphBackend.prototype.disposeFontStack = disposeFontStack;
  });

  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const label = new Text({ font, text: 'over budget', capacity: { size: 1, policy: 'fixed' } });
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

test('TextGroup drops disposed descendants and reuses their committed transform identities', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
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

  const draw = group.children.find((child) => child.isMesh);
  assert.equal(draw.geometry.instanceCount, 1);
  group.dispose();
  survivor.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('Three retires materials bound to a replaced buffer generation', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
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
  fontDomain.dispose();
});

test('one Rust plan partitions a mixed Bitmap to Slug fallback stack', async () => {
  const fontDomain = createThreeFontDomain();
  const [latin, icon] = await Promise.all([
    fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, { technique: bitmap, options: { strikes: [16] } }),
    fontDomain.loadFont(
      { baked: dataUrl(gunzipSync(await readFile(iconSlugFontUrl))) },
      { technique: slug, options: {} },
    ),
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

test('TextGroup realizes two public Text objects as one indexed Rust draw', async () => {
  const instrumented = await createInstrumentedEngine();
  const fontDomain = instrumented.fontDomain;
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
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
  assert.equal(transforms.version, version, 'moving the shared root must not upload unchanged relative transforms');
  assert.equal(forcedTextWorldUpdates, 0, 'moving the shared root must not force each Text world matrix a second time');

  right.position.x = 7;
  scene.updateMatrixWorld();
  assert.equal(group.children.filter((child) => child.isMesh)[0], draws[0]);
  assert.equal(transforms.version, version + 1);
  assert.equal(transforms.array[2 * 16 + 12], 7);
  assert.equal(forcedTextWorldUpdates, 0, 'the normal Three traversal supplies current matrices to transform patches');

  const nestedParent = new THREE.Group();
  group.add(nestedParent);
  nestedParent.add(right);
  nestedParent.position.x = 3;
  scene.updateMatrixWorld();
  assert.equal(transforms.array[2 * 16 + 12], 10, 'nested parent motion patches only the affected transform path');
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
  const replacedDraws = group.children.filter((child) => child.isMesh);
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
    group.children.find((child) => child.isMesh),
    replacedDraws[0],
    'the live TextGroup draw remains installed after a detached copy',
  );
  leftDetached.dispose();

  group.dispose();
  left.dispose();
  right.dispose();
  font.dispose();
  fontDomain.dispose();
});

async function createInstrumentedEngine() {
  const abi = textShaperAbi;
  const originalInstantiate = WebAssembly.instantiate;
  let crossings = 0;
  let measureCrossings = 0;
  let latestRequest;
  let latestUpdateFlags = 0;
  let latestUpdateGeneration = 0;
  WebAssembly.instantiate = async (source, imports) => {
    const instance = await originalInstantiate(source, imports);
    const exports = { ...instance.exports };
    const update = exports[abi.functions.textUpdate];
    assert.equal(typeof update, 'function', 'instrumented shaper must export text_update');
    exports[abi.functions.textUpdate] = (...arguments_) => {
      crossings += 1;
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
  const fontDomain = createThreeFontDomain(async (load) => {
    try {
      return await load();
    } finally {
      restore();
    }
  }, restore);
  return {
    fontDomain,
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

test('Text.measure answers attached first-frame state without traversing matrices or realizing draws', async () => {
  const instrumented = await createInstrumentedEngine();
  const font = await instrumented.fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const first = new Text({
    font,
    text: 'measure me before the frame',
    constraints: { width: { mode: 'exact', size: 180 } },
  });
  const second = new Text({ font, text: 'and me too' });
  first.position.set(12, 34, 0);
  second.position.set(56, 78, 0);

  assert.ok(first.measure().glyphCount > 0, 'detached Text measurement needs no matrix or render attachment');
  assert.deepEqual(first.commitState(), { status: 'unbound' });
  group.add(first, second);
  scene.add(group);
  const matricesBefore = [first, second, group, scene].map((object) => Array.from(object.matrix.elements));
  instrumented.reset();

  const firstMeasurement = first.measure();
  const secondMeasurement = second.measure();
  assert.ok(firstMeasurement.lineCount > 0);
  assert.ok(secondMeasurement.glyphCount > 0);
  assert.equal(firstMeasurement.inkBounds, undefined, 'the fast measurement path does not position glyph ink');
  assert.equal(instrumented.crossings, 0, 'measurement must not publish a full engine frame');
  assert.equal(instrumented.measureCrossings, 2, 'each new paragraph uses one scoped query');
  assert.equal(group.gpuBytes, 0, 'measurement must not realize renderer buffers');
  assert.equal(group.children.length, 2, 'measurement must not add renderer draw objects');
  for (const [index, object] of [first, second, group, scene].entries()) {
    assert.deepEqual(object.matrix.elements, matricesBefore[index], 'measurement must not update local matrices');
  }
  assert.deepEqual(first.commitState(), { status: 'pending' });
  assert.deepEqual(second.commitState(), { status: 'pending' });

  scene.updateMatrixWorld(true);
  assert.equal(group.error, undefined);
  assert.equal(instrumented.crossings, 1, 'the first traversal publishes exactly one full frame');
  assert.equal(
    instrumented.latestUpdateFlags & textShaperAbi.engine.resultFlags.checkpoint,
    textShaperAbi.engine.resultFlags.checkpoint,
    "the planner's first render plan is necessarily its initial checkpoint",
  );
  assert.equal(instrumented.measureCrossings, 2, 'publication must not repeat the host measurement query');
  assert.equal(first.commitState().status, 'committed');
  assert.equal(second.commitState().status, 'committed');
  assert.equal(first.boundingBox.isEmpty(), false, 'the first positioned publication must install ink bounds');
  assert.ok(first.boundingBox.max.x > first.boundingBox.min.x);
  assert.ok(first.boundingBox.max.y > first.boundingBox.min.y);
  assert.equal(
    instrumented.measureCrossings,
    2,
    'reading first-frame bounds must reuse the measurement published beside the render plan',
  );

  group.dispose();
  first.dispose();
  second.dispose();
  font.dispose();
  instrumented.fontDomain.dispose();
});

test('standalone Text.measure creates only its implicit measurement batch before traversal', async () => {
  const instrumented = await createInstrumentedEngine();
  const font = await instrumented.fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const label = new Text({ font, text: 'standalone first-frame measurement' });
  label.position.set(19, 23, 0);
  scene.add(label);
  const matricesBefore = [label, scene].map((object) => Array.from(object.matrix.elements));
  instrumented.reset();

  assert.ok(label.measure().glyphCount > 0);
  assert.equal(instrumented.crossings, 0);
  assert.equal(instrumented.measureCrossings, 1);
  const inspection = label.glyphs();
  assert.ok(inspection.inkBounds, 'explicit positioned inspection provides pre-frame ink bounds');
  assert.equal(instrumented.measureCrossings, 2);
  assert.equal(label.boundingBox.isEmpty(), false);
  assert.equal(instrumented.measureCrossings, 2, 'the Three box reuses the positioned inspection');
  assert.equal(label.gpuBytes, 0);
  assert.equal(label.children.length, 0);
  for (const [index, object] of [label, scene].entries()) {
    assert.deepEqual(object.matrix.elements, matricesBefore[index], 'measurement must not update local matrices');
  }
  assert.deepEqual(label.commitState(), { status: 'pending' });

  scene.updateMatrixWorld(true);
  assert.equal(instrumented.crossings, 1);
  assert.equal(instrumented.measureCrossings, 2, 'publication adopts the explicit queries instead of repeating them');
  assert.equal(label.commitState().status, 'committed');

  label.dispose();
  font.dispose();
  instrumented.fontDomain.dispose();
});

test('Bitmap strike changes fully initialize a replacement indexed batch', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(densityFontUrl)) },
    { technique: bitmap, options: { strikes: [16, 32] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const label = new Text({
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
  const initialDraw = group.children.find((child) => child.isMesh);
  assert.ok(initialDraw);
  const initialStart = initialDraw.userData.pmndrsGlyphRunStart;
  const initialOrigins = initialDraw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id)).array;
  const initialAdvance = initialOrigins[(initialStart + 1) * 2] - initialOrigins[initialStart * 2];

  label.style = { ...label.style, fontSize: 16 };
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'crossing from the 16 ppem strike to 32 ppem must publish successfully');
  const draw = group.children.find((child) => child.isMesh);
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

test('multi-page Bitmap strikes remain one ordered texture-array draw', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(densityFontUrl)) },
    { technique: bitmap, options: { strikes: [16, 32] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const label = new Text({
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
  const draws = group.children.filter((child) => child.isMesh);
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

test('Rust ellipsis reshapes only the narrowed unsafe line boundary', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(amiriFontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const text = 'مرحبا بالعالم';

  const scene = new THREE.Scene();
  const label = new Text({
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

test('TextGroup atomically replaces child paragraphs without multiplying retained text capacity', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
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
  fontDomain.dispose();
});

test('TextGroup grows aggregate glyph storage without reserving one aggregate-sized paragraph', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup({ capacity: { size: 4_096, policy: 'chunk' } });
  const labels = Array.from({ length: 684 }, (_, index) => new Text({ font, text: `icon-${String(index)}` }));
  group.add(...labels);
  scene.add(group);
  scene.updateMatrixWorld();

  assert.equal(group.error, undefined);
  assert.equal(group.textCount, labels.length);
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);

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
test('repeated layout under changing constraints stays on the paragraph query path', async () => {
  const abi = textShaperAbi;
  const instrumented = await createInstrumentedEngine();
  const font = await instrumented.fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const label = new Text({
    font,
    text: 'alpha beta gamma delta',
    constraints: { width: { mode: 'exact', size: 300 } },
  });
  scene.add(label);
  scene.updateMatrixWorld(true);
  assert.equal(label.error, undefined);
  const committedGeneration = instrumented.latestUpdateGeneration;
  instrumented.reset();

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
  assert.equal(instrumented.crossings, 0, 'measurement never drives a full engine update');
  assert.equal(instrumented.measureCrossings, widths.length, 'each constraint change measures through one query');
  assert.equal(
    instrumented.latestUpdateGeneration,
    committedGeneration,
    'queries never flip the publication generation',
  );

  scene.updateMatrixWorld(true);
  assert.equal(label.error, undefined);
  assert.equal(instrumented.crossings, 1, 'one ordinary frame commits the final constraint');
  assert.equal(
    instrumented.latestUpdateFlags & abi.engine.resultFlags.checkpoint,
    0,
    'the committing frame proceeds from pre-layout revisions without a checkpoint rebuild',
  );
  assert.equal(label.measure().contentWidth <= 240 + 1e-3, true);
  label.dispose();
  font.dispose();
  instrumented.fontDomain.dispose();
});

test('a standard ligature that absorbs a grapheme publishes and keeps typing', async () => {
  // A ligature reports one glyph at the first grapheme of the pair, so the trailing
  // grapheme's cluster owns no glyph. It still belongs to the shaped run and positioning
  // still derives a scale for it, so the cluster arena must record the owning font's
  // units-per-em for it as well. Amiri applies `liga` to Latin f-pairs; Inter as baked
  // does not, which is why every existing Latin fixture missed this.
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(amiriFontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  const text = new Text({
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
  const loader = new FontLoader();
  let initial = true;
  return {
    loadFont(input, raster) {
      const load = () =>
        Array.isArray(raster) ? loader.loadFontsAsync(input, raster) : loader.loadAsync({ input, raster });
      if (!initial || firstLoad === undefined) return load();
      initial = false;
      return firstLoad(load);
    },
    dispose() {
      onDispose();
      loader.dispose();
    },
  };
}

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
