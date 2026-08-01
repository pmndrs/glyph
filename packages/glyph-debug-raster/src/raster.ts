import type {
  GlyphPaint,
  JsonValue,
  ParagraphLayout,
  RasterModule,
  RasterObjectDrawBatch,
  RasterResourceSource,
  RegisteredFont,
  RegisteredRaster,
  Sha256Hex,
} from '@pmndrs/text';
import { defineRaster, defineRasterBatchStage } from '@pmndrs/text';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { add, attribute, min, mul, positionLocal, step, sub, uv, vec3 } from 'three/tsl';

import { isGlyphDebugHeader, type GlyphDebugExtensionV0 } from './artifact.js';
import { dirtyRanges, retainedCapacity } from './capacity.js';
import {
  GLYPH_DEBUG_EXTENSION,
  GLYPH_DEBUG_FORMAT_VERSION,
  GLYPH_DEBUG_GENERATOR_VERSION,
  GLYPH_DEBUG_KIND,
  glyphDebugDescriptor,
  type GlyphDebugOptions,
} from './contract.js';

const INSTANCE_STRIDE = 8;

export interface GlyphDebugResource {
  readonly colors: Uint8Array;
  readonly glyphCount: number;
  readonly inset: number;
  readonly material: THREE.MeshBasicNodeMaterial;
}

export interface GlyphDebugDrawBatch extends RasterObjectDrawBatch<THREE.Group> {
  readonly capacity: number;
  readonly glyphCount: number;
}

interface BatchContext {
  readonly resource: GlyphDebugResource;
  readonly fontSlot: number;
  readonly geometry?: THREE.InstancedBufferGeometry;
  readonly instances?: THREE.InstancedInterleavedBuffer;
  readonly mesh?: THREE.Mesh;
  logicalCount: number;
  disposed: boolean;
}

const batchContexts = new WeakMap<GlyphDebugDrawBatch, BatchContext>();

export const glyphDebugModule: RasterModule<
  typeof GLYPH_DEBUG_KIND,
  GlyphDebugResource,
  GlyphDebugDrawBatch,
  GlyphDebugOptions | undefined
> = defineRaster({
  kind: GLYPH_DEBUG_KIND,
  extension: GLYPH_DEBUG_EXTENSION,
  version: GLYPH_DEBUG_FORMAT_VERSION,
  runtimeBaker: () => import('./runtime-baker.js'),
  descriptor: glyphDebugDescriptor,
  async decode(font, raster, signal) {
    signal?.throwIfAborted();
    const extension = decodeExtension(font, raster);
    if (!isGlyphDebugHeader(raster.view(extension.headerBufferView))) {
      throw new TypeError('glyph-debug artifact has an invalid package header');
    }
    const colors = Uint8Array.from(await raster.resource(extension.records, signal));
    signal?.throwIfAborted();
    if (colors.byteLength !== font.glyphCount * extension.recordStride) {
      throw new RangeError('glyph-debug record payload length does not match the font glyph count');
    }
    return {
      colors,
      glyphCount: font.glyphCount,
      inset: extension.descriptor.inset,
      material: createMaterial(),
    };
  },
  prepare(_layout, _resource, _fontSlot, signal) {
    signal?.throwIfAborted();
  },
  stageBatch(previous, layout, resource, fontSlot, paint) {
    validateInputs(layout, resource, fontSlot, paint);
    const glyphIndices = collectGlyphIndices(layout, fontSlot);
    const values = writeInstances(layout, resource, glyphIndices, paint);
    const previousContext = previous === undefined ? undefined : batchContexts.get(previous);
    if (
      previous !== undefined &&
      previousContext !== undefined &&
      !previousContext.disposed &&
      previousContext.resource === resource &&
      previousContext.fontSlot === fontSlot &&
      glyphIndices.length <= previous.capacity
    ) {
      return stageRetained(previous, previousContext, glyphIndices, values);
    }
    const replacement = createBatch(resource, fontSlot, glyphIndices, values);
    return defineRasterBatchStage(
      replacement,
      () => undefined,
      () => replacement.dispose(),
    );
  },
  validatePaint(paint) {
    for (const entry of paint.palette) {
      if (entry.color.length !== 4 || entry.color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new TypeError('glyph-debug fill color must contain four finite linear values in [0, 1]');
      }
      if (entry.outline !== undefined || entry.shadow !== undefined) {
        throw new TypeError('glyph-debug supports fill color and opacity only');
      }
    }
  },
  dispose(resource) {
    resource.material.dispose();
    resource.colors.fill(0);
  },
});

export function glyphDebug(options: GlyphDebugOptions = {}): {
  readonly module: typeof glyphDebugModule;
  readonly options: GlyphDebugOptions;
} {
  return { module: glyphDebugModule, options } as const;
}

