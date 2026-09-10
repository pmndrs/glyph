/// <reference types="@webgpu/types" />
import type { TgpuRoot, TgpuUniform, TgpuBindGroup, TgpuRenderPass } from 'typegpu';
import { d } from 'typegpu';
import type { CodecBufferId, CommandBufferView, GlyphRenderer, PreparedRendererCommit } from '../../index.js';
import type { Bindings, BufferBinding } from './bindings.js';
import type { Draw, TypeGpuResource } from './resources.js';
import { TYPEGPU_PLACEMENT_SLOT_BUFFER_ID } from './codec.js';

export interface TypeGpuTransform {
  readonly position: TgpuUniform<d.Vec2f>;
}
interface RetainedBuffer {
  readonly bytes: Uint8Array;
  readonly gpu: GPUBuffer;
}
type BufferMutation =
  | { readonly kind: 'write'; readonly target: RetainedBuffer; readonly offset: number; readonly payload: Uint8Array }
  | {
      readonly kind: 'fill';
      readonly target: RetainedBuffer;
      readonly offset: number;
      readonly length: number;
      readonly value: number;
    }
  | {
      readonly kind: 'copy';
      readonly target: RetainedBuffer;
      readonly offset: number;
      readonly source: RetainedBuffer;
      readonly sourceOffset: number;
      readonly length: number;
    };
interface UploadRange {
  start: number;
  end: number;
}
interface Span {
  readonly resource: TypeGpuResource;
  readonly buffers: readonly BufferBinding[];
  readonly transform: TypeGpuTransform;
  readonly start: number;
  readonly count: number;
}

