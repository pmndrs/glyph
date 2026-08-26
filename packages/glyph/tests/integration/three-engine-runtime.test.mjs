import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { validateFontArtifact } from '@pmndrs/glyph/bake';
import { read as readKtx2 } from 'ktx-parse';
import * as THREE from 'three/webgpu';

import { validateBitmapArtifact } from '../../dist/bakers/bitmap-validator.js';
import { validateMsdfArtifact } from '../../dist/bakers/msdf-validator.js';
import { validateSlugArtifact } from '../../dist/bakers/slug-validator.js';
import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';
import { compileTextEngineFrameUpdate } from '../../dist/core/frame-wire.js';
import { defineTechniqueSchema, id, programId, registerRasterPlanProgram, techniqueProgram } from '../../dist/core.js';
import { decorationSchema, threeRenderPolicyBytes, threeSystemBuffers } from '../../dist/three/render-policy.js';
import { TextEngineRenderPlanView } from '../../dist/core/plan-view.js';
import { LoadedFontImpl } from '../../dist/loaded-font.js';
import { FontRegistry } from '../../dist/loader.js';
import { bitmap, bitmapDescriptor } from '../../dist/raster/bitmap-technique.js';
import { msdf, msdfDescriptor, msdfSchema } from '../../dist/raster/msdf.js';
import { defineRasterResourceId, defineRasterTechnique } from '../../dist/raster-technique.js';
import { slug, slugDescriptor, slugSchema } from '../../dist/raster/slug-technique.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { registerThreeRasterPlanProgram } from '../../dist/three.js';
import { ThreeTextEngineCoordinator } from '../../dist/three/engine-runtime.js';
import { ThreeTextRenderPlanExecutor } from '../../dist/three/engine-plan-target.js';
import { defineTextMaterial } from '../../dist/three/material.js';
import { indexedQuadGeometry } from '../support/portable-geometry.mjs';

const fixtureRoot = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);
const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const SUPPLIED_ORIGIN_BUFFER_ID = id('buffer', 'test.three-supplied-geometry-capacity/origin');
const PARAGRAPH_1 = id('paragraph', 'three-engine-runtime/paragraph/1');
const PARAGRAPH_2 = id('paragraph', 'three-engine-runtime/paragraph/2');
const STYLE_1 = id('style', 'three-engine-runtime/style/1');
const STYLE_2 = id('style', 'three-engine-runtime/style/2');
const FLOW_THREAD_1 = id('flow-thread', 'three-engine-runtime/flow-thread/1');
const FLOW_THREAD_2 = id('flow-thread', 'three-engine-runtime/flow-thread/2');
const REGION_1 = id('region', 'three-engine-runtime/region/1');
const REGION_2 = id('region', 'three-engine-runtime/region/2');
const glyphAttribute = (bufferId) => `_pmndrsGlyph_${bufferId}`;