function decodeExtension(
  font: RegisteredFont,
  raster: RegisteredRaster<typeof GLYPH_DEBUG_KIND>,
): GlyphDebugExtensionV0 {
  const extension = objectValue(raster.extensionData, 'glyph-debug extension');
  if (
    extension.version !== GLYPH_DEBUG_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16 ||
    extension.recordStride !== 4
  ) {
    throw new TypeError('glyph-debug extension identity does not match its registered font');
  }
  const descriptorValue = objectValue(extension.descriptor, 'glyph-debug descriptor');
  if (descriptorValue.generatorVersion !== GLYPH_DEBUG_GENERATOR_VERSION) {
    throw new TypeError('glyph-debug descriptor has an unsupported generator version');
  }
  const descriptor = glyphDebugDescriptor(descriptorValue);
  const headerBufferView = nonnegativeInteger(extension.headerBufferView, 'glyph-debug headerBufferView');
  const records = resourceSource(extension.records);
  return {
    version: 0,
    rasterKey: raster.rasterKey,
    shapingHash: font.shapingHash,
    glyphCount: font.glyphCount,
    glyphIdWidth: 16,
    descriptor,
    headerBufferView,
    records,
    recordStride: 4,
  };
}

function resourceSource(value: unknown): RasterResourceSource {
  const source = objectValue(value, 'glyph-debug records');
  if (source.type === 'bufferView') {
    return { type: 'bufferView', bufferView: nonnegativeInteger(source.bufferView, 'glyph-debug records.bufferView') };
  }
  if (source.type !== 'external') throw new TypeError('glyph-debug record source has an unsupported type');
  if (typeof source.uri !== 'string' || source.uri.length === 0) {
    throw new TypeError('glyph-debug external record source must have a URI');
  }
  if (typeof source.artifactHash !== 'string' || !/^[0-9a-f]{64}$/.test(source.artifactHash)) {
    throw new TypeError('glyph-debug external record source must have a SHA-256 hash');
  }
  return {
    type: 'external',
    uri: source.uri,
    byteLength: nonnegativeInteger(source.byteLength, 'glyph-debug records.byteLength'),
    artifactHash: source.artifactHash as Sha256Hex,
  };
}

function createBatch(
  resource: GlyphDebugResource,
  fontSlot: number,
  glyphIndices: Uint32Array,
  values: Float32Array,
): GlyphDebugDrawBatch {
  const capacity = retainedCapacity(glyphIndices.length);
  const object = new THREE.Group();
  object.name = 'pmndrs.text.glyph-debug';
  const geometry = capacity === 0 ? undefined : unitQuad();
  const instances =
    capacity === 0
      ? undefined
      : new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * INSTANCE_STRIDE), INSTANCE_STRIDE, 1).setUsage(
          THREE.DynamicDrawUsage,
        );
  let mesh: THREE.Mesh | undefined;
  if (geometry !== undefined && instances !== undefined) {
    geometry.instanceCount = glyphIndices.length;
    instances.array.set(values);
    instanceAttribute(geometry, instances, 'glyphDebugOrigin', 2, 0);
    instanceAttribute(geometry, instances, 'glyphDebugSize', 2, 2);
    instanceAttribute(geometry, instances, 'glyphDebugColor', 4, 4);
    instances.needsUpdate = true;
    mesh = new THREE.Mesh(geometry, resource.material);
    mesh.frustumCulled = false;
    object.add(mesh);
  }
  let batch!: GlyphDebugDrawBatch;
  batch = {
    object,
    capacity,
    get glyphCount() {
      return batchContexts.get(batch)?.logicalCount ?? 0;
    },
    dispose() {
      const context = batchContexts.get(batch);
      if (context === undefined || context.disposed) return;
      context.disposed = true;
      object.clear();
      context.geometry?.dispose();
      batchContexts.delete(batch);
    },
  };
  batchContexts.set(batch, {
    resource,
    fontSlot,
    ...(geometry === undefined ? {} : { geometry }),
    ...(instances === undefined ? {} : { instances }),
    ...(mesh === undefined ? {} : { mesh }),
    logicalCount: glyphIndices.length,
    disposed: false,
  });
  return batch;
}

function stageRetained(
  batch: GlyphDebugDrawBatch,
  context: BatchContext,
  glyphIndices: Uint32Array,
  values: Float32Array,
) {
  if (context.geometry === undefined || context.instances === undefined) {
    return defineRasterBatchStage(
      batch,
      () => undefined,
      () => undefined,
    );
  }
  const geometry = context.geometry;
  const instances = context.instances;
  const mesh = context.mesh;
  const ranges = dirtyRanges(
    instances.array as Float32Array,
    values,
    context.logicalCount,
    glyphIndices.length,
    INSTANCE_STRIDE,
  );
  return defineRasterBatchStage(
    batch,
    () => {
      const liveValues = instances.array as Float32Array;
      liveValues.set(values);
      context.logicalCount = glyphIndices.length;
      geometry.instanceCount = glyphIndices.length;
      if (mesh !== undefined) mesh.visible = glyphIndices.length > 0;
      if (ranges.length === 0) return;
      instances.clearUpdateRanges();
      for (const range of ranges) {
        if (range.count > 0) instances.addUpdateRange(range.start, range.count);
      }
      instances.needsUpdate = true;
    },
    () => undefined,
  );
}