/** Retains only owned bytes and host objects; borrowed command sequences never escape decode(). */
export class Renderer implements GlyphRenderer<Bindings, void> {
  readonly #root: TgpuRoot;
  readonly #viewport: TgpuUniform<d.Vec2f>;
  #buffers = new Map<BufferBinding, RetainedBuffer>();
  #placementTable: RetainedBuffer | undefined;
  #spans: readonly Span[] = [];
  #draws: readonly Draw[] = [];
  #disposed = false;
  constructor(root: TgpuRoot) {
    this.#root = root;
    this.#viewport = root.createUniform(d.vec2f, [1, 1]);
  }
  draw(
    pass: TgpuRenderPass | GPURenderPassEncoder,
    width: number,
    height: number,
    bindGroups: readonly TgpuBindGroup[],
  ): void {
    if (this.#disposed) throw new Error('TypeGPU root is disposed');
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new RangeError('TypeGPU viewport width and height must be positive and finite');
    }
    this.#viewport.write([width, height]);
    for (const draw of this.#draws) draw.draw(pass, bindGroups);
  }
  decode(frame: CommandBufferView<Bindings>): PreparedRendererCommit<void> {
    const buffers = new Map(this.#buffers);
    const allocated: GPUBuffer[] = [];
    const mutations: BufferMutation[] = [];
    const uploads = new Map<RetainedBuffer, UploadRange[]>();
    const includeUpload = (target: RetainedBuffer, start: number, length: number): void => {
      if (length === 0) return;
      const ranges = uploads.get(target) ?? [];
      let end = start + length;
      for (let index = ranges.length - 1; index >= 0; index--) {
        const range = ranges[index]!;
        if (range.end < start || end < range.start) continue;
        start = Math.min(start, range.start);
        end = Math.max(end, range.end);
        ranges.splice(index, 1);
      }
      // Bound submission overhead for heavily fragmented edits, as in the Three host.
      if (ranges.length >= 32) {
        for (const range of ranges) {
          start = Math.min(start, range.start);
          end = Math.max(end, range.end);
        }
        ranges.length = 0;
      }
      ranges.push({ start, end });
      uploads.set(target, ranges);
    };
    try {
      for (const update of frame.updates.buffers) {
        const previous = buffers.get(update.buffer);
        if (previous?.bytes.byteLength === update.byteLength) continue;
        const next = new Uint8Array(update.byteLength);
        if (previous !== undefined) next.set(previous.bytes.subarray(0, next.length));
        const gpu = this.#root.device.createBuffer({
          size: Math.max(4, next.byteLength),
          usage:
            update.buffer.input.declaration.kind === 'placement' ||
            (update.buffer.input.declaration.kind === 'codec' &&
              update.buffer.input.declaration.value.id === TYPEGPU_PLACEMENT_SLOT_BUFFER_ID)
              ? GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
              : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        allocated.push(gpu);
        const target = { bytes: next, gpu };
        buffers.set(update.buffer, target);
        includeUpload(target, 0, next.byteLength);
      }
      for (const patch of frame.updates.patches) {
        switch (patch.kind) {
          case 'write': {
            const target = buffers.get(patch.buffer)!;
            mutations.push({ kind: 'write', target, offset: patch.destinationOffset, payload: patch.payload.slice() });
            includeUpload(target, patch.destinationOffset, patch.payload.byteLength);
            break;
          }
          case 'fill': {
            const target = buffers.get(patch.buffer)!;
            mutations.push({
              kind: 'fill',
              target,
              offset: patch.destinationOffset,
              length: patch.byteLength,
              value: patch.value,
            });
            includeUpload(target, patch.destinationOffset, patch.byteLength);
            break;
          }
          case 'copy': {
            const target = buffers.get(patch.destination)!;
            mutations.push({
              kind: 'copy',
              target,
              offset: patch.destinationOffset,
              source: buffers.get(patch.source)!,
              sourceOffset: patch.sourceOffset,
              length: patch.byteLength,
            });
            includeUpload(target, patch.destinationOffset, patch.byteLength);
            break;
          }
          case 'allocate-or-resize':
          case 'retire':
            break;
        }
      }
      for (const retirement of frame.updates.retirements) {
        if (retirement.kind === 'buffer') buffers.delete(retirement.buffer);
      }
      const placementTables = [...buffers.entries()].filter(
        ([binding]) => binding.input.declaration.kind === 'placement',
      );
      if (placementTables.length > 1) throw new Error('TypeGPU received more than one session placement table');
      const placementTable = placementTables[0]?.[1];
      let spans = this.#spans;
      if (frame.displayList.kind === 'replace') {
        const next: Span[] = [];
        for (const child of frame.displayList.value.children) {
          // The direct Codec preserves a separate host transform for each Text.
          if (child.kind !== 'instance') throw new Error('TypeGPU direct Codec emitted a batch');
          const input = child.value.input;
          const primitive = input.instance.value.input;
          if (primitive.recordCount === 0) continue;
          next.push({
            resource: primitive.resource!,
            buffers: Array.from(input.buffers),
            transform: child.transform!,
            start: primitive.recordIndex,
            count: primitive.recordCount,
          });
        }
        spans = next;
      }
      const draws =
        spans === this.#spans && allocated.length === 0 && placementTable === this.#placementTable
          ? this.#draws
          : spans.map((span, index) => {
              const previous = this.#spans[index];
              if (
                previous !== undefined &&
                span.resource === previous.resource &&
                span.transform === previous.transform &&
                span.start === previous.start &&
                span.count === previous.count &&
                span.buffers.length === previous.buffers.length &&
                span.buffers.every(
                  (binding, bufferIndex) =>
                    binding === previous.buffers[bufferIndex] && buffers.get(binding) === this.#buffers.get(binding),
                )
              ) {
                return this.#draws[index]!;
              }
              const named = new Map<CodecBufferId, GPUBuffer>();
              for (const binding of span.buffers) {
                if (binding.input.declaration.kind === 'codec')
                  named.set(binding.input.declaration.value.id, buffers.get(binding)!.gpu);
              }
              if (placementTable === undefined)
                throw new Error('TypeGPU glyph draw is missing its session placement table');
              return span.resource.prepare(
                named,
                placementTable.gpu,
                this.#viewport,
                span.transform.position,
                span.start,
                span.count,
              );
            });
      let active = true;
      return {
        result: undefined,
        commit: () => {
          if (!active) return;
          active = false;
          // Decode only owns patches. Mutate retained storage after every participant accepts the frame.
          for (const mutation of mutations) commitMutation(mutation);
          for (const [target, ranges] of uploads) {
            for (const range of ranges) {
              this.#root.device.queue.writeBuffer(
                target.gpu,
                range.start,
                target.bytes.subarray(range.start, range.end),
              );
            }
          }
          for (const [key, previous] of this.#buffers) if (buffers.get(key) !== previous) previous.gpu.destroy();
          this.#buffers = buffers;
          this.#placementTable = placementTable;
          this.#spans = spans;
          this.#draws = draws;
        },
        discard: () => {
          if (!active) return;
          active = false;
          for (const gpu of allocated) gpu.destroy();
        },
      };
    } catch (error) {
      for (const gpu of allocated) gpu.destroy();
      throw error;
    }
  }
  syncTransforms(): void {}
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const value of this.#buffers.values()) value.gpu.destroy();
    this.#buffers.clear();
    this.#placementTable = undefined;
    this.#draws = [];
    this.#spans = [];
    this.#viewport.buffer.destroy();
  }
}

function commitMutation(mutation: BufferMutation): void {
  const destination = mutation.target.bytes;
  if (mutation.kind === 'write') {
    destination.set(mutation.payload, mutation.offset);
  } else if (mutation.kind === 'fill') {
    const view = new DataView(destination.buffer, destination.byteOffset + mutation.offset, mutation.length);
    for (let offset = 0; offset < mutation.length; offset += 4) view.setUint32(offset, mutation.value, true);
  } else if (mutation.target === mutation.source) {
    destination.copyWithin(mutation.offset, mutation.sourceOffset, mutation.sourceOffset + mutation.length);
  } else {
    destination.set(
      mutation.source.bytes.subarray(mutation.sourceOffset, mutation.sourceOffset + mutation.length),
      mutation.offset,
    );
  }
}