const suppliedGeometryTechnique = defineRasterTechnique({
  id: 'test.three-supplied-geometry-capacity',
  kind: 'test',
  extension: 'TEST_three_supplied_geometry',
  version: 0,
  descriptor: () => ({}),
  async decode() {
    return {};
  },
  dispose() {},
});
const suppliedGeometrySchema = defineTechniqueSchema({
  technique: suppliedGeometryTechnique.id,
  scope: 'glyph',
  binding: {},
  buffers: { origin: { id: SUPPLIED_ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] } },
  resources: {
    mesh: {
      kind: 'geometry',
      attributes: [{ semantic: 'uv', componentType: 'f32', components: 2 }],
    },
  },
  render: { resource: 'mesh', geometry: { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' } },
});
registerRasterPlanProgram({
  technique: suppliedGeometryTechnique,
  schema: suppliedGeometrySchema,
  policyBody(system) {
    const program = techniqueProgram(suppliedGeometrySchema, { system });
    return program.compile({ origin: [program.semantics.inlineOrigin, program.semantics.blockOrigin] });
  },
  compileFont(compiler) {
    const { resource, geometry } = compiler.font.data;
    compiler.retain('mesh', resource, geometry);
    return compiler.compile({
      strikes: [0],
      resource: () => resource,
    });
  },
});
let suppliedGeometryMaterialCalls = 0;
registerThreeRasterPlanProgram({
  technique: suppliedGeometryTechnique,
  schema: suppliedGeometrySchema,
  variant: {
    id: 'test-tsl',
    language: 'tsl',
    buffers: { origin: { scalar: 'f32', vectorWidth: 2 } },
    resources: { mesh: { kind: 'geometry' } },
    outputs: { position: 'vec3' },
    geometry: suppliedGeometrySchema.render.geometry,
    createMaterial() {
      suppliedGeometryMaterialCalls += 1;
      return new THREE.MeshBasicNodeMaterial();
    },
  },
});

test('records-sourced Three geometry retains supplied topology across instance-count changes', async () => {
  const [fontBytes, wasm] = await Promise.all([
    readFile(new URL('inter-bitmap-16.font.glb', fixtureRoot)),
    readFile(wasmUrl),
  ]);
  const registry = new FontRegistry();
  const registered = await registry.registerAsset(fontBytes);
  const shaper = await createRuntimeShaper({ registry, wasm });
  shaper.registerFont(registered);
  const font = new LoadedFontImpl({
    runtime: undefined,
    font: registered,
    technique: suppliedGeometryTechnique,
    raster: undefined,
    data: {
      resource: defineRasterResourceId('test/three-supplied-geometry-capacity'),
      geometry: indexedQuadGeometry(),
    },
    release: () => undefined,
  });
  const invalidGeometry = indexedQuadGeometry();
  invalidGeometry.accessors[0].components = 2;
  const invalidFont = new LoadedFontImpl({
    runtime: undefined,
    font: registered,
    technique: suppliedGeometryTechnique,
    raster: undefined,
    data: {
      resource: defineRasterResourceId('test/three-invalid-supplied-geometry'),
      geometry: invalidGeometry,
    },
    release: () => undefined,
  });
  const coordinator = new ThreeTextEngineCoordinator(shaper);
  assert.throws(
    () => coordinator.acquireFontStack([invalidFont]),
    /geometry payload attribute "position" needs 3 components; got 2/u,
  );
  const stack = coordinator.acquireFontStack([font]);
  const session = coordinator.createSession({
    requestCapacity: 4_096,
    resultCapacity: 1024 * 1024,
    textCapacity: 16,
  });
  const drawRoot = new THREE.Object3D();
  const target = new ThreeTextRenderPlanExecutor(coordinator, {
    drawRoot,
    pixelSnapping: false,
    renderOrderBase: 0,
    objectForTransform() {
      return drawRoot;
    },
    transformIds: () => [],
    transformIndices: () => [],
  });
  const frame = (engineSession, previous, changes) =>
    compileTextEngineFrameUpdate({
      sessionId: engineSession.handle,
      policyHandle: coordinator.policyHandle,
      expectedEngineRevision: previous?.engineRevision ?? 0,
      consumedPlanRevision: previous?.planRevision ?? 0,
      acknowledgedPublicationGeneration: previous?.publicationGeneration ?? 0,
      limits: {
        maxParagraphs: 1,
        maxClusters: 16,
        maxLines: 4,
        maxRegions: 1,
        maxExclusions: 1,
        maxInlineObjects: 1,
        maxSlotsPerBand: 2,
        maxOutputBytes: 1024 * 1024,
      },
      ...changes,
    });

  try {
    suppliedGeometryMaterialCalls = 0;
    const initial = session.update(
      frame(session, undefined, {
        paragraphMutations: [{ opcode: 'upsert', paragraphId: PARAGRAPH_1, order: 0 }],
        textMutations: [{ paragraphId: PARAGRAPH_1, start: 0, deleteCount: 0, insert: '12345' }],
        styleMutations: [
          {
            opcode: 'upsert',
            paragraphId: PARAGRAPH_1,
            styleId: STYLE_1,
            cascadeOrder: 0,
            start: 0,
            end: 5,
            root: true,
            value: {
              fontStackHandle: stack.handle,
              fontSize: 16,
              rasterPixelRatio: 1,
              foregroundRgba: 0xffff_ffff,
            },
          },
        ],
        constraints: [
          {
            paragraphId: PARAGRAPH_1,
            flowThreadId: FLOW_THREAD_1,
            geometryRevision: 1,
            width: 256,
            height: 64,
            viewportBlockStart: 0,
            viewportBlockEnd: 64,
            resumeBlockOffset: 0,
            maxLines: 4,
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
        ],
        regions: [
          {
            id: REGION_1,
            geometryRevision: 1,
            transformIndex: 1,
            shape: 'rectangle',
            exclusionStart: 0,
            exclusionCount: 0,
            writingMode: 'horizontal-tb',
            textOrientation: 'mixed',
            inlineStart: 0,
            blockStart: 0,
            inlineEnd: 256,
            blockEnd: 64,
            clipInlineStart: 0,
            clipBlockStart: 0,
            clipInlineEnd: 256,
            clipBlockEnd: 64,
          },
        ],
      }),
    );
    target.apply(initial);
    const retained = target.draws[0];
    assert.ok(retained);
    assert.equal(retained.geometry.instanceCount, 5);
    assert.equal(retained.geometry.index.count, 6);
    assert.equal(retained.geometry.getAttribute('position').itemSize, 3);
    retained.geometry.computeBoundingBox();
    assert.deepEqual(retained.geometry.boundingBox?.min.toArray(), [0, 0, 0]);
    assert.deepEqual(retained.geometry.boundingBox?.max.toArray(), [1, 1, 0]);
    assert.equal(suppliedGeometryMaterialCalls, 1);

    const shortened = session.update(
      frame(session, initial, {
        textMutations: [{ paragraphId: PARAGRAPH_1, start: 4, deleteCount: 1, insert: '' }],
        styleMutations: [
          {
            opcode: 'upsert',
            paragraphId: PARAGRAPH_1,
            styleId: STYLE_1,
            cascadeOrder: 0,
            start: 0,
            end: 4,
            root: true,
            value: {
              fontStackHandle: stack.handle,
              fontSize: 16,
              rasterPixelRatio: 1,
              foregroundRgba: 0xffff_ffff,
            },
          },
        ],
      }),
    );
    target.apply(shortened);
    assert.equal(target.draws[0], retained, 'compatible supplied geometry must reuse the retained Three draw');
    assert.equal(retained.geometry.instanceCount, 4);
    assert.equal(retained.geometry.index.count, 6, 'reuse must preserve the normalized triangle-list topology');
    const expanded = session.update(
      frame(session, shortened, {
        textMutations: [{ paragraphId: PARAGRAPH_1, start: 4, deleteCount: 0, insert: '56' }],
        styleMutations: [
          {
            opcode: 'upsert',
            paragraphId: PARAGRAPH_1,
            styleId: STYLE_1,
            cascadeOrder: 0,
            start: 0,
            end: 6,
            root: true,
            value: {
              fontStackHandle: stack.handle,
              fontSize: 16,
              rasterPixelRatio: 1,
              foregroundRgba: 0xffff_ffff,
            },
          },
        ],
      }),
    );
    target.apply(expanded);
    assert.equal(target.draws[0], retained);
    assert.equal(retained.geometry.instanceCount, 6);
    assert.equal(retained.geometry.index.count, 6);
    assert.equal(suppliedGeometryMaterialCalls, 1);

    const acceptedBytes = new Map(
      Object.entries(retained.geometry.attributes)
        .filter(([name]) => name.startsWith('_pmndrsGlyph_'))
        .map(([name, attribute]) => [name, attribute.array.slice()]),
    );
    const rejected = session.update(
      frame(session, expanded, {
        textMutations: [{ paragraphId: PARAGRAPH_1, start: 6, deleteCount: 0, insert: '7' }],
        styleMutations: [
          {
            opcode: 'upsert',
            paragraphId: PARAGRAPH_1,
            styleId: STYLE_1,
            cascadeOrder: 0,
            start: 0,
            end: 7,
            root: true,
            value: {
              fontStackHandle: stack.handle,
              fontSize: 16,
              rasterPixelRatio: 1,
              foregroundRgba: 0xffff_ffff,
            },
          },
        ],
      }),
    );
    const rejectedView = new TextEngineRenderPlanView().bind(rejected);
    const rejectedBytes = new DataView(rejected.memoryBuffer);
    const rejectedResource = rejectedView.record(rejectedView.table('resources'), 0);
    const resourceKindOffset =
      rejected.bytes.byteOffset + rejectedResource + textShaperAbi.layouts.engineResource.resourceKind;
    const resourceKind = rejectedBytes.getUint16(resourceKindOffset, true);
    rejectedBytes.setUint16(resourceKindOffset, 0, true);
    assert.throws(() => target.apply(rejected), /invalid kind/u);
    rejectedBytes.setUint16(resourceKindOffset, resourceKind, true);

    const rejectedPrimitive = rejectedView.record(rejectedView.table('primitives'), 0);
    const recordCountOffset =
      rejected.bytes.byteOffset + rejectedPrimitive + textShaperAbi.layouts.enginePrimitive.recordCount;
    const recordCount = rejectedBytes.getUint16(recordCountOffset, true);
    rejectedBytes.setUint16(recordCountOffset, 0, true);
    assert.throws(() => target.apply(rejected), /positive record count/u);
    rejectedBytes.setUint16(recordCountOffset, recordCount, true);

    const rejectedDraw = rejectedView.record(rejectedView.table('draws'), 0);
    rejectedBytes.setUint32(
      rejected.bytes.byteOffset + rejectedDraw + textShaperAbi.layouts.engineDraw.bufferCount,
      0,
      true,
    );
    assert.throws(() => target.apply(rejected), /missing|buffer/u);
    assert.equal(target.draws[0], retained, 'a rejected candidate must preserve the accepted draw identity');
    assert.equal(retained.geometry.instanceCount, 6, 'a rejected candidate must not resize the accepted draw');
    for (const [name, bytes] of acceptedBytes) {
      assert.deepEqual(
        retained.geometry.getAttribute(name).array,
        bytes,
        `a rejected candidate must not patch accepted buffer ${name}`,
      );
    }
  } finally {
    target.dispose();
    session.dispose();
    stack.release();
    invalidFont.dispose();
    font.dispose();
    coordinator.dispose();
    shaper.dispose();
    registered.dispose();
  }
});

test('Three rejects conflicting portable payloads before changing shared resource ownership', async () => {
  const [fontBytes, wasm] = await Promise.all([
    readFile(new URL('inter-bitmap-16.font.glb', fixtureRoot)),
    readFile(wasmUrl),
  ]);
  const registry = new FontRegistry();
  const registered = await registry.registerAsset(fontBytes);
  const shaper = await createRuntimeShaper({ registry, wasm });
  shaper.registerFont(registered);
  const resource = defineRasterResourceId('test/three-shared-geometry-content');
  const loaded = (geometry) =>
    new LoadedFontImpl({
      runtime: undefined,
      font: registered,
      technique: suppliedGeometryTechnique,
      raster: undefined,
      data: { resource, geometry },
      release: () => undefined,
    });
  const originalGeometry = indexedQuadGeometry();
  const original = loaded(originalGeometry);
  const equal = loaded({ ...indexedQuadGeometry(), bytes: new Uint8Array(originalGeometry.bytes) });
  const conflictingGeometry = indexedQuadGeometry();
  conflictingGeometry.bytes[0] ^= 0xff;
  const conflicting = loaded(conflictingGeometry);
  const coordinator = new ThreeTextEngineCoordinator(shaper);
  let originalLease;
  let equalLease;
  try {
    originalLease = coordinator.acquireFontStack([original]);
    equalLease = coordinator.acquireFontStack([equal]);
    const reference = coordinator.host.wireIdentities.resourceId(resource);
    const retained = coordinator.resolveResource(reference);
    assert.deepEqual(retained.resources.get('mesh').bytes, originalGeometry.bytes);

    assert.throws(() => coordinator.acquireFontStack([conflicting]), /incompatible resource content/u);
    assert.equal(coordinator.resolveResource(reference), retained, 'rejection must leave the original owner live');
  } finally {
    equalLease?.release();
    originalLease?.release();
    conflicting.dispose();
    equal.dispose();
    original.dispose();
    coordinator.dispose();
    shaper.dispose();
    registered.dispose();
  }
});

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
  const bitmapFont = new LoadedFontImpl({
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
      })),
    },
    release: () => undefined,
  });
  const extension = msdfRaster.document.extensions.PMNDRS_font_distance_field;
  const msdfFont = new LoadedFontImpl({
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
    release: () => undefined,
  });
  const slugExtension = slugRaster.document.extensions.PMNDRS_font_slug;
  const slugFont = new LoadedFontImpl({
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
    },
    release: () => undefined,
  });
  const coordinator = new ThreeTextEngineCoordinator(shaper);
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
  const bitmapReference = coordinator.host.wireIdentities.resourceId(bitmapFont.data.strikes[0].pages[0].resource);
  const msdfReference = coordinator.host.wireIdentities.resourceId(msdfFont.data.resource);
  assert.equal(coordinator.resolveResource(bitmapReference).technique, bitmap.id);
  assert.equal(coordinator.resolveResource(msdfReference).technique, msdf.id);
  const shared = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  const reversed = coordinator.acquireFontStack([msdfFont, bitmapFont]);
  const slugFirst = coordinator.acquireFontStack([slugFont, msdfFont, bitmapFont]);
  assert.equal(shared.handle, first.handle);
  assert.notEqual(reversed.handle, first.handle, 'fallback order is part of stack identity');
  const session = coordinator.createSession({
    requestCapacity: 4_096,
    resultCapacity: textShaperAbi.layouts.engineResult.size,
    textCapacity: 16,
  });
  const initialRequest = compileTextEngineFrameUpdate({
    sessionId: session.handle,
    policyHandle: coordinator.policyHandle,
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
      { opcode: 'upsert', paragraphId: PARAGRAPH_1, order: 0 },
      { opcode: 'upsert', paragraphId: PARAGRAPH_2, order: 1 },
    ],
    textMutations: [
      { paragraphId: PARAGRAPH_1, start: 0, deleteCount: 0, insert: 'abc' },
      { paragraphId: PARAGRAPH_2, start: 0, deleteCount: 0, insert: 'def' },
    ],
    styleMutations: [
      {
        opcode: 'upsert',
        paragraphId: PARAGRAPH_1,
        styleId: STYLE_1,
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
        paragraphId: PARAGRAPH_2,
        styleId: STYLE_1,
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
        paragraphId: PARAGRAPH_1,
        flowThreadId: FLOW_THREAD_1,
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
        paragraphId: PARAGRAPH_2,
        flowThreadId: FLOW_THREAD_2,
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
        id: REGION_1,
        geometryRevision: 1,
        transformIndex: 1,
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
        id: REGION_2,
        geometryRevision: 1,
        transformIndex: 2,
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
  assert.ok(
    publication.bytes.byteLength > textShaperAbi.layouts.engineResult.size,
    'the host must reserve the reported result watermark and retry the cold publication',
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
  drawRoot.add(...paragraphObjects.values());
  paragraphObjects.get(1).position.x = 3;
  paragraphObjects.get(2).position.x = 7;
  const target = new ThreeTextRenderPlanExecutor(coordinator, {
    drawRoot,
    renderOrderBase: 10,
    objectForTransform(transformId) {
      const object = paragraphObjects.get(transformId);
      if (object === undefined) throw new Error(`unknown paragraph transform ${transformId}`);
      return object;
    },
    transformIds: () => paragraphObjects.keys(),
    transformIndices: () => paragraphObjects.keys(),
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
  const transformIndexAttribute = target.draws[0].geometry.getAttribute(
    glyphAttribute(threeSystemBuffers.transformIndex.id),
  );
  const transformTableAttribute = target.draws[0].geometry.getAttribute('_pmndrsGlyphTransforms');
  assert.ok(transformIndexAttribute.array instanceof Uint32Array);
  assert.ok(transformTableAttribute.array instanceof Float32Array);
  assert.deepEqual(
    target.draws.map((draw) => transformIndexAttribute.array[draw.userData.pmndrsGlyphRunStart]),
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
  paragraphObjects.get(1).visible = false;
  assert.equal(target.syncTransforms(), 1);
  assert.deepEqual(
    Array.from(transformTableAttribute.array.subarray(16, 32)),
    Array(16).fill(0),
    'indexed draws suppress only the hidden Text instances without splitting the shared draw',
  );
  paragraphObjects.get(1).visible = true;
  assert.equal(target.syncTransforms(), 1);
  assert.equal(transformTableAttribute.array[1 * 16 + 12], 4);

  const reorderedPublication = session.update(
    compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: coordinator.policyHandle,
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
        { opcode: 'upsert', paragraphId: PARAGRAPH_1, order: 1 },
        { opcode: 'upsert', paragraphId: PARAGRAPH_2, order: 0 },
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
          paragraphId: PARAGRAPH_2,
          styleId: STYLE_1,
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
  const coalescedTransformIndices = target.draws[0].geometry.getAttribute(
    glyphAttribute(threeSystemBuffers.transformIndex.id),
  ).array;
  const coalescedStart = target.draws[0].userData.pmndrsGlyphRunStart;
  assert.deepEqual(
    Array.from(coalescedTransformIndices.subarray(coalescedStart, coalescedStart + 6)),
    [2, 2, 2, 1, 1, 1],
  );
  const bitmapGpuBytes = target.gpuBytes;
  const msdfPublication = session.update(
    compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: coordinator.policyHandle,
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
      styleMutations: [PARAGRAPH_2, PARAGRAPH_1].map((paragraphId) => ({
        opcode: 'upsert',
        paragraphId,
        styleId: STYLE_1,
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
  assert.equal(msdfPlan.u32(msdfPlan.record(msdfDraws, 0) + drawLayout.programId), programId(msdf, 'three'));
  target.apply(msdfPublication);
  assert.equal(target.draws.length, 1);
  assert.equal(target.draws[0].geometry.instanceCount, 6);
  for (const policyBufferId of [
    ...Object.values(msdfSchema.buffers).map((buffer) => buffer.id),
    threeSystemBuffers.transformIndex.id,
  ]) {
    assert.ok(target.draws[0].geometry.getAttribute(glyphAttribute(policyBufferId)));
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
      styleMutations: [PARAGRAPH_2, PARAGRAPH_1].map((paragraphId) => ({
        opcode: 'upsert',
        paragraphId,
        styleId: STYLE_1,
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
  assert.equal(slugPlan.u32(slugPlan.record(slugDraws, 0) + drawLayout.programId), programId(slug, 'three'));
  target.apply(slugPublication);
  assert.equal(target.draws.length, 1);
  assert.equal(target.draws[0].geometry.instanceCount, 6);
  for (const policyBufferId of [
    ...Object.values(slugSchema.buffers).map((buffer) => buffer.id),
    threeSystemBuffers.transformIndex.id,
  ]) {
    assert.ok(target.draws[0].geometry.getAttribute(glyphAttribute(policyBufferId)));
  }
  const resourceLayout = textShaperAbi.layouts.engineResource;
  const draw = slugPlan.record(slugDraws, 0);
  const resource = slugPlan.record(slugPlan.table('resources'), slugPlan.u32(draw + drawLayout.resourceStart));
  const slugResource = coordinator.resolveResource(slugPlan.u32(resource + resourceLayout.referenceId));
  assert.equal(slugResource.technique, slug.id);
  assert.equal(
    target.gpuBytes,
    textStorageBytes(target.draws) + slugPageGpuBytes(slugResource.resources.get('page')),
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

  const directPolicyHandle = id('policy', 'three-engine-runtime/direct');
  coordinator.host.registerPolicy(
    directPolicyHandle,
    threeRenderPolicyBytes(coordinator.host.wireIdentities, 'direct'),
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
    [PARAGRAPH_1, PARAGRAPH_2],
    'the direct policy makes transform identity an authoritative Rust draw boundary',
  );
  const directTarget = new ThreeTextRenderPlanExecutor(coordinator, {
    drawRoot,
    renderOrderBase: 20,
    objectForTransform(transformId) {
      const object = paragraphObjects.get(transformId === PARAGRAPH_1 ? 1 : transformId === PARAGRAPH_2 ? 2 : 0);
      if (object === undefined) throw new Error(`unknown paragraph transform ${transformId}`);
      return object;
    },
    transformIds: () => [PARAGRAPH_1, PARAGRAPH_2],
    transformIndices: () => [],
  });
  directTarget.apply(directPublication);
  assert.equal(directTarget.draws.length, 2);
  for (const [index, directDraw] of directTarget.draws.entries()) {
    assert.equal(directDraw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id)), undefined);
    assert.equal(directDraw.geometry.getAttribute('_pmndrsGlyphTransforms'), undefined);
    assert.equal(directDraw.matrixAutoUpdate, false);
    assert.equal(directDraw.matrix.elements[12], index === 0 ? 4 : 7);
  }
  assert.equal(directTarget.syncTransforms(), 0);
  paragraphObjects.get(2).position.x = 9;
  assert.equal(directTarget.syncTransforms(), 1);
  assert.equal(directTarget.draws[1].matrix.elements[12], 9);
  paragraphObjects.get(2).visible = false;
  assert.equal(directTarget.syncTransforms(), 1);
  assert.equal(directTarget.draws[1].visible, false);
  paragraphObjects.get(2).visible = true;
  assert.equal(directTarget.syncTransforms(), 1);
  assert.equal(directTarget.draws[1].visible, true);
  directTarget.dispose();
  directSession.dispose();

  const hybridPolicyHandle = id('policy', 'three-engine-runtime/hybrid');
  coordinator.host.registerPolicy(
    hybridPolicyHandle,
    threeRenderPolicyBytes(coordinator.host.wireIdentities, {
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
  const hybridTarget = new ThreeTextRenderPlanExecutor(coordinator, {
    drawRoot,
    renderOrderBase: 30,
    objectForTransform(transformId) {
      const object = paragraphObjects.get(
        transformId === PARAGRAPH_1 ? 1 : transformId === PARAGRAPH_2 ? 2 : transformId,
      );
      if (object === undefined) throw new Error(`unknown paragraph transform ${transformId}`);
      return object;
    },
    transformIds: () => [1, 2, PARAGRAPH_1, PARAGRAPH_2],
    transformIndices: () => paragraphObjects.keys(),
  });
  hybridTarget.apply(hybridInitialPublication);
  const hybridPublication = hybridSession.update(
    compileTextEngineFrameUpdate({
      sessionId: hybridSession.handle,
      policyHandle: hybridPolicyHandle,
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
          paragraphId: PARAGRAPH_2,
          styleId: STYLE_1,
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
      [programId(bitmap, 'three'), 0],
      [programId(msdf, 'three'), PARAGRAPH_2],
    ],
    'one Rust publication may mix indexed and direct program contracts',
  );
  hybridTarget.apply(hybridPublication);
  const [hybridIndexedDraw, hybridDirectDraw] = hybridTarget.draws;
  assert.ok(hybridIndexedDraw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id)));
  assert.ok(hybridIndexedDraw.geometry.getAttribute('_pmndrsGlyphTransforms'));
  assert.equal(hybridDirectDraw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id)), undefined);
  assert.equal(hybridDirectDraw.geometry.getAttribute('_pmndrsGlyphTransforms'), undefined);
  assert.equal(hybridDirectDraw.matrix.elements[12], 9);
  let hybridDirectDisposals = 0;
  hybridDirectDraw.material.addEventListener('dispose', () => (hybridDirectDisposals += 1));
  const growthObject = new THREE.Object3D();
  drawRoot.add(growthObject);
  paragraphObjects.set(20, growthObject);
  hybridTarget.apply(hybridPublication);
  assert.equal(hybridDirectDisposals, 0, 'indexed transform growth must preserve unrelated direct materials');
  assert.equal(hybridTarget.draws[1].material, hybridDirectDraw.material);
  paragraphObjects.get(1).position.x = 6;
  paragraphObjects.get(2).position.x = 10;
  assert.equal(hybridTarget.syncTransforms(), 3);
  assert.equal(hybridTarget.draws[0].geometry.getAttribute('_pmndrsGlyphTransforms').array[1 * 16 + 12], 6);
  assert.equal(hybridDirectDraw.matrix.elements[12], 10);
  hybridTarget.dispose();
  growthObject.removeFromParent();
  paragraphObjects.delete(20);
  hybridSession.dispose();

  const stablePolicyHandle = id('policy', 'three-engine-runtime/stable');
  coordinator.host.registerPolicy(
    stablePolicyHandle,
    threeRenderPolicyBytes(coordinator.host.wireIdentities, 'indexed', [], 'stable'),
  );
  const stableSession = coordinator.createSession({
    requestCapacity: 4_096,
    resultCapacity: 1024 * 1024,
    textCapacity: 16,
  });
  const stableRequest = initialRequest.slice();
  const stableRequestView = new DataView(stableRequest.buffer, stableRequest.byteOffset, stableRequest.byteLength);
  stableRequestView.setUint32(requestLayout.sessionId, stableSession.handle, true);
  stableRequestView.setUint32(requestLayout.policyHandle, stablePolicyHandle, true);
  const stableInitialPublication = stableSession.update(stableRequest);
  const stablePlan = plan.bind(stableInitialPublication);
  const stableBuffers = stablePlan.table('buffers');
  const bufferLayout = textShaperAbi.layouts.engineBuffer;
  const orderBinding = textShaperAbi.engine.internalBufferBindings.order;
  const orderRecord = Array.from({ length: stableBuffers.count }, (_, index) =>
    stablePlan.record(stableBuffers, index),
  ).find((record) => stablePlan.u16(record + bufferLayout.policyBufferId) === orderBinding);
  assert.ok(orderRecord !== undefined, 'stable policy must publish its logical-order buffer');
  const orderBufferId = stablePlan.u32(orderRecord + bufferLayout.id);
  const stableDraws = stablePlan.table('draws');
  assert.ok(
    Array.from({ length: stableDraws.count }, (_, index) =>
      stablePlan.u32(stablePlan.record(stableDraws, index) + drawLayout.indirectBufferId),
    ).every((bufferId) => bufferId === orderBufferId),
    'every stable draw must address physical records through the published order buffer',
  );
  const stableTarget = new ThreeTextRenderPlanExecutor(coordinator, {
    drawRoot,
    renderOrderBase: 40,
    objectForTransform(transformId) {
      const object = paragraphObjects.get(transformId);
      if (object === undefined) throw new Error(`unknown paragraph transform ${transformId}`);
      return object;
    },
    transformIds: () => paragraphObjects.keys(),
    transformIndices: () => paragraphObjects.keys(),
  });
  stableTarget.apply(stableInitialPublication);
  const stableOrder = stableTarget.draws[0].geometry.getAttribute(`_pmndrsGlyph_${orderBinding}`);
  const stableIds = stableTarget.draws[0].geometry.getAttribute(glyphAttribute(threeSystemBuffers.stableGlyphId.id));
  assert.ok(stableOrder.array instanceof Uint32Array);
  assert.ok(stableIds.array instanceof Uint32Array);
  const physicalIds = stableIds.array.slice();
  const initialFirstPhysicalSlot = stableOrder.array[stableTarget.draws[0].userData.pmndrsGlyphRunStart];
  const stablePreviousDraws = [...stableTarget.draws];
  const stableReorderedPublication = stableSession.update(
    compileTextEngineFrameUpdate({
      sessionId: stableSession.handle,
      policyHandle: stablePolicyHandle,
      expectedEngineRevision: stableInitialPublication.engineRevision,
      consumedPlanRevision: stableInitialPublication.planRevision,
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
        { opcode: 'upsert', paragraphId: PARAGRAPH_1, order: 1 },
        { opcode: 'upsert', paragraphId: PARAGRAPH_2, order: 0 },
      ],
    }),
  );
  const stableReorderedPlan = plan.bind(stableReorderedPublication);
  const stablePatches = stableReorderedPlan.table('patches');
  const patchLayout = textShaperAbi.layouts.enginePatch;
  assert.ok(stablePatches.count > 0);
  assert.ok(
    Array.from({ length: stablePatches.count }, (_, index) =>
      stableReorderedPlan.u32(stableReorderedPlan.record(stablePatches, index) + patchLayout.bufferId),
    ).every((bufferId) => bufferId === orderBufferId),
    'lifecycle-only reorder must leave stable physical glyph records untouched',
  );
  stableTarget.apply(stableReorderedPublication);
  assert.deepEqual(stableIds.array, physicalIds, 'Three retains the stable physical glyph table across reorder');
  assert.equal(stableTarget.draws[0], stablePreviousDraws[1]);
  assert.equal(stableTarget.draws[1], stablePreviousDraws[0]);
  assert.notEqual(
    stableOrder.array[stableTarget.draws[0].userData.pmndrsGlyphRunStart],
    initialFirstPhysicalSlot,
    'the reordered logical draw begins at a different retained physical slot',
  );
  stableTarget.dispose();
  stableSession.dispose();

  const decorationSession = coordinator.createSession({
    requestCapacity: 4_096,
    resultCapacity: 1024 * 1024,
    textCapacity: 16,
  });
  const decorationPublication = decorationSession.update(
    compileTextEngineFrameUpdate({
      sessionId: decorationSession.handle,
      policyHandle: coordinator.policyHandle,
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
      paragraphMutations: [{ opcode: 'upsert', paragraphId: PARAGRAPH_1, order: 0 }],
      textMutations: [{ paragraphId: PARAGRAPH_1, start: 0, deleteCount: 0, insert: 'abc' }],
      styleMutations: [
        {
          opcode: 'upsert',
          paragraphId: PARAGRAPH_1,
          styleId: STYLE_1,
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
            decoration: {
              style: 'solid',
              rgba: 0xff00_00ff,
              underline: true,
              lineThrough: true,
              thickness: 0,
              offset: 0,
            },
          },
        },
      ],
      constraints: [
        {
          paragraphId: PARAGRAPH_1,
          flowThreadId: FLOW_THREAD_1,
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
      ],
      regions: [
        {
          id: REGION_1,
          geometryRevision: 1,
          transformIndex: 1,
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
  const decorationTarget = new ThreeTextRenderPlanExecutor(coordinator, {
    drawRoot,
    renderOrderBase: 60,
    objectForTransform(transformId) {
      const object = paragraphObjects.get(transformId);
      if (object === undefined) throw new Error(`unknown paragraph transform ${transformId}`);
      return object;
    },
    transformIds: () => paragraphObjects.keys(),
    transformIndices: () => paragraphObjects.keys(),
  });
  decorationTarget.apply(decorationPublication);
  const primitiveKinds = decorationTarget.draws.map(
    (decorationDraw) => decorationDraw.userData.pmndrsGlyphPrimitiveKind,
  );
  assert.ok(
    primitiveKinds.includes('decoration') && primitiveKinds.includes('glyph'),
    'a decorated publication realizes draws of both primitive kinds',
  );
  assert.equal(primitiveKinds[0], 'decoration', 'the underline row paints before its glyph run');
  assert.equal(primitiveKinds.at(-1), 'decoration', 'the line-through row paints after its glyph run');
  for (const [index, decorationDraw] of decorationTarget.draws.entries()) {
    if (primitiveKinds[index] !== 'decoration') continue;
    assert.ok(
      decorationDraw.geometry.getAttribute(glyphAttribute(decorationSchema.buffers.rect.id)).array instanceof
        Float32Array,
    );
    assert.ok(
      decorationDraw.geometry.getAttribute(glyphAttribute(decorationSchema.buffers.packed.id)).array instanceof
        Uint32Array,
    );
  }
  const decorationInstanceTotal = decorationTarget.draws.reduce(
    (total, decorationDraw) => total + decorationDraw.geometry.instanceCount,
    0,
  );
  const decorationEditPublication = decorationSession.update(
    compileTextEngineFrameUpdate({
      sessionId: decorationSession.handle,
      policyHandle: coordinator.policyHandle,
      expectedEngineRevision: decorationPublication.engineRevision,
      consumedPlanRevision: decorationPublication.planRevision,
      acknowledgedPublicationGeneration: decorationPublication.publicationGeneration,
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
      textMutations: [{ paragraphId: PARAGRAPH_1, start: 0, deleteCount: 3, insert: 'abc' }],
    }),
  );
  assert.equal(
    decorationEditPublication.primitiveCount,
    decorationPublication.primitiveCount,
    'editing a decorated paragraph must not accumulate stale gather rows',
  );
  assert.equal(decorationEditPublication.drawCount, decorationPublication.drawCount);
  decorationTarget.apply(decorationEditPublication);
  assert.equal(
    decorationTarget.draws.reduce((total, decorationDraw) => total + decorationDraw.geometry.instanceCount, 0),
    decorationInstanceTotal,
    'an identity-preserving edit must republish the same number of instances',
  );
  decorationTarget.dispose();
  decorationSession.dispose();

  // Regression canary: a colored span whose fontSize animates through value-equality
  // with its root keeps its style segment (the paint differs) while the shaping-run
  // table merges across it -- `same_layout_style` compares layout scalars and ignores
  // paint, and `font_size` is one of those scalars. When the next tick moves the size
  // off equality the table splits again under metrics-only invalidation. The engine
  // once retained the merged shape against the rebuilt table and rejected every later
  // frame with invalidRequest, poisoning the session; `shaping_run_topology_stable`
  // in engine/state.rs was added to stop that.
  //
  // This drives the merge -> split path end to end and asserts the session stays
  // healthy across it. It does not isolate that one guard: forcing
  // `shaping_run_topology_stable` to return `true` -- the pre-fix behaviour -- leaves
  // this green, so a later path absorbs the split as well. Treat it as a canary over
  // the whole retained-shape path rather than as proof of a single predicate.
  const topologySession = coordinator.createSession({
    requestCapacity: 8_192,
    resultCapacity: 1024 * 1024,
    textCapacity: 64,
  });
  const topologyStyles = (spanSize) => [
    {
      opcode: 'upsert',
      paragraphId: PARAGRAPH_1,
      styleId: STYLE_1,
      cascadeOrder: 0,
      start: 0,
      end: 24,
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
      paragraphId: PARAGRAPH_1,
      styleId: STYLE_2,
      cascadeOrder: 1,
      start: 8,
      end: 16,
      value: { fontSize: spanSize, foregroundRgba: 0xff44_22ff },
    },
  ];
  const topologyFrame = (previous, spanSize, extra = {}) =>
    compileTextEngineFrameUpdate({
      sessionId: topologySession.handle,
      policyHandle: coordinator.policyHandle,
      expectedEngineRevision: previous?.engineRevision ?? 0,
      consumedPlanRevision: previous?.planRevision ?? 0,
      acknowledgedPublicationGeneration: previous?.publicationGeneration ?? 0,
      limits: {
        maxParagraphs: 1,
        maxClusters: 32,
        maxLines: 8,
        maxRegions: 1,
        maxExclusions: 1,
        maxInlineObjects: 1,
        maxSlotsPerBand: 2,
        maxOutputBytes: 1024 * 1024,
      },
      styleMutations: topologyStyles(spanSize),
      ...extra,
    });
  // Frame 1: the span size equals the root — shaping runs merge across the span.
  const topologyFirst = topologySession.update(
    topologyFrame(undefined, 16, {
      paragraphMutations: [{ opcode: 'upsert', paragraphId: PARAGRAPH_1, order: 0 }],
      textMutations: [{ paragraphId: PARAGRAPH_1, start: 0, deleteCount: 0, insert: 'alpha beta gamma epsilon' }],
      constraints: [
        {
          paragraphId: PARAGRAPH_1,
          flowThreadId: FLOW_THREAD_1,
          geometryRevision: 1,
          width: 512,
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
      ],
      regions: [
        {
          id: REGION_1,
          geometryRevision: 1,
          transformIndex: 1,
          shape: 'rectangle',
          exclusionStart: 0,
          exclusionCount: 0,
          writingMode: 'horizontal-tb',
          textOrientation: 'mixed',
          inlineStart: 0,
          blockStart: 0,
          inlineEnd: 512,
          blockEnd: 128,
          clipInlineStart: 0,
          clipBlockStart: 0,
          clipInlineEnd: 512,
          clipBlockEnd: 128,
        },
      ],
    }),
  );
  // Frame 2: the span size moves off equality — the run table splits again and the
  // retained shape must be rebuilt, not reused.
  const topologySecond = topologySession.update(topologyFrame(topologyFirst, 17.5));
  assert.equal(topologySecond.engineRevision, topologyFirst.engineRevision + 1);
  // Frame 3: and the session must remain healthy afterwards.
  const topologyThird = topologySession.update(topologyFrame(topologySecond, 18.25));
  assert.equal(topologyThird.engineRevision, topologySecond.engineRevision + 1);
  topologySession.dispose();

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
  bitmapFont.dispose();
  assert.throws(
    () => coordinator.resolveResource(bitmapReference),
    /unknown resource/u,
    'disposed fonts must release decoded renderer resources from the coordinator',
  );
  assert.equal(coordinator.resolveResource(msdfReference).technique, msdf.id);
  msdfFont.dispose();
  slugFont.dispose();
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
      if (name.startsWith('_pmndrsGlyph')) arrays.add(attribute.array);
    }
  }
  return [...arrays].reduce((bytes, array) => bytes + array.byteLength, 0);
}

function slugPageGpuBytes(page) {
  assert.equal(page?.kind, 'group');
  return Object.values(page.members).reduce((bytes, member) => bytes + member.bytes.byteLength, 0);
}
