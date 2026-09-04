/// <reference types="@webgpu/types" />

import tgpu from 'typegpu';
import * as d from 'typegpu/data';

import type { CommandBufferView, PortableGeometryPayload } from '@pmndrs/glyph';
import {
  TypeGpuGlyphExampleFragmentInput,
  TypeGpuGlyphExampleVertexInput,
  glyphExampleFragment,
  glyphExampleVertex,
} from '@pmndrs/glyph-example-raster/typegpu';

import type { ExampleBindings } from './config.js';
import {
  RecordingExampleRendererDevice,
  exampleRendererShader,
  type ExamplePendingSubmission,
  type ExampleRendererDevice,
  type ExampleRendererShader,
  type ExampleRealizedDraw,
} from './device.js';

const positionLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x3));
const uvLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x2));
const originLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const sizeLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const colorLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const viewportLayout = tgpu.bindGroupLayout({ viewport: { uniform: d.vec2f } });

const vertexMain = tgpu.vertexFn({
  in: {
    position: d.vec3f,
    uv: d.vec2f,
    origin: d.vec2f,
    size: d.vec2f,
    color: d.vec4f,
  },
  out: { position: d.builtin.position, color: d.vec4f, uv: d.vec2f },
})((input) => {
  'use gpu';

  const output = glyphExampleVertex(
    TypeGpuGlyphExampleVertexInput({
      quadPosition: input.position.xy,
      quadUv: input.uv,
      instance: { origin: input.origin, size: input.size, color: input.color },
    }),
  );
  const viewport = viewportLayout.$.viewport;
  return {
    position: d.vec4f(2 * (output.position.x / viewport.x) - 1, 1 + 2 * (output.position.y / viewport.y), 0, 1),
    color: output.color,
    uv: output.quadUv,
  };
});

const fragmentMain = tgpu.fragmentFn({ in: { color: d.vec4f, uv: d.vec2f }, out: d.vec4f })((input) => {
  'use gpu';

  return glyphExampleFragment(TypeGpuGlyphExampleFragmentInput({ color: input.color, quadUv: input.uv }));
});

/** Caller-owned WebGPU device and offscreen target dimensions for the example renderer. */
export interface TypeGpuExampleRendererDeviceOptions {
  readonly device: GPUDevice;
  readonly width: number;
  readonly height: number;
}

interface GpuGeometry {
  readonly position: GPUBuffer;
  readonly uv: GPUBuffer;
  readonly indices: GPUBuffer;
  readonly indexCount: number;
  readonly indexStart: number;
}

interface GpuInstanceBuffer {
  readonly buffer: GPUBuffer;
  readonly byteLength: number;
}

type GpuInstanceBuffers = Map<string, Map<Uint8Array, GpuInstanceBuffer>>;

interface PreparedGeometry {
  readonly resource: PortableGeometryPayload;
  readonly geometry: GpuGeometry;
}

/** A concrete offscreen TypeGPU renderer whose accepted submissions produce RGBA pixels. */
export class TypeGpuExampleRendererDevice implements ExampleRendererDevice {
  readonly shader: ExampleRendererShader;
  readonly #recording: RecordingExampleRendererDevice;
  readonly width: number;
  readonly height: number;
  readonly #device: GPUDevice;
  readonly #root;
  readonly #target;
  readonly #targetView;
  readonly #viewport;
  readonly #viewportGroup;
  readonly #pipeline;
  // Font bindings are host-lifetime; their geometry is released with the device.
  readonly #geometries = new Map<PortableGeometryPayload, GpuGeometry>();
  readonly #instanceBuffers: GpuInstanceBuffers = new Map();
  #submittedPasses = 0;
  #lost = false;
  #disposed = false;

