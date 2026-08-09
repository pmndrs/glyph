import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { validateFontArtifact } from '@pmndrs/text-font-baker/validate';
import { read as readKtx2 } from 'ktx-parse';
import * as THREE from 'three/webgpu';

import { validateBitmapArtifact } from '../../dist/bakers/bitmap-validator.js';
import { validateMsdfArtifact } from '../../dist/bakers/msdf-validator.js';
import { validateSlugArtifact } from '../../dist/bakers/slug-validator.js';
import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';
import { compileTextEngineFrameUpdate } from '../../dist/internal/engine-frame-wire.js';
import { firstPartyThreeRenderPolicyBytes } from '../../dist/internal/render-policy-wire.js';
import { TextEngineRenderPlanView } from '../../dist/internal/render-plan-view.js';
import { FontRegistry } from '../../dist/loader.js';
import { bitmap, bitmapDescriptor } from '../../dist/raster/bitmap-technique.js';
import { msdf, msdfDescriptor } from '../../dist/raster/msdf.js';
import { defineRasterResourceId } from '../../dist/raster-technique.js';
import { slug, slugDescriptor } from '../../dist/raster/slug-technique.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { ThreeTextEngineCoordinator } from '../../dist/three/engine-runtime.js';
import { ThreeTextEnginePlanTarget } from '../../dist/three/engine-plan-target.js';
import { defineTextMaterial } from '../../dist/three/material.js';

const fixtureRoot = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);
const wasmUrl = new URL('../../dist/text_shaper.wasm', import.meta.url);

