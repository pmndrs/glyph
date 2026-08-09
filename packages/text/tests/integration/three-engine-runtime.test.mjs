import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { validateFontArtifact } from '@pmndrs/text-font-baker/validate';
import * as THREE from 'three/webgpu';

import { validateBitmapArtifact } from '../../dist/bakers/bitmap-validator.js';
import { validateMsdfArtifact } from '../../dist/bakers/msdf-validator.js';
import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';
import { compileTextEngineFrameUpdate } from '../../dist/internal/engine-frame-wire.js';
import { TextEngineRenderPlanView } from '../../dist/internal/render-plan-view.js';
import { FontRegistry } from '../../dist/loader.js';
import { bitmap, bitmapDescriptor } from '../../dist/raster/bitmap-technique.js';
import { msdf, msdfDescriptor } from '../../dist/raster/msdf.js';
import { defineRasterResourceId } from '../../dist/raster-technique.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { ThreeTextEngineCoordinator } from '../../dist/three/engine-runtime.js';
import { ThreeTextEnginePlanTarget } from '../../dist/three/engine-plan-target.js';

const fixtureRoot = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);
const wasmUrl = new URL('../../dist/text_shaper.wasm', import.meta.url);

test('Three coordinator shares shaping data across technique bindings and reference-counts stack handles', async () => {
  const [bitmapBytes, compressedMsdf, wasm] = await Promise.all([
    readFile(new URL('inter-bitmap-16.font.glb', fixtureRoot)),
    readFile(new URL('inter-mtsdf.font.glb.gz', fixtureRoot)),
    readFile(wasmUrl),
  ]);
  const msdfBytes = gunzipSync(compressedMsdf);
  const [bitmapCore, msdfCore] = await Promise.all([
    validateFontArtifact(bitmapBytes),
    validateFontArtifact(msdfBytes),
  ]);
  assert.equal(bitmapCore.shapingHash, msdfCore.shapingHash);
  const registry = new FontRegistry();
  const registered = await registry.registerAsset(bitmapBytes);
  const shaper = await createRuntimeShaper({ registry, wasm });
  shaper.registerFont(registered);
  const bitmapRaster = await validateBitmapArtifact(bitmapBytes, {
    descriptor: bitmapDescriptor({ strikes: [16] }),
    rasterKey: bitmapCore.document.extensions.PMNDRS_font.rasters[0].rasterKey,
    shapingHash: bitmapCore.shapingHash,
    glyphCount: bitmapCore.glyphCount,
    glyphIdWidth: 16,
  });
  const msdfRaster = await validateMsdfArtifact(msdfBytes, {
    descriptor: msdfDescriptor(),
    rasterKey: msdfCore.document.extensions.PMNDRS_font.rasters[0].rasterKey,
    shapingHash: msdfCore.shapingHash,
    glyphCount: msdfCore.glyphCount,
    glyphIdWidth: 16,
  });
  const bitmapFont = {
    runtime: undefined,
    font: registered,
    technique: bitmap,
    raster: undefined,
    data: {
      strikes: bitmapRaster.strikes.map((strike, strikeIndex) => ({
        ...strike,
        pages: strike.pages.map((page, pageIndex) => ({
          ...page,
          format: 'r8unorm',
          resource: defineRasterResourceId(`coordinator.bitmap.${strikeIndex}.${pageIndex}`),
        })),
        bindings: [],
      })),
    },
    disposed: false,
  };
  const extension = msdfRaster.document.extensions.PMNDRS_font_distance_field;
  const msdfFont = {
    runtime: undefined,
    font: registered,
    technique: msdf,
    raster: undefined,
    data: {
      resource: defineRasterResourceId('coordinator.mtsdf'),
      binding: {},
      emSize: extension.emSize,
      pixelRange: extension.pixelRange,
      planeUnitsPerEm: extension.planeUnitsPerEm,
      records: msdfRaster.records,
      pages: msdfRaster.pages,
    },
    disposed: false,
  };
  const coordinator = new ThreeTextEngineCoordinator({ shaper });
  const first = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  const bitmapReference = coordinator.host.wireIdentities.resolve(bitmapFont.data.strikes[0].pages[0].resource);
  const msdfReference = coordinator.host.wireIdentities.resolve(msdfFont.data.resource);
  assert.equal(coordinator.resolveResource(bitmapReference).technique, bitmap.id);
  assert.equal(coordinator.resolveResource(msdfReference).technique, msdf.id);
  const shared = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  const reversed = coordinator.acquireFontStack([msdfFont, bitmapFont]);
  assert.equal(shared.handle, first.handle);
  assert.notEqual(reversed.handle, first.handle, 'fallback order is part of stack identity');
  const session = coordinator.createSession({ requestCapacity: 4_096, resultCapacity: 1024 * 1024, textCapacity: 16 });
  const publication = session.update(
    compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: coordinator.policyHandle,
      capabilitySet: 1,
      expectedEngineRevision: 0,
      consumedPlanRevision: 0,
      acknowledgedPublicationGeneration: 0,
      limits: {
        maxParagraphs: 2,
        maxClusters: 16,
        maxLines: 8,
        maxRegions: 2,
        maxExclusions: 1,
        maxInlineObjects: 1,
        maxSlotsPerBand: 2,
        maxOutputBytes: 1024 * 1024,
      },
      paragraphMutations: [
        { opcode: 'upsert', paragraphId: 1, order: 0 },
        { opcode: 'upsert', paragraphId: 2, order: 1 },
      ],
      textMutations: [
        { paragraphId: 1, start: 0, deleteCount: 0, insert: 'abc' },
        { paragraphId: 2, start: 0, deleteCount: 0, insert: 'def' },
      ],
      styleMutations: [
        {
          opcode: 'upsert',
          paragraphId: 1,
          styleId: 1,
          cascadeOrder: 0,
          start: 0,
          end: 3,
          root: true,
          value: {
            fontStackHandle: first.handle,
            materialId: 7,
            fontSize: 16,
            rasterPixelRatio: 1,
            foregroundRgba: 0xffff_ffff,
          },
        },
        {
          opcode: 'upsert',
          paragraphId: 2,
          styleId: 1,
          cascadeOrder: 0,
          start: 0,
          end: 3,
          root: true,
          value: {
            fontStackHandle: first.handle,
            materialId: 8,
            fontSize: 16,
            rasterPixelRatio: 1,
            foregroundRgba: 0xffff_ffff,
          },
        },
      ],
      constraints: [
        {
          paragraphId: 1,
          flowThreadId: 1,
          geometryRevision: 1,
          width: 256,
          height: 128,
          viewportBlockStart: 0,
          viewportBlockEnd: 128,
          resumeBlockOffset: 0,
          maxLines: 8,
          regionStart: 0,
          resumeCluster: 0,
          regionCount: 1,
          resumeRegion: 0,
          widthMode: 'at-most',
          heightMode: 'at-most',
          wrap: 'word',
          align: 'start',
          overflow: 'visible',
          blockAlign: 'start',
        },
        {
          paragraphId: 2,
          flowThreadId: 2,
          geometryRevision: 1,
          width: 256,
          height: 128,
          viewportBlockStart: 0,
          viewportBlockEnd: 128,
          resumeBlockOffset: 0,
          maxLines: 8,
          regionStart: 1,
          resumeCluster: 0,
          regionCount: 1,
          resumeRegion: 0,
          widthMode: 'at-most',
          heightMode: 'at-most',
          wrap: 'word',
          align: 'start',
          overflow: 'visible',
          blockAlign: 'start',
        },
      ],
      regions: [
        {
          id: 1,
          geometryRevision: 1,
          shape: 'rectangle',
          exclusionStart: 0,
          exclusionCount: 0,
          writingMode: 'horizontal-tb',
          textOrientation: 'mixed',
          inlineStart: 0,
          blockStart: 0,
          inlineEnd: 256,
          blockEnd: 128,
          clipInlineStart: 0,
          clipBlockStart: 0,
          clipInlineEnd: 256,
          clipBlockEnd: 128,
        },
        {
          id: 2,
          geometryRevision: 1,
          shape: 'rectangle',
          exclusionStart: 0,
          exclusionCount: 0,
          writingMode: 'horizontal-tb',
          textOrientation: 'mixed',
          inlineStart: 0,
          blockStart: 0,
          inlineEnd: 256,
          blockEnd: 128,
          clipInlineStart: 0,
          clipBlockStart: 0,
          clipInlineEnd: 256,
          clipBlockEnd: 128,
        },
      ],
    }),
  );
  const plan = new TextEngineRenderPlanView().bind(publication);
  for (const name of ['resources', 'buffers', 'patches', 'primitives', 'draws']) {
    assert.ok(plan.table(name).count > 0, `${name} must come from the Rust publication`);
  }
  const patches = plan.table('patches');
  const firstPatch = plan.record(patches, 0);
  assert.ok(plan.u16(firstPatch) > 0);
  assert.throws(() => plan.record(patches, patches.count), /outside its table/);
  const drawLayout = textShaperAbi.layouts.engineDraw;
  const draws = plan.table('draws');
  assert.equal(draws.count, 2, 'cluster identity must not split compatible paragraph draws');
  assert.deepEqual(
    adjacentMaterialGroups(plan, draws, drawLayout.materialId),
    [7, 8],
    'Rust gathers child paragraphs into one ordered command buffer',
  );
  assert.deepEqual(
    Array.from({ length: draws.count }, (_, index) => plan.u32(plan.record(draws, index) + drawLayout.transformId)),
    [0, 0],
    'draw-level transform is zero when the policy selects indexed transform storage',
  );
  const drawRoot = new THREE.Object3D();
  const paragraphObjects = new Map([
    [1, new THREE.Object3D()],
    [2, new THREE.Object3D()],
  ]);
  paragraphObjects.get(1).position.x = 3;
  paragraphObjects.get(2).position.x = 7;
  const target = new ThreeTextEnginePlanTarget(coordinator, {
    drawRoot,
    renderOrderBase: 10,
    objectForTransform(transformId) {
      const object = paragraphObjects.get(transformId);
      if (object === undefined) throw new Error(`unknown paragraph transform ${transformId}`);
      return object;
    },
  });
  target.apply(publication);
  assert.equal(target.draws.length, 2);
  assert.deepEqual(
    target.draws.map((draw) => draw.parent),
    [drawRoot, drawRoot],
    'indexed draws share one renderer node instead of splitting by scene transform',
  );
  assert.deepEqual(
    target.draws.map((draw) => draw.geometry.instanceCount),
    [3, 3],
  );
  assert.deepEqual(
    target.draws.map((draw) => draw.renderOrder),
    [10, 11],
  );
  const transformIndexAttribute = target.draws[0].geometry.getAttribute('_pmndrsText_15');
  const transformTableAttribute = target.draws[0].geometry.getAttribute('_pmndrsTextTransforms');
  assert.ok(transformIndexAttribute.array instanceof Uint32Array);
  assert.ok(transformTableAttribute.array instanceof Float32Array);
  assert.deepEqual(
    target.draws.map((draw) => transformIndexAttribute.array[draw.userData.pmndrsTextRunStart]),
    [1, 2],
    'Rust packs the renderer sidecar slot once per glyph instance',
  );
  assert.equal(transformTableAttribute.array[1 * 16 + 12], 3);
  assert.equal(transformTableAttribute.array[2 * 16 + 12], 7);
  assert.deepEqual(
    Array.from(transformTableAttribute.array.subarray(16, 32)),
    Array.from(paragraphObjects.get(1).matrixWorld.elements, Math.fround),
  );
  assert.deepEqual(
    Array.from(transformTableAttribute.array.subarray(32, 48)),
    Array.from(paragraphObjects.get(2).matrixWorld.elements, Math.fround),
  );
  const unchangedTransformVersion = transformTableAttribute.version;
  assert.equal(target.syncTransforms(), 0);
  assert.equal(transformTableAttribute.version, unchangedTransformVersion, 'unchanged matrices schedule no upload');
  paragraphObjects.get(1).position.x = 4;
  assert.equal(target.syncTransforms(), 1);
  assert.equal(transformTableAttribute.version, unchangedTransformVersion + 1);
  assert.equal(transformTableAttribute.array[1 * 16 + 12], 4);

  const reorderedPublication = session.update(
    compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: coordinator.policyHandle,
      capabilitySet: 1,
      expectedEngineRevision: publication.engineRevision,
      consumedPlanRevision: publication.planRevision,
      acknowledgedPublicationGeneration: 0,
      limits: {
        maxParagraphs: 2,
        maxClusters: 16,
        maxLines: 8,
        maxRegions: 2,
        maxExclusions: 1,
        maxInlineObjects: 1,
        maxSlotsPerBand: 2,
        maxOutputBytes: 1024 * 1024,
      },
      paragraphMutations: [
        { opcode: 'upsert', paragraphId: 1, order: 1 },
        { opcode: 'upsert', paragraphId: 2, order: 0 },
      ],
    }),
  );
  const reorderedPlan = plan.bind(reorderedPublication);
  const reorderedDraws = reorderedPlan.table('draws');
  assert.equal(reorderedDraws.count, 2);
  assert.deepEqual(
    adjacentMaterialGroups(reorderedPlan, reorderedDraws, drawLayout.materialId),
    [8, 7],
    'lifecycle-only reorder retains both paragraphs and changes shared draw order',
  );
  assert.deepEqual(
    Array.from({ length: reorderedDraws.count }, (_, index) =>
      reorderedPlan.u32(reorderedPlan.record(reorderedDraws, index) + drawLayout.transformId),
    ),
    [0, 0],
  );
  const previousDraws = [...target.draws];
  target.apply(reorderedPublication);
  assert.ok(
    previousDraws.every((draw) => draw.parent === null),
    'superseded command-buffer draws detach',
  );
  assert.deepEqual(
    target.draws.map((draw) => draw.parent),
    [drawRoot, drawRoot],
  );
  assert.deepEqual(
    target.draws.map((draw) => draw.renderOrder),
    [10, 11],
  );
  const coalescedPublication = session.update(
    compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: coordinator.policyHandle,
      capabilitySet: 1,
      expectedEngineRevision: reorderedPublication.engineRevision,
      consumedPlanRevision: reorderedPublication.planRevision,
      acknowledgedPublicationGeneration: 0,
      limits: {
        maxParagraphs: 2,
        maxClusters: 16,
        maxLines: 8,
        maxRegions: 2,
        maxExclusions: 1,
        maxInlineObjects: 1,
        maxSlotsPerBand: 2,
        maxOutputBytes: 1024 * 1024,
      },
      styleMutations: [
        {
          opcode: 'upsert',
          paragraphId: 2,
          styleId: 1,
          cascadeOrder: 0,
          start: 0,
          end: 3,
          root: true,
          value: {
            fontStackHandle: first.handle,
            materialId: 7,
            fontSize: 16,
            rasterPixelRatio: 1,
            foregroundRgba: 0xffff_ffff,
          },
        },
      ],
    }),
  );
  const coalescedPlan = plan.bind(coalescedPublication);
  const coalescedDraws = coalescedPlan.table('draws');
  assert.equal(coalescedDraws.count, 1, 'same-material paragraphs coalesce across indexed transforms');
  assert.equal(coalescedPlan.u32(coalescedPlan.record(coalescedDraws, 0) + drawLayout.transformId), 0);
  target.apply(coalescedPublication);
  assert.equal(target.draws.length, 1);
  assert.equal(target.draws[0].geometry.instanceCount, 6);
  const coalescedTransformIndices = target.draws[0].geometry.getAttribute('_pmndrsText_15').array;
  const coalescedStart = target.draws[0].userData.pmndrsTextRunStart;
  assert.deepEqual(
    Array.from(coalescedTransformIndices.subarray(coalescedStart, coalescedStart + 6)),
    [2, 2, 2, 1, 1, 1],
  );
  assert.ok(target.gpuBytes > 0);
  target.dispose();
  session.dispose();
  first.release();
  first.release();
  const stillShared = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  assert.equal(stillShared.handle, shared.handle, 'one outstanding lease must retain the stack');
  shared.release();
  stillShared.release();
  const replacement = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  assert.notEqual(replacement.handle, first.handle, 'a retired stack handle is not immediately reused');
  replacement.release();
  reversed.release();
  coordinator.dispose();
  assert.throws(() => coordinator.acquireFontStack([bitmapFont]), /disposed/);
  shaper.dispose();
  registered.dispose();
});

function adjacentMaterialGroups(plan, draws, materialOffset) {
  const groups = [];
  for (let index = 0; index < draws.count; index += 1) {
    const material = plan.u32(plan.record(draws, index) + materialOffset);
    if (groups.at(-1) !== material) groups.push(material);
  }
  return groups;
}