  /** Creates an offscreen TypeGPU renderer around a caller-owned WebGPU device. */
  constructor(options: TypeGpuExampleRendererDeviceOptions) {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('TypeGPU example renderer options must be an object');
    }
    this.width = positiveDimension(options.width, 'width');
    this.height = positiveDimension(options.height, 'height');
    if (typeof options.device !== 'object' || options.device === null) {
      throw new TypeError('TypeGPU example renderer needs a GPU device');
    }
    this.#device = options.device;
    this.shader = exampleRendererShader;
    this.#recording = new RecordingExampleRendererDevice(this.shader);
    this.#root = tgpu.initFromDevice({ device: this.#device });
    this.#target = this.#root
      .createTexture({ size: [this.width, this.height], format: 'rgba8unorm' })
      .$overrideFlags(GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
    this.#targetView = this.#target.createView('render');
    this.#viewport = this.#root.createUniform(d.vec2f, [this.width, this.height]);
    this.#viewportGroup = this.#root.createBindGroup(viewportLayout, { viewport: this.#viewport });
    this.#pipeline = this.#root.createRenderPipeline({
      attribs: {
        position: positionLayout.attrib,
        uv: uvLayout.attrib,
        origin: originLayout.attrib,
        size: sizeLayout.attrib,
        color: colorLayout.attrib,
      },
      vertex: vertexMain,
      fragment: fragmentMain,
      targets: {
        format: 'rgba8unorm',
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        },
      },
      primitive: { topology: 'triangle-list' },
    });
    this.#pipeline.initSync();
    void this.#device.lost.then(() => {
      this.#lost = true;
    });
  }

  /** Number of render passes submitted by accepted, non-idle publications. */
  get submittedPasses(): number {
    return this.#submittedPasses;
  }

  /** Stages one bound publication, including portable resources, buffers, and GPU submission. */
  decode(frame: CommandBufferView<ExampleBindings>): ExamplePendingSubmission {
    this.#assertActive();
    const pending = this.#recording.decode(frame);
    if (!pending.replacesRenderState) {
      let active = true;
      return Object.freeze({
        result: pending.result,
        commit: () => {
          if (!active) return false;
          active = false;
          this.#assertActive();
          return pending.publish(() => {});
        },
        discard: () => {
          active = false;
          pending.discard();
        },
      });
    }
    const geometryName =
      this.shader.variant.geometry.kind === 'synthetic-quad' ? undefined : this.shader.variant.geometry.resource;
    const activeGeometryResources = new Set<PortableGeometryPayload>();
    for (const [binding, resource] of pending.activeResources) {
      if (binding.name === geometryName && resource.kind === 'geometry') activeGeometryResources.add(resource);
    }
    const candidateGeometries = new Map(
      [...this.#geometries].filter(([resource]) => activeGeometryResources.has(resource)),
    );
    const preparedGeometries: PreparedGeometry[] = [];
    let buffers: GpuInstanceBuffers;
    try {
      if (geometryName !== undefined) {
        for (const resource of activeGeometryResources) {
          if (candidateGeometries.has(resource)) continue;
          const geometry = this.#createGeometry(geometryName, resource);
          preparedGeometries.push({ resource, geometry });
          candidateGeometries.set(resource, geometry);
        }
      }
      buffers = this.#prepareInstanceBuffers(pending.realizedDraws);
    } catch (error) {
      for (const entry of preparedGeometries) destroyGeometry(entry.geometry);
      pending.discard();
      throw error;
    }
    let active = true;
    return Object.freeze({
      result: pending.result,
      commit: () => {
        if (!active) return false;
        active = false;
        try {
          this.#assertActive();
          const accepted = pending.publish(() =>
            this.#submitValidated(pending.realizedDraws, buffers, candidateGeometries),
          );
          if (!accepted) {
            destroyInstanceBuffers(buffers);
            for (const entry of preparedGeometries) destroyGeometry(entry.geometry);
            return false;
          }
        } catch (error) {
          destroyInstanceBuffers(buffers);
          for (const entry of preparedGeometries) destroyGeometry(entry.geometry);
          throw error;
        }
        for (const [resource, geometry] of this.#geometries) {
          if (!candidateGeometries.has(resource)) destroyGeometry(geometry);
        }
        this.#geometries.clear();
        for (const [resource, geometry] of candidateGeometries) this.#geometries.set(resource, geometry);
        destroyInstanceBuffers(this.#instanceBuffers);
        this.#instanceBuffers.clear();
        for (const [name, byBytes] of buffers) this.#instanceBuffers.set(name, byBytes);
        return true;
      },
      discard: () => {
        if (!active) return;
        active = false;
        pending.discard();
        destroyInstanceBuffers(buffers);
        for (const entry of preparedGeometries) destroyGeometry(entry.geometry);
      },
    });
  }

  /** Clears accepted host state while keeping the caller-owned device usable. */
  reset(): void {
    this.#assertActive();
    this.#recording.reset();
    for (const geometry of this.#geometries.values()) destroyGeometry(geometry);
    this.#geometries.clear();
    destroyInstanceBuffers(this.#instanceBuffers);
    this.#instanceBuffers.clear();
  }

  /** Returns a caller-owned RGBA snapshot after submitted GPU work completes. */
  async readPixels(): Promise<Uint8Array> {
    this.#assertActive();
    const bytesPerRow = this.width * 4;
    const paddedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256;
    let readback: GPUBuffer | undefined;
    let scopeActive = true;
    this.#device.pushErrorScope('validation');
    try {
      readback = this.#device.createBuffer({
        size: paddedBytesPerRow * this.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = this.#device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: this.#root.unwrap(this.#target) },
        { buffer: readback, bytesPerRow: paddedBytesPerRow, rowsPerImage: this.height },
        { width: this.width, height: this.height },
      );
      this.#device.queue.submit([encoder.finish()]);
      const validationResult = this.#device.popErrorScope();
      scopeActive = false;
      const validationError = await validationResult;
      if (validationError !== null) throw gpuOperationError('read pixels', validationError);
      await readback.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readback.getMappedRange());
      const pixels = new Uint8Array(bytesPerRow * this.height);
      for (let row = 0; row < this.height; row += 1) {
        pixels.set(mapped.subarray(row * paddedBytesPerRow, row * paddedBytesPerRow + bytesPerRow), row * bytesPerRow);
      }
      readback.unmap();
      return pixels;
    } catch (error) {
      if (scopeActive) {
        const validationResult = this.#device.popErrorScope();
        scopeActive = false;
        const validationError = await validationResult;
        if (validationError !== null) throw gpuOperationError('read pixels', validationError);
      }
      throw error;
    } finally {
      readback?.destroy();
    }
  }

  /** Releases every GPU resource owned by this renderer; the caller still owns the device. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const geometry of this.#geometries.values()) destroyGeometry(geometry);
    this.#geometries.clear();
    destroyInstanceBuffers(this.#instanceBuffers);
    this.#target.destroy();
    this.#viewport.buffer.destroy();
    this.#root.destroy();
  }

  #createGeometry(name: string, payload: PortableGeometryPayload): GpuGeometry {
    const position = geometryAttribute(payload, name, 'position', 'f32', 3);
    const uv = geometryAttribute(payload, name, 'uv', 'f32', 2);
    const indices = geometryIndices(payload, name);
    const positionBuffer = this.#createPositionBuffer(position.bytes, position.count);
    let uvBuffer: GPUBuffer | undefined;
    let indexBuffer: GPUBuffer | undefined;
    try {
      uvBuffer = this.#createUvBuffer(uv.bytes, uv.count);
      indexBuffer = this.#createIndexBuffer(indices.bytes, indices.count);
      return {
        position: positionBuffer,
        uv: uvBuffer,
        indices: indexBuffer,
        indexCount: payload.drawRange?.count ?? indices.count,
        indexStart: payload.drawRange?.start ?? 0,
      };
    } catch (error) {
      positionBuffer.destroy();
      uvBuffer?.destroy();
      indexBuffer?.destroy();
      throw error;
    }
  }

  #createPositionBuffer(bytes: ArrayBuffer, count: number): GPUBuffer {
    const buffer = this.#root.createBuffer(positionLayout.schemaForCount(count)).$usage('vertex');
    buffer.write(bytes);
    return this.#root.unwrap(buffer);
  }

  #createUvBuffer(bytes: ArrayBuffer, count: number): GPUBuffer {
    const buffer = this.#root.createBuffer(uvLayout.schemaForCount(count)).$usage('vertex');
    buffer.write(bytes);
    return this.#root.unwrap(buffer);
  }

  #createIndexBuffer(bytes: ArrayBuffer, count: number): GPUBuffer {
    const buffer = this.#root.createBuffer(d.arrayOf(d.u16, count)).$usage('index');
    buffer.write(bytes);
    return this.#root.unwrap(buffer);
  }

  #prepareInstanceBuffers(realizedDraws: readonly ExampleRealizedDraw[]): GpuInstanceBuffers {
    const prepared: GpuInstanceBuffers = new Map();
    try {
      for (const realized of realizedDraws) {
        for (const [name, declaration] of Object.entries(this.shader.variant.buffers)) {
          if (declaration.scalar !== 'f32') {
            throw new TypeError(`TypeGPU example renderer does not support ${declaration.scalar} buffer "${name}"`);
          }
          const bytes = realized.buffers.get(name);
          if (bytes === undefined) throw new Error(`TypeGPU example renderer is missing accepted "${name}" bytes`);
          const byBytes = prepared.get(name) ?? new Map<Uint8Array, GpuInstanceBuffer>();
          if (byBytes.has(bytes)) continue;
          const scalarBytes = declaration.vectorWidth * 4;
          if (bytes.byteLength % scalarBytes !== 0) {
            throw new RangeError(`TypeGPU example renderer buffer "${name}" has a partial record`);
          }
          const count = bytes.byteLength / scalarBytes;
          const typed = this.#createInstanceBuffer(name, declaration.vectorWidth, count);
          typed.write(exactBuffer(bytes));
          byBytes.set(bytes, { buffer: this.#root.unwrap(typed), byteLength: bytes.byteLength });
          prepared.set(name, byBytes);
        }
      }
      return prepared;
    } catch (error) {
      destroyInstanceBuffers(prepared);
      throw error;
    }
  }

  #encodeAcceptedState(
    realizedDraws: readonly ExampleRealizedDraw[],
    buffers: ReadonlyMap<string, ReadonlyMap<Uint8Array, GpuInstanceBuffer>>,
    geometries: ReadonlyMap<PortableGeometryPayload, GpuGeometry>,
  ): GPUCommandBuffer {
    if (realizedDraws.length === 0) {
      const encoder = this.#root['~unstable'].createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#targetView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.end();
      return encoder.finish();
    }
    const encoder = this.#root['~unstable'].createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    try {
      for (const realized of realizedDraws) {
        const geometryName = realized.geometry.resourceName;
        if (geometryName === undefined) throw new Error('TypeGPU example renderer needs supplied geometry');
        const geometryResource = realized.resources.get(geometryName);
        const geometry = geometryResource?.kind === 'geometry' ? geometries.get(geometryResource) : undefined;
        if (geometry === undefined) {
          throw new Error(`TypeGPU example renderer has no realized "${geometryName}" geometry`);
        }
        const origin = gpuBufferForDraw(buffers, realized, 'origin');
        const size = gpuBufferForDraw(buffers, realized, 'size');
        const color = gpuBufferForDraw(buffers, realized, 'color');
        const drawGeometry = realized.geometry;
        this.#pipeline
          .with(this.#viewportGroup)
          .with(positionLayout, geometry.position)
          .with(uvLayout, geometry.uv)
          .with(originLayout, origin)
          .with(sizeLayout, size)
          .with(colorLayout, color)
          .with(pass)
          .withIndexBuffer(geometry.indices, 'uint16')
          .drawIndexed(
            drawGeometry.indexCount,
            drawGeometry.instanceCount,
            drawGeometry.indexStart,
            0,
            realized.primitive.recordIndex,
          );
      }
    } finally {
      pass.end();
    }
    return encoder.finish();
  }

  #createInstanceBuffer(name: string, vectorWidth: number, count: number) {
    if (name === 'origin' && vectorWidth === 2)
      return this.#root.createBuffer(originLayout.schemaForCount(count)).$usage('vertex');
    if (name === 'size' && vectorWidth === 2)
      return this.#root.createBuffer(sizeLayout.schemaForCount(count)).$usage('vertex');
    if (name === 'color' && vectorWidth === 4)
      return this.#root.createBuffer(colorLayout.schemaForCount(count)).$usage('vertex');
    throw new TypeError(`TypeGPU example renderer has no vertex layout for "${name}" f32x${vectorWidth}`);
  }

  #submitValidated(
    realizedDraws: readonly ExampleRealizedDraw[],
    buffers: ReadonlyMap<string, ReadonlyMap<Uint8Array, GpuInstanceBuffer>>,
    geometries: ReadonlyMap<PortableGeometryPayload, GpuGeometry>,
  ): void {
    const command = this.#encodeAcceptedState(realizedDraws, buffers, geometries);
    this.#device.queue.submit([command]);
    // CPU submission acceptance commits the candidate; later WebGPU faults enter device-loss recovery.
    this.#assertActive();
    this.#submittedPasses += 1;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('TypeGPU example renderer is disposed');
    if (this.#lost) throw new Error('TypeGPU example renderer device is lost');
  }
}

function geometryAttribute(
  payload: PortableGeometryPayload,
  name: string,
  semantic: 'position' | 'uv',
  componentType: 'f32',
  components: 2 | 3,
): { readonly bytes: ArrayBuffer; readonly count: number } {
  const attribute = payload.attributes.find((candidate) => candidate.semantic === semantic);
  if (attribute === undefined) throw new TypeError(`geometry "${name}" is missing ${semantic}`);
  const accessor = payload.accessors[attribute.accessor];
  if (accessor === undefined || accessor.componentType !== componentType || accessor.components !== components) {
    throw new TypeError(`geometry "${name}" has an incompatible ${semantic} accessor`);
  }
  if (accessor.view === undefined) throw new TypeError(`geometry "${name}" ${semantic} accessor needs a view`);
  return {
    bytes: accessorBytes(payload, accessor.view, accessor.offset ?? 0, accessor.count * components * 4),
    count: accessor.count,
  };
}

function geometryIndices(
  payload: PortableGeometryPayload,
  name: string,
): { readonly bytes: ArrayBuffer; readonly count: number } {
  const indices = payload.indices;
  const accessor = indices === undefined ? undefined : payload.accessors[indices.accessor];
  if (accessor === undefined || accessor.componentType !== 'u16' || accessor.components !== 1) {
    throw new TypeError(`geometry "${name}" needs u16 indices`);
  }
  if (accessor.view === undefined) throw new TypeError(`geometry "${name}" index accessor needs a view`);
  return {
    bytes: accessorBytes(payload, accessor.view, accessor.offset ?? 0, accessor.count * 2),
    count: accessor.count,
  };
}

function accessorBytes(
  payload: PortableGeometryPayload,
  viewIndex: number,
  offset: number,
  length: number,
): ArrayBuffer {
  const view = payload.views[viewIndex];
  if (view === undefined) throw new TypeError('geometry accessor references an unknown view');
  return exactBuffer(payload.bytes.subarray(view.offset + offset, view.offset + offset + length));
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function positiveDimension(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`TypeGPU target ${name} must be a positive integer`);
  return value;
}

function gpuBufferForDraw(
  buffers: ReadonlyMap<string, ReadonlyMap<Uint8Array, GpuInstanceBuffer>>,
  realized: ExampleRealizedDraw,
  name: string,
): GPUBuffer {
  const bytes = realized.buffers.get(name);
  const buffer = bytes === undefined ? undefined : buffers.get(name)?.get(bytes)?.buffer;
  if (buffer === undefined) throw new Error(`TypeGPU example renderer has no realized "${name}" buffer for this draw`);
  return buffer;
}

function gpuOperationError(operation: string, error: GPUError): Error {
  return new Error(`TypeGPU example renderer failed to ${operation}: ${error.message}`, { cause: error });
}

function destroyGeometry(geometry: GpuGeometry): void {
  geometry.position.destroy();
  geometry.uv.destroy();
  geometry.indices.destroy();
}

function destroyInstanceBuffers(buffers: ReadonlyMap<string, ReadonlyMap<Uint8Array, GpuInstanceBuffer>>): void {
  for (const byBytes of buffers.values()) {
    for (const entry of byBytes.values()) entry.buffer.destroy();
  }
}