test('Three coordinator shares shaping data across technique bindings and reference-counts stack handles', async () => {
  const [bitmapBytes, compressedMsdf, compressedSlug, wasm] = await Promise.all([
    readFile(new URL('inter-bitmap-16.font.glb', fixtureRoot)),
    readFile(new URL('inter-mtsdf.font.glb.gz', fixtureRoot)),
    readFile(new URL('inter-slug.font.glb.gz', fixtureRoot)),
    readFile(wasmUrl),
  ]);
  const msdfBytes = gunzipSync(compressedMsdf);
  const slugBytes = gunzipSync(compressedSlug);
  const [bitmapCore, msdfCore, slugCore] = await Promise.all([
    validateFontArtifact(bitmapBytes),
    validateFontArtifact(msdfBytes),
    validateFontArtifact(slugBytes),
  ]);
  assert.equal(bitmapCore.shapingHash, msdfCore.shapingHash);
  assert.equal(bitmapCore.shapingHash, slugCore.shapingHash);
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
  const slugRaster = await validateSlugArtifact(slugBytes, {
    descriptor: slugDescriptor(),
    rasterKey: slugCore.document.extensions.PMNDRS_font.rasters[0].rasterKey,
    shapingHash: slugCore.shapingHash,
    glyphCount: slugCore.glyphCount,
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
      binding: {
        width: Math.max(...msdfRaster.pages.map((page) => page.width)),
        height: Math.max(...msdfRaster.pages.map((page) => page.height)),
        layers: msdfRaster.pages.length,
      },
      emSize: extension.emSize,
      pixelRange: extension.pixelRange,
      planeUnitsPerEm: extension.planeUnitsPerEm,
      records: msdfRaster.records,
      pages: msdfRaster.pages,
    },
    disposed: false,
  };
  const slugExtension = slugRaster.document.extensions.PMNDRS_font_slug;
  const slugFont = {
    runtime: undefined,
    font: registered,
    technique: slug,
    raster: undefined,
    data: {
      planeUnitsPerEm: slugExtension.planeUnitsPerEm,
      records: slugRaster.records,
      pages: slugRaster.pages.map((page, pageIndex) => ({
        resource: defineRasterResourceId(`coordinator.slug.${pageIndex}`),
        curveWidth: page.curveWidth,
        curveHeight: page.curveHeight,
        curveBytes: readKtx2(page.curve.bytes).levels[0].levelData.slice(),
        headerCount: page.headerCount,
        headerWidth: page.headerWidth,
        headerHeight: page.headerHeight,
        headerBytes: page.headers.bytes.slice(),
        referenceCount: page.referenceCount,
        referenceWidth: page.referenceWidth,
        referenceHeight: page.referenceHeight,
        referenceBytes: page.references.bytes.slice(),
      })),
      bindings: [],
    },
    disposed: false,
  };
  const coordinator = new ThreeTextEngineCoordinator({ shaper });
  const materialCalls = [];
  const primaryMaterial = coordinator.acquireMaterial(
    defineTextMaterial((context) => {
      materialCalls.push(`primary:${context.technique}`);
      const material = context.createDefaultMaterial();
      material.depthTest = true;
      return material;
    }),
  );
  const secondaryMaterial = coordinator.acquireMaterial(
    defineTextMaterial((context) => {
      materialCalls.push(`secondary:${context.technique}`);
      return context.createDefaultMaterial();
    }),
  );
  const first = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  const bitmapReference = coordinator.host.wireIdentities.resolve(bitmapFont.data.strikes[0].pages[0].resource);
  const msdfReference = coordinator.host.wireIdentities.resolve(msdfFont.data.resource);
  assert.equal(coordinator.resolveResource(bitmapReference).technique, bitmap.id);
  assert.equal(coordinator.resolveResource(msdfReference).technique, msdf.id);
  const shared = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  const reversed = coordinator.acquireFontStack([msdfFont, bitmapFont]);
  const slugFirst = coordinator.acquireFontStack([slugFont, msdfFont, bitmapFont]);
  assert.equal(shared.handle, first.handle);
  assert.notEqual(reversed.handle, first.handle, 'fallback order is part of stack identity');
  const session = coordinator.createSession({ requestCapacity: 4_096, resultCapacity: 1024 * 1024, textCapacity: 16 });
  const initialRequest = compileTextEngineFrameUpdate({
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
          materialId: primaryMaterial.id,
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
          materialId: secondaryMaterial.id,
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
  });
  const publication = session.update(initialRequest);
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
    [primaryMaterial.id, secondaryMaterial.id],
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
  assert.equal(target.draws[0].material.depthTest, true);
  assert.deepEqual(materialCalls, ['primary:pmndrs.bitmap', 'secondary:pmndrs.bitmap']);
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
    [secondaryMaterial.id, primaryMaterial.id],
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
  assert.equal(target.draws[0], previousDraws[1], 'reorder retains the secondary draw object');
  assert.equal(target.draws[1], previousDraws[0], 'reorder retains the primary draw object');
  assert.deepEqual(
    target.draws.map((draw) => draw.parent),
    [drawRoot, drawRoot],
  );
  assert.deepEqual(
    target.draws.map((draw) => draw.renderOrder),
    [10, 11],
  );
  const reorderedTargetDraws = [...target.draws];
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
            materialId: primaryMaterial.id,
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
  assert.equal(target.draws[0], reorderedTargetDraws[1], 'coalescing retains the compatible primary draw');
  assert.equal(reorderedTargetDraws[0].parent, null, 'coalescing retires only the incompatible secondary draw');
  assert.equal(target.draws.length, 1);
  assert.equal(target.draws[0].geometry.instanceCount, 6);
  const coalescedTransformIndices = target.draws[0].geometry.getAttribute('_pmndrsText_15').array;
  const coalescedStart = target.draws[0].userData.pmndrsTextRunStart;
  assert.deepEqual(
    Array.from(coalescedTransformIndices.subarray(coalescedStart, coalescedStart + 6)),
    [2, 2, 2, 1, 1, 1],
  );
  const bitmapGpuBytes = target.gpuBytes;
  const msdfPublication = session.update(
    compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: coordinator.policyHandle,
      capabilitySet: 1,
      expectedEngineRevision: coalescedPublication.engineRevision,
      consumedPlanRevision: coalescedPublication.planRevision,
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
      styleMutations: [2, 1].map((paragraphId) => ({
        opcode: 'upsert',
        paragraphId,
        styleId: 1,
        cascadeOrder: 0,
        start: 0,
        end: 3,
        root: true,
        value: {
          fontStackHandle: reversed.handle,
          materialId: primaryMaterial.id,
          fontSize: 16,
          rasterPixelRatio: 1,
          foregroundRgba: 0xffff_ffff,
        },
      })),
    }),
  );
  const msdfPlan = plan.bind(msdfPublication);
  const msdfDraws = msdfPlan.table('draws');
  assert.equal(msdfDraws.count, 1);
  assert.equal(msdfPlan.u32(msdfPlan.record(msdfDraws, 0) + drawLayout.programId), 2);
  target.apply(msdfPublication);
  assert.equal(target.draws.length, 1);
  assert.equal(target.draws[0].geometry.instanceCount, 6);
  for (const policyBufferId of [1, 2, 3, 4, 5, 6, 7, 15]) {
    assert.ok(target.draws[0].geometry.getAttribute(`_pmndrsText_${policyBufferId}`));
  }
  assert.equal(
    target.gpuBytes,
    textStorageBytes(target.draws) +
      msdfFont.data.binding.width * msdfFont.data.binding.height * msdfFont.data.binding.layers * 4,
    'retired Bitmap state is excluded and the live MSDF atlas is included',
  );
  assert.notEqual(target.gpuBytes, bitmapGpuBytes);
  const msdfGpuBytes = target.gpuBytes;
  const slugPublication = session.update(
    compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: coordinator.policyHandle,
      capabilitySet: 1,
      expectedEngineRevision: msdfPublication.engineRevision,
      consumedPlanRevision: msdfPublication.planRevision,
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
      styleMutations: [2, 1].map((paragraphId) => ({
        opcode: 'upsert',
        paragraphId,
        styleId: 1,
        cascadeOrder: 0,
        start: 0,
        end: 3,
        root: true,
        value: {
          fontStackHandle: slugFirst.handle,
          materialId: primaryMaterial.id,
          fontSize: 16,
          rasterPixelRatio: 1,
          foregroundRgba: 0xffff_ffff,
        },
      })),
    }),
  );
  const slugPlan = plan.bind(slugPublication);
  const slugDraws = slugPlan.table('draws');
  assert.equal(slugDraws.count, 1);
  assert.equal(slugPlan.u32(slugPlan.record(slugDraws, 0) + drawLayout.programId), 3);
  target.apply(slugPublication);
  assert.equal(target.draws.length, 1);
  assert.equal(target.draws[0].geometry.instanceCount, 6);
  for (const policyBufferId of [1, 2, 3, 4, 5, 6, 7, 15]) {
    assert.ok(target.draws[0].geometry.getAttribute(`_pmndrsText_${policyBufferId}`));
  }
  const resourceLayout = textShaperAbi.layouts.engineResource;
  const draw = slugPlan.record(slugDraws, 0);
  const resource = slugPlan.record(slugPlan.table('resources'), slugPlan.u32(draw + drawLayout.resourceStart));
  const slugResource = coordinator.resolveResource(slugPlan.u32(resource + resourceLayout.referenceId));
  assert.equal(slugResource.technique, slug.id);
  assert.equal(
    target.gpuBytes,
    textStorageBytes(target.draws) + slugPageGpuBytes(slugResource.page),
    'retired MSDF state is excluded and the live Slug page is included',
  );
  assert.notEqual(target.gpuBytes, msdfGpuBytes);
  assert.deepEqual(materialCalls, [
    'primary:pmndrs.bitmap',
    'secondary:pmndrs.bitmap',
    'primary:pmndrs.msdf',
    'primary:pmndrs.slug',
  ]);
  assert.ok(target.gpuBytes > 0);

  const directPolicyHandle = 2;
  coordinator.host.registerPolicy(
    directPolicyHandle,
    firstPartyThreeRenderPolicyBytes(coordinator.host.wireIdentities, 'direct'),
  );
  const directSession = coordinator.createSession({
    requestCapacity: 4_096,
    resultCapacity: 1024 * 1024,
    textCapacity: 16,
  });
  const directRequest = initialRequest.slice();
  const requestLayout = textShaperAbi.layouts.engineUpdateRequest;
  const directRequestView = new DataView(directRequest.buffer, directRequest.byteOffset, directRequest.byteLength);
  directRequestView.setUint32(requestLayout.sessionId, directSession.handle, true);
  directRequestView.setUint32(requestLayout.policyHandle, directPolicyHandle, true);
  const directPublication = directSession.update(directRequest);
  const directPlan = plan.bind(directPublication);
  const directDraws = directPlan.table('draws');
  assert.deepEqual(
    Array.from({ length: directDraws.count }, (_, index) =>
      directPlan.u32(directPlan.record(directDraws, index) + drawLayout.transformId),
    ),
    [1, 2],
    'the direct policy makes transform identity an authoritative Rust draw boundary',
  );
  const directTarget = new ThreeTextEnginePlanTarget(coordinator, {
    drawRoot,
    renderOrderBase: 20,
    objectForTransform(transformId) {
      const object = paragraphObjects.get(transformId);
      if (object === undefined) throw new Error(`unknown paragraph transform ${transformId}`);
      return object;
    },
  });
  directTarget.apply(directPublication);
  assert.equal(directTarget.draws.length, 2);
  for (const [index, draw] of directTarget.draws.entries()) {
    assert.equal(draw.geometry.getAttribute('_pmndrsText_15'), undefined);
    assert.equal(draw.geometry.getAttribute('_pmndrsTextTransforms'), undefined);
    assert.equal(draw.matrixAutoUpdate, false);
    assert.equal(draw.matrix.elements[12], index === 0 ? 4 : 7);
  }
  assert.equal(directTarget.syncTransforms(), 0);
  paragraphObjects.get(2).position.x = 9;
  assert.equal(directTarget.syncTransforms(), 1);
  assert.equal(directTarget.draws[1].matrix.elements[12], 9);
  directTarget.dispose();
  directSession.dispose();

  const hybridPolicyHandle = 3;
  coordinator.host.registerPolicy(
    hybridPolicyHandle,
    firstPartyThreeRenderPolicyBytes(coordinator.host.wireIdentities, {
      bitmap: 'indexed',
      msdf: 'direct',
      slug: 'indexed',
    }),
  );
  const hybridSession = coordinator.createSession({
    requestCapacity: 4_096,
    resultCapacity: 1024 * 1024,
    textCapacity: 16,
  });
  const hybridRequest = initialRequest.slice();
  const hybridRequestView = new DataView(hybridRequest.buffer, hybridRequest.byteOffset, hybridRequest.byteLength);
  hybridRequestView.setUint32(requestLayout.sessionId, hybridSession.handle, true);
  hybridRequestView.setUint32(requestLayout.policyHandle, hybridPolicyHandle, true);
  const hybridInitialPublication = hybridSession.update(hybridRequest);
  const hybridTarget = new ThreeTextEnginePlanTarget(coordinator, {
    drawRoot,
    renderOrderBase: 30,
    objectForTransform(transformId) {
      const object = paragraphObjects.get(transformId);
      if (object === undefined) throw new Error(`unknown paragraph transform ${transformId}`);
      return object;
    },
  });
  hybridTarget.apply(hybridInitialPublication);
  const hybridPublication = hybridSession.update(
    compileTextEngineFrameUpdate({
      sessionId: hybridSession.handle,
      policyHandle: hybridPolicyHandle,
      capabilitySet: 1,
      expectedEngineRevision: hybridInitialPublication.engineRevision,
      consumedPlanRevision: hybridInitialPublication.planRevision,
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
            fontStackHandle: reversed.handle,
            materialId: secondaryMaterial.id,
            fontSize: 16,
            rasterPixelRatio: 1,
            foregroundRgba: 0xffff_ffff,
          },
        },
      ],
    }),
  );
  const hybridPlan = plan.bind(hybridPublication);
  const hybridDraws = hybridPlan.table('draws');
  assert.deepEqual(
    Array.from({ length: hybridDraws.count }, (_, index) => {
      const hybridDraw = hybridPlan.record(hybridDraws, index);
      return [hybridPlan.u32(hybridDraw + drawLayout.programId), hybridPlan.u32(hybridDraw + drawLayout.transformId)];
    }),
    [
      [1, 0],
      [2, 2],
    ],
    'one Rust publication may mix indexed and direct program contracts',
  );
  hybridTarget.apply(hybridPublication);
  const [hybridIndexedDraw, hybridDirectDraw] = hybridTarget.draws;
  assert.ok(hybridIndexedDraw.geometry.getAttribute('_pmndrsText_15'));
  assert.ok(hybridIndexedDraw.geometry.getAttribute('_pmndrsTextTransforms'));
  assert.equal(hybridDirectDraw.geometry.getAttribute('_pmndrsText_15'), undefined);
  assert.equal(hybridDirectDraw.geometry.getAttribute('_pmndrsTextTransforms'), undefined);
  assert.equal(hybridDirectDraw.matrix.elements[12], 9);
  paragraphObjects.get(1).position.x = 6;
  paragraphObjects.get(2).position.x = 10;
  assert.equal(hybridTarget.syncTransforms(), 2);
  assert.equal(hybridIndexedDraw.geometry.getAttribute('_pmndrsTextTransforms').array[1 * 16 + 12], 6);
  assert.equal(hybridDirectDraw.matrix.elements[12], 10);
  hybridTarget.dispose();
  hybridSession.dispose();

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
  slugFirst.release();
  primaryMaterial.release();
  secondaryMaterial.release();
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

function textStorageBytes(draws) {
  const arrays = new Set();
  for (const draw of draws) {
    for (const [name, attribute] of Object.entries(draw.geometry.attributes)) {
      if (name.startsWith('_pmndrsText')) arrays.add(attribute.array);
    }
  }
  return [...arrays].reduce((bytes, array) => bytes + array.byteLength, 0);
}

function slugPageGpuBytes(page) {
  const references = new Uint16Array(
    page.referenceBytes.buffer,
    page.referenceBytes.byteOffset,
    page.referenceBytes.byteLength / 2,
  );
  const texels = Math.ceil(references.length / 2);
  const width = Math.min(page.referenceWidth, texels);
  const height = Math.ceil(texels / width);
  return page.curveBytes.byteLength + page.headerBytes.byteLength + width * height * 4;
}
