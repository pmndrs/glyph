import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { validateFontArtifact } from '@pmndrs/text-font-baker/validate';

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
  assert.deepEqual(
    adjacentMaterialGroups(plan, draws, drawLayout.materialId),
    [7, 8],
    'Rust gathers child paragraphs into one ordered command buffer',
  );

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
  assert.deepEqual(
    adjacentMaterialGroups(reorderedPlan, reorderedDraws, drawLayout.materialId),
    [8, 7],
    'lifecycle-only reorder retains both paragraphs and changes shared draw order',
  );
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