function writeInstances(
  layout: ParagraphLayout,
  resource: GlyphDebugResource,
  glyphIndices: Uint32Array,
  paint: GlyphPaint,
): Float32Array {
  const values = new Float32Array(glyphIndices.length * INSTANCE_STRIDE);
  for (let instance = 0; instance < glyphIndices.length; instance += 1) {
    const glyphIndex = glyphIndices[instance]!;
    const glyphId = layout.glyphIds[glyphIndex]!;
    const fontSize = layout.glyphFontSizes[glyphIndex]!;
    const inset = resource.inset * fontSize;
    const paintIndex = paint.paintIndices[glyphIndex]!;
    const resolved = paint.palette[paintIndex];
    if (resolved === undefined) throw new TypeError('glyph-debug paint references a missing palette entry');
    const recordOffset = glyphId * 4;
    const offset = instance * INSTANCE_STRIDE;
    values[offset] = layout.x[glyphIndex]! + inset;
    values[offset + 1] = layout.y[glyphIndex]! - fontSize * 0.8 + inset;
    values[offset + 2] = Math.max(fontSize * 0.05, fontSize * 0.65 - inset * 2);
    values[offset + 3] = Math.max(fontSize * 0.05, fontSize - inset * 2);
    for (let channel = 0; channel < 4; channel += 1) {
      values[offset + 4 + channel] = (resource.colors[recordOffset + channel]! / 255) * resolved.color[channel]!;
    }
  }
  return values;
}

function collectGlyphIndices(layout: ParagraphLayout, fontSlot: number): Uint32Array {
  let count = 0;
  for (const slot of layout.glyphFontSlots) if (slot === fontSlot) count += 1;
  const indices = new Uint32Array(count);
  let cursor = 0;
  for (let index = 0; index < layout.glyphFontSlots.length; index += 1) {
    if (layout.glyphFontSlots[index] === fontSlot) indices[cursor++] = index;
  }
  return indices;
}

function validateInputs(
  layout: ParagraphLayout,
  resource: GlyphDebugResource,
  fontSlot: number,
  paint: GlyphPaint,
): void {
  const count = layout.glyphIds.length;
  for (const values of [layout.glyphFontSlots, layout.glyphFontSizes, layout.x, layout.y, paint.paintIndices]) {
    if (values.length !== count) throw new TypeError('glyph-debug layout and paint arrays must be parallel');
  }
  if (!Number.isSafeInteger(fontSlot) || fontSlot < 0) throw new RangeError('glyph-debug font slot is invalid');
  for (let index = 0; index < count; index += 1) {
    if (!Number.isFinite(layout.glyphFontSizes[index]) || layout.glyphFontSizes[index]! <= 0) {
      throw new TypeError('glyph-debug font sizes must be positive finite values');
    }
    if (!Number.isFinite(layout.x[index]) || !Number.isFinite(layout.y[index])) {
      throw new TypeError('glyph-debug positions must be finite values');
    }
  }
  for (const glyphId of layout.glyphIds) {
    if (glyphId >= resource.glyphCount) throw new RangeError('glyph-debug layout references an unavailable glyph');
  }
  glyphDebugModule.validatePaint?.(paint);
}

function createMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const origin: Node<'vec2'> = attribute<'vec2'>('glyphDebugOrigin', 'vec2');
  const size: Node<'vec2'> = attribute<'vec2'>('glyphDebugSize', 'vec2');
  const color: Node<'vec4'> = attribute<'vec4'>('glyphDebugColor', 'vec4');
  const unit = uv();
  const edgeDistance = min(min(unit.x, sub(1, unit.x)), min(unit.y, sub(1, unit.y)));
  const frame = sub(1, step(0.08, edgeDistance));
  material.positionNode = vec3(
    add(origin.x, mul(positionLocal.x, size.x)),
    add(origin.y, mul(positionLocal.y, size.y)),
    0,
  );
  material.colorNode = color.rgb;
  material.opacityNode = mul(color.a, frame);
  return material;
}

function unitQuad(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  return geometry;
}

function instanceAttribute(
  geometry: THREE.InstancedBufferGeometry,
  data: THREE.InstancedInterleavedBuffer,
  name: string,
  itemSize: number,
  offset: number,
): void {
  geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(data, itemSize, offset, false));
}

function objectValue(value: JsonValue | unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`${label} must be a non-negative integer`);
  return value as number;
}
