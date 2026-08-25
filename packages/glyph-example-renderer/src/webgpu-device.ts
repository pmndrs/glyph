import tgpu from 'typegpu';
import * as d from 'typegpu/data';

import type { PortableGeometryPayload } from '@pmndrs/glyph/core';
import {
  TypeGpuGlyphExampleFragmentInput,
  TypeGpuGlyphExampleVertexInput,
  glyphExampleFragment,
  glyphExampleVertex,
} from '@pmndrs/glyph-example-raster/typegpu';

import type { ExampleDrawList } from './draw-list.js';
import {
  RecordingExampleRendererDevice,
  exampleRendererShader,
  type ExamplePendingResources,
  type ExamplePendingSubmission,
  type ExampleRendererDevice,
  type ExampleRendererResourceInput,
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

interface PreparedGeometry {
  readonly resource: unknown;
  readonly geometry: GpuGeometry;
}

/** A concrete offscreen TypeGPU renderer whose accepted submissions produce RGBA pixels. */
export class TypeGpuExampleRendererDevice implements ExampleRendererDevice {
  readonly shader: ExampleRendererShader;
  readonly recording: RecordingExampleRendererDevice;
  readonly width: number;
  readonly height: number;
  readonly #device: GPUDevice;
  readonly #root;
  readonly #target;
  readonly #targetView;
  readonly #viewport;
  readonly #viewportGroup;
  readonly #pipeline;
  readonly #geometries = new Map<string, GpuGeometry>();
  readonly #instanceBuffers = new Map<string, GpuInstanceBuffer>();
  #lost = false;
  #disposed = false;

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
    this.recording = new RecordingExampleRendererDevice(this.shader);
    this.#root = tgpu.initFromDevice({ device: this.#device });
    this.#target = this.#root['~unstable']
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

  prepareResources(resources: readonly ExampleRendererResourceInput[]): ExamplePendingResources {
    this.#assertLive();
    const pending = this.recording.prepareResources(resources);
    const prepared = new Map<string, PreparedGeometry>();
    try {
      for (const input of resources) {
        if (input.name !== this.shader.variant.geometry.resource) continue;
        const previous = prepared.get(input.name);
        const geometry = this.#createGeometry(input.name, input.resource as PortableGeometryPayload);
        prepared.set(input.name, { resource: input.resource, geometry });
        if (previous !== undefined) destroyGeometry(previous.geometry);
      }
    } catch (error) {
      for (const entry of prepared.values()) destroyGeometry(entry.geometry);
      throw error;
    }
    let active = true;
    return Object.freeze({
      commit: () => {
        if (!active) return;
        active = false;
        pending.commit();
        for (const [name, entry] of prepared) {
          if (this.recording.resourcesByName.get(name) !== entry.resource) {
            destroyGeometry(entry.geometry);
            continue;
          }
          const previous = this.#geometries.get(name);
          this.#geometries.set(name, entry.geometry);
          if (previous !== undefined) destroyGeometry(previous);
        }
      },
    });
  }

  prepareSubmission(drawList: ExampleDrawList): ExamplePendingSubmission {
    this.#assertLive();
    const pending = this.recording.prepareSubmission(drawList);
    const buffers = this.#prepareInstanceBuffers(pending.buffersByName, pending.realizedDraws.length !== 0);
    let command: GPUCommandBuffer;
    try {
      command = this.#encodeAcceptedState(pending.realizedDraws, buffers);
    } catch (error) {
      destroyInstanceBuffers(buffers);
      throw error;
    }
    let active = true;
    return Object.freeze({
      commit: () => {
        if (!active) return;
        active = false;
        this.#assertLive();
        let accepted = false;
        try {
          accepted = pending.publish(() => this.#device.queue.submit([command]));
        } catch (error) {
          destroyInstanceBuffers(buffers);
          throw error;
        }
        if (!accepted) {
          destroyInstanceBuffers(buffers);
          return;
        }
        destroyInstanceBuffers(this.#instanceBuffers);
        this.#instanceBuffers.clear();
        for (const [name, buffer] of buffers) this.#instanceBuffers.set(name, buffer);
      },
    });
  }

  /** Copies the most recently submitted offscreen target into tightly packed RGBA bytes. */
  async readPixels(): Promise<Uint8Array> {
    this.#assertLive();
    const bytesPerRow = this.width * 4;
    const paddedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256;
    const readback = this.#device.createBuffer({
      size: paddedBytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.#device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: this.#root.unwrap(this.#target) },
        { buffer: readback, bytesPerRow: paddedBytesPerRow, rowsPerImage: this.height },
        { width: this.width, height: this.height },
      );
      this.#device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readback.getMappedRange());
      const pixels = new Uint8Array(bytesPerRow * this.height);
      for (let row = 0; row < this.height; row += 1) {
        pixels.set(mapped.subarray(row * paddedBytesPerRow, row * paddedBytesPerRow + bytesPerRow), row * bytesPerRow);
      }
      readback.unmap();
      return pixels;
    } finally {
      readback.destroy();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const geometry of this.#geometries.values()) destroyGeometry(geometry);
    for (const entry of this.#instanceBuffers.values()) entry.buffer.destroy();
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

  #prepareInstanceBuffers(source: ReadonlyMap<string, Uint8Array>, required: boolean): Map<string, GpuInstanceBuffer> {
    const prepared = new Map<string, GpuInstanceBuffer>();
    if (!required) return prepared;
    try {
      for (const name of ['origin', 'size', 'color'] as const) {
        const bytes = source.get(name);
        if (bytes === undefined) throw new Error(`TypeGPU example renderer is missing accepted "${name}" bytes`);
        const vectorWidth = name === 'color' ? 4 : 2;
        const count = bytes.byteLength / (vectorWidth * 4);
        const typed =
          name === 'origin'
            ? this.#root.createBuffer(originLayout.schemaForCount(count)).$usage('vertex')
            : name === 'size'
              ? this.#root.createBuffer(sizeLayout.schemaForCount(count)).$usage('vertex')
              : this.#root.createBuffer(colorLayout.schemaForCount(count)).$usage('vertex');
        typed.write(exactBuffer(bytes));
        prepared.set(name, { buffer: this.#root.unwrap(typed), byteLength: bytes.byteLength });
      }
      return prepared;
    } catch (error) {
      destroyInstanceBuffers(prepared);
      throw error;
    }
  }

  #encodeAcceptedState(
    realizedDraws: readonly ExampleRealizedDraw[],
    buffers: ReadonlyMap<string, GpuInstanceBuffer>,
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
    const geometryName = this.shader.variant.geometry.resource;
    if (geometryName === undefined) throw new Error('TypeGPU example renderer needs supplied geometry');
    const geometry = this.#geometries.get(geometryName);
    if (geometry === undefined) throw new Error(`TypeGPU example renderer has no "${geometryName}" geometry`);
    const origin = buffers.get('origin')?.buffer;
    const size = buffers.get('size')?.buffer;
    const color = buffers.get('color')?.buffer;
    if (origin === undefined || size === undefined || color === undefined) {
      throw new Error('TypeGPU example renderer has incomplete instance buffers');
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
    for (const realized of realizedDraws) {
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
    pass.end();
    return encoder.finish();
  }

  #assertLive(): void {
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

function destroyGeometry(geometry: GpuGeometry): void {
  geometry.position.destroy();
  geometry.uv.destroy();
  geometry.indices.destroy();
}

function destroyInstanceBuffers(buffers: ReadonlyMap<string, GpuInstanceBuffer>): void {
  for (const entry of buffers.values()) entry.buffer.destroy();
}
