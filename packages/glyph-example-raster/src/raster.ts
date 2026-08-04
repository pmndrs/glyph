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

import { isGlyphExampleHeader, type GlyphExampleExtensionV0 } from './artifact.js';
import { dirtyRanges, retainedCapacity } from './capacity.js';
import {
  GLYPH_EXAMPLE_EXTENSION,
  GLYPH_EXAMPLE_FORMAT_VERSION,
  GLYPH_EXAMPLE_GENERATOR_VERSION,
  GLYPH_EXAMPLE_KIND,
  glyphExampleDescriptor,
  type GlyphExampleOptions,
} from './contract.js';

const INSTANCE_STRIDE = 8;

export interface GlyphExampleResource {
  readonly colors: Uint8Array;
  readonly glyphCount: number;
  readonly inset: number;
  readonly material: THREE.MeshBasicNodeMaterial;
}

export interface GlyphExampleDrawBatch extends RasterObjectDrawBatch<THREE.Object3D> {
  readonly capacity: number;
  readonly glyphCount: number;
}

interface BatchContext {
  readonly resource: GlyphExampleResource;
  readonly fontSlot: number;
  readonly geometry?: THREE.InstancedBufferGeometry;
  readonly instances?: THREE.InstancedInterleavedBuffer;
  readonly mesh?: THREE.Mesh;
  logicalCount: number;
  localRenderOrder: number;
  renderOrderBase: number;
  disposed: boolean;
}

const batchContexts = new WeakMap<GlyphExampleDrawBatch, BatchContext>();

export const glyphExampleModule: RasterModule<
  typeof GLYPH_EXAMPLE_KIND,
  GlyphExampleResource,
  GlyphExampleDrawBatch,
  GlyphExampleOptions | undefined
> = defineRaster({
  kind: GLYPH_EXAMPLE_KIND,
  extension: GLYPH_EXAMPLE_EXTENSION,
  version: GLYPH_EXAMPLE_FORMAT_VERSION,
  runtimeBaker: () => import('./runtime-baker.js'),
  descriptor: glyphExampleDescriptor,
  async decode(font, raster, signal) {
    signal?.throwIfAborted();
    const extension = decodeExtension(font, raster);
    if (!isGlyphExampleHeader(raster.view(extension.headerBufferView))) {
      throw new TypeError('glyph-example artifact has an invalid package header');
    }
    const colors = Uint8Array.from(await raster.resource(extension.records, signal));
    signal?.throwIfAborted();
    if (colors.byteLength !== font.glyphCount * extension.recordStride) {
      throw new RangeError('glyph-example record payload length does not match the font glyph count');
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
        throw new TypeError('glyph-example fill color must contain four finite linear values in [0, 1]');
      }
      if (entry.outline !== undefined || entry.shadow !== undefined) {
        throw new TypeError('glyph-example supports fill color and opacity only');
      }
    }
  },
  dispose(resource) {
    resource.material.dispose();
    resource.colors.fill(0);
  },
});

export function glyphExample(options: GlyphExampleOptions = {}): {
  readonly module: typeof glyphExampleModule;
  readonly options: GlyphExampleOptions;
} {
  return { module: glyphExampleModule, options } as const;
}

function decodeExtension(
  font: RegisteredFont,
  raster: RegisteredRaster<typeof GLYPH_EXAMPLE_KIND>,
): GlyphExampleExtensionV0 {
  const extension = objectValue(raster.extensionData, 'glyph-example extension');
  if (
    extension.version !== GLYPH_EXAMPLE_FORMAT_VERSION ||
    extension.rasterKey !== raster.rasterKey ||
    extension.shapingHash !== font.shapingHash ||
    extension.glyphCount !== font.glyphCount ||
    extension.glyphIdWidth !== 16 ||
    extension.recordStride !== 4
  ) {
    throw new TypeError('glyph-example extension identity does not match its registered font');
  }
  const descriptorValue = objectValue(extension.descriptor, 'glyph-example descriptor');
  if (descriptorValue.generatorVersion !== GLYPH_EXAMPLE_GENERATOR_VERSION) {
    throw new TypeError('glyph-example descriptor has an unsupported generator version');
  }
  const descriptor = glyphExampleDescriptor(descriptorValue);
  const headerBufferView = nonnegativeInteger(extension.headerBufferView, 'glyph-example headerBufferView');
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
  const source = objectValue(value, 'glyph-example records');
  if (source.type === 'bufferView') {
    return {
      type: 'bufferView',
      bufferView: nonnegativeInteger(source.bufferView, 'glyph-example records.bufferView'),
    };
  }
  if (source.type !== 'external') throw new TypeError('glyph-example record source has an unsupported type');
  if (typeof source.uri !== 'string' || source.uri.length === 0) {
    throw new TypeError('glyph-example external record source must have a URI');
  }
  if (typeof source.artifactHash !== 'string' || !/^[0-9a-f]{64}$/.test(source.artifactHash)) {
    throw new TypeError('glyph-example external record source must have a SHA-256 hash');
  }
  return {
    type: 'external',
    uri: source.uri,
    byteLength: nonnegativeInteger(source.byteLength, 'glyph-example records.byteLength'),
    artifactHash: source.artifactHash as Sha256Hex,
  };
}

function createBatch(
  resource: GlyphExampleResource,
  fontSlot: number,
  glyphIndices: Uint32Array,
  values: Float32Array,
): GlyphExampleDrawBatch {
  const capacity = retainedCapacity(glyphIndices.length);
  const object = new THREE.Object3D();
  object.name = 'pmndrs.text.glyph-example';
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
    instanceAttribute(geometry, instances, 'glyphExampleOrigin', 2, 0);
    instanceAttribute(geometry, instances, 'glyphExampleSize', 2, 2);
    instanceAttribute(geometry, instances, 'glyphExampleColor', 4, 4);
    instances.needsUpdate = true;
    mesh = new THREE.Mesh(geometry, resource.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = glyphIndices[0] ?? 0;
    object.add(mesh);
  }
  let batch!: GlyphExampleDrawBatch;
  batch = {
    object,
    capacity,
    get glyphCount() {
      return batchContexts.get(batch)?.logicalCount ?? 0;
    },
    setRenderOrderBase(base) {
      const context = batchContexts.get(batch);
      if (context === undefined) return;
      context.renderOrderBase = base;
      if (context.mesh !== undefined) context.mesh.renderOrder = base + context.localRenderOrder;
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
    localRenderOrder: glyphIndices[0] ?? 0,
    renderOrderBase: 0,
    disposed: false,
  });
  return batch;
}

function stageRetained(
  batch: GlyphExampleDrawBatch,
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
      context.localRenderOrder = glyphIndices[0] ?? 0;
      geometry.instanceCount = glyphIndices.length;
      if (mesh !== undefined) {
        mesh.visible = glyphIndices.length > 0;
        mesh.renderOrder = context.renderOrderBase + context.localRenderOrder;
      }
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
  resource: GlyphExampleResource,
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
    if (resolved === undefined) throw new TypeError('glyph-example paint references a missing palette entry');
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
  resource: GlyphExampleResource,
  fontSlot: number,
  paint: GlyphPaint,
): void {
  const count = layout.glyphIds.length;
  for (const values of [layout.glyphFontSlots, layout.glyphFontSizes, layout.x, layout.y, paint.paintIndices]) {
    if (values.length !== count) throw new TypeError('glyph-example layout and paint arrays must be parallel');
  }
  if (!Number.isSafeInteger(fontSlot) || fontSlot < 0) throw new RangeError('glyph-example font slot is invalid');
  for (let index = 0; index < count; index += 1) {
    if (!Number.isFinite(layout.glyphFontSizes[index]) || layout.glyphFontSizes[index]! <= 0) {
      throw new TypeError('glyph-example font sizes must be positive finite values');
    }
    if (!Number.isFinite(layout.x[index]) || !Number.isFinite(layout.y[index])) {
      throw new TypeError('glyph-example positions must be finite values');
    }
  }
  for (const glyphId of layout.glyphIds) {
    if (glyphId >= resource.glyphCount) throw new RangeError('glyph-example layout references an unavailable glyph');
  }
  glyphExampleModule.validatePaint?.(paint);
}

function createMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const origin: Node<'vec2'> = attribute<'vec2'>('glyphExampleOrigin', 'vec2');
  const size: Node<'vec2'> = attribute<'vec2'>('glyphExampleSize', 'vec2');
  const color: Node<'vec4'> = attribute<'vec4'>('glyphExampleColor', 'vec4');
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
