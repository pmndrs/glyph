/// <reference types="@webgpu/types" />
import type { TgpuRoot, TgpuUniform, TgpuBindGroup, TgpuRenderPass } from 'typegpu';
import { d } from 'typegpu';
import type { CodecBufferId, CommandBufferView, GlyphRenderer, PreparedRendererCommit } from '../../index.js';
import type { DisplayList } from '../../config/glyph.js';
import type { Bindings, BufferBinding } from './bindings.js';
import type { BatchBinding, Draw, TypeGpuResource } from './pipeline.js';
import { TYPEGPU_PLACEMENT_SLOT_BUFFER_ID, TYPEGPU_TRANSFORM_INDEX_BUFFER_ID } from './codec.js';

/**
 * A Text's offset in logical pixels (its position plus anchor), held on the CPU. Writing it bumps `revision` and
 * reports the transform as changed; the renderer uploads changed offsets when it next draws, so a move needs no
 * shape() and costs one 8-byte write.
 */
export class TypeGpuTransform {
  x = 0;
  y = 0;
  revision = 0;
  /** The write path text.ts uses. */
  readonly position: { write(value: readonly [number, number]): void };
  constructor(changed: (transform: TypeGpuTransform) => void) {
    this.position = {
      write: (value) => {
        this.x = value[0];
        this.y = value[1];
        this.revision += 1;
        changed(this);
      },
    };
  }
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
interface StagedBuffers {
  readonly buffers: Map<BufferBinding, RetainedBuffer>;
  readonly allocated: GPUBuffer[];
  readonly mutations: BufferMutation[];
  readonly uploads: Map<RetainedBuffer, UploadRange[]>;
}
/** One instance span of the display list, in paint order. */
interface Span {
  readonly resource: TypeGpuResource;
  readonly buffers: readonly BufferBinding[];
  readonly start: number;
  readonly count: number;
  /** Direct (Slug) spans only: indexed programs read their Text's offset from the transform table. */
  readonly transform: TypeGpuTransform | undefined;
}
/** What a span draws through: shared bindings for an indexed program, or its own draw for a direct one. */
type SpanTarget =
  | { readonly kind: 'batch'; readonly binding: BatchBinding }
  | { readonly kind: 'direct'; readonly draw: Draw };
type Range =
  | {
      readonly kind: 'batch';
      readonly binding: BatchBinding;
      readonly variant: number;
      readonly first: number;
      count: number;
    }
  | { readonly kind: 'direct'; readonly draw: Draw };
interface BindingEntry {
  /** Everything the bindings captured: lane buffers in order, then the placement and transform tables. */
  readonly key: readonly GPUBuffer[];
  readonly binding: BatchBinding;
}
interface TransformTable {
  readonly gpu: GPUBuffer;
  readonly capacity: number;
}

const TRANSFORM_RECORD_BYTES = 8;

/** Retains only owned bytes and host objects; borrowed command sequences never escape decode(). */
export class Renderer implements GlyphRenderer<Bindings, void> {
  readonly #root: TgpuRoot;
  readonly #viewport: TgpuUniform<d.Vec2f>;
  #buffers = new Map<BufferBinding, RetainedBuffer>();
  #placementTable: RetainedBuffer | undefined;
  #spans: readonly Span[] = [];
  #targets: readonly SpanTarget[] = [];
  /** Program variant of each span, read from committed lane bytes; undefined until read. */
  #variants: (number | undefined)[] = [];
  #ranges: readonly Range[] = [];
  #bindings = new Map<TypeGpuResource, readonly BindingEntry[]>();
  #table: TransformTable;
  #records = new Map<TypeGpuTransform, number>();
  /** Revision of each transform the table (or its direct uniform) holds. */
  #uploaded = new WeakMap<TypeGpuTransform, number>();
  #changed = new Set<TypeGpuTransform>();
  /** Direct (Slug) draws position by uniform, one per Text. */
  #uniforms = new Map<TypeGpuTransform, TgpuUniform<d.Vec2f>>();
  #disposed = false;
  constructor(root: TgpuRoot) {
    this.#root = root;
    this.#viewport = root.createUniform(d.vec2f, [1, 1]);
    this.#table = this.#createTable(16);
  }
  /** The dirty hook every TypeGpuTransform of this root reports to. */
  readonly transformChanged = (transform: TypeGpuTransform): void => {
    this.#changed.add(transform);
  };
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
    this.#uploadChangedTransforms();
    for (const range of this.#ranges) {
      if (range.kind === 'direct') range.draw.draw(pass, bindGroups);
      else range.binding.draw(pass, bindGroups, range.variant, range.first, range.count);
    }
  }
  decode(frame: CommandBufferView<Bindings>): PreparedRendererCommit<void> {
    const staged: StagedBuffers = { buffers: new Map(this.#buffers), allocated: [], mutations: [], uploads: new Map() };
    const createdUniforms: [TypeGpuTransform, TgpuUniform<d.Vec2f>][] = [];
    let table = this.#table;
    try {
      stageBuffers(this.#root, frame, staged);
      const { buffers, allocated, mutations, uploads } = staged;
      const placementTables = [...buffers.entries()].filter(
        ([binding]) => binding.input.declaration.kind === 'placement',
      );
      if (placementTables.length > 1) throw new Error('TypeGPU received more than one session placement table');
      const placementTable = placementTables[0]?.[1];
      let records = this.#records;
      if (frame.displayList.kind === 'replace') {
        records = new Map();
        for (const transform of frame.displayList.value.transforms) records.set(transform.value, transform.recordIndex);
        let needed = 0;
        for (const record of records.values()) needed = Math.max(needed, record + 1);
        if (needed > table.capacity) table = this.#createTable(Math.max(needed, table.capacity * 2));
      }
      const spans =
        frame.displayList.kind === 'replace' && frame.displayList.retainedTopology !== true
          ? readSpans(frame.displayList.value.children)
          : this.#spans;
      const unchanged =
        spans === this.#spans &&
        allocated.length === 0 &&
        placementTable === this.#placementTable &&
        table === this.#table;
      const bindings = unchanged ? this.#bindings : new Map<TypeGpuResource, readonly BindingEntry[]>();
      const targets = unchanged
        ? this.#targets
        : spans.map((span, index): SpanTarget => {
            if (placementTable === undefined)
              throw new Error('TypeGPU glyph draw is missing its session placement table');
            const named = new Map<CodecBufferId, RetainedBuffer>();
            for (const binding of span.buffers) {
              if (binding.input.declaration.kind === 'codec') {
                named.set(binding.input.declaration.value.id, buffers.get(binding)!);
              }
            }
            if (span.resource.bind !== undefined) {
              return { kind: 'batch', binding: this.#binding(bindings, span, named, placementTable, table) };
            }
            return {
              kind: 'direct',
              draw: this.#directDraw(span, index, buffers, named, placementTable, createdUniforms),
            };
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
          const written = new Set<Uint8Array>();
          for (const target of uploads.keys()) written.add(target.bytes);
          for (const [key, previous] of this.#buffers) if (buffers.get(key) !== previous) previous.gpu.destroy();
          const previousTable = this.#table;
          if (table !== previousTable) previousTable.gpu.destroy();
          this.#buffers = buffers;
          this.#placementTable = placementTable;
          this.#table = table;
          this.#bindings = bindings;
          this.#variants = spans === this.#spans ? this.#variants : [];
          this.#spans = spans;
          this.#targets = targets;
          this.#ranges = this.#mergeRanges(written);
          if (records !== this.#records || table !== previousTable) {
            this.#writeTransforms(records, table !== previousTable ? undefined : this.#records);
            this.#records = records;
          }
          this.#retireUniforms();
        },
        discard: () => {
          if (!active) return;
          active = false;
          for (const gpu of allocated) gpu.destroy();
          if (table !== this.#table) table.gpu.destroy();
          this.#discardUniforms(createdUniforms);
        },
      };
    } catch (error) {
      for (const gpu of staged.allocated) gpu.destroy();
      if (table !== this.#table) table.gpu.destroy();
      this.#discardUniforms(createdUniforms);
      throw error;
    }
  }
  syncTransforms(): void {}
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const value of this.#buffers.values()) value.gpu.destroy();
    for (const uniform of this.#uniforms.values()) uniform.buffer.destroy();
    this.#buffers.clear();
    this.#uniforms.clear();
    this.#bindings.clear();
    this.#records.clear();
    this.#changed.clear();
    this.#placementTable = undefined;
    this.#spans = [];
    this.#targets = [];
    this.#ranges = [];
    this.#table.gpu.destroy();
    this.#viewport.buffer.destroy();
  }

  #createTable(capacity: number): TransformTable {
    const gpu = this.#root.device.createBuffer({
      size: capacity * TRANSFORM_RECORD_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    return { gpu, capacity };
  }
  /** Shared bindings for one resource over one buffer set and the session tables, reused while all of them live. */
  #binding(
    bindings: Map<TypeGpuResource, readonly BindingEntry[]>,
    span: Span,
    named: ReadonlyMap<CodecBufferId, RetainedBuffer>,
    placementTable: RetainedBuffer,
    table: TransformTable,
  ): BatchBinding {
    const key = [...Array.from(named.values(), (retained) => retained.gpu), placementTable.gpu, table.gpu];
    const matches = (entry: BindingEntry): boolean =>
      entry.key.length === key.length && entry.key.every((gpu, index) => gpu === key[index]);
    const current = bindings.get(span.resource) ?? [];
    const found = current.find(matches) ?? this.#bindings.get(span.resource)?.find(matches);
    if (found !== undefined) {
      if (!current.includes(found)) bindings.set(span.resource, [...current, found]);
      return found.binding;
    }
    const binding = span.resource.bind!({
      buffers: new Map(Array.from(named, ([id, retained]) => [id, retained.gpu])),
      bytes: new Map(Array.from(named, ([id, retained]) => [id, retained.bytes])),
      placementTable: placementTable.gpu,
      transformTable: table.gpu,
      viewport: this.#viewport,
    });
    bindings.set(span.resource, [...current, { key, binding }]);
    return binding;
  }
  /** A direct span's own draw, reused while its span, lanes and placement table are the ones it was built over. */
  #directDraw(
    span: Span,
    index: number,
    buffers: ReadonlyMap<BufferBinding, RetainedBuffer>,
    named: ReadonlyMap<CodecBufferId, RetainedBuffer>,
    placementTable: RetainedBuffer,
    createdUniforms: [TypeGpuTransform, TgpuUniform<d.Vec2f>][],
  ): Draw {
    const previous = this.#spans[index];
    const previousTarget = this.#targets[index];
    if (
      previous !== undefined &&
      previousTarget?.kind === 'direct' &&
      placementTable === this.#placementTable &&
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
      return previousTarget.draw;
    }
    const transform = span.transform;
    if (transform === undefined) throw new Error('TypeGPU direct draw is missing its Text transform');
    let uniform = this.#uniforms.get(transform);
    if (uniform === undefined) {
      uniform = this.#root.createUniform(d.vec2f, [transform.x, transform.y]);
      createdUniforms.push([transform, uniform]);
      this.#uniforms.set(transform, uniform);
    }
    return span.resource.prepare!(
      new Map(Array.from(named, ([id, retained]) => [id, retained.gpu])),
      placementTable.gpu,
      this.#viewport,
      uniform,
      span.start,
      span.count,
    );
  }
  /**
   * Paint-order draw ranges. Consecutive batched spans over the same bindings and program variant whose records are
   * contiguous become one instanced draw; a span's variant is re-read only when the lane that selects it was written.
   */
  #mergeRanges(written: ReadonlySet<Uint8Array>): Range[] {
    const ranges: Range[] = [];
    let last: Range | undefined;
    for (const [index, span] of this.#spans.entries()) {
      const target = this.#targets[index]!;
      if (target.kind === 'direct') {
        last = { kind: 'direct', draw: target.draw };
        ranges.push(last);
        continue;
      }
      const lane = target.binding.variantLane;
      let variant = this.#variants[index];
      if (variant === undefined || (lane !== undefined && written.has(lane))) {
        variant = target.binding.variant(span.start, span.count);
        this.#variants[index] = variant;
      }
      if (
        last?.kind === 'batch' &&
        last.binding === target.binding &&
        last.variant === variant &&
        last.first + last.count === span.start
      ) {
        last.count += span.count;
        continue;
      }
      last = { kind: 'batch', binding: target.binding, variant, first: span.start, count: span.count };
      ranges.push(last);
    }
    return ranges;
  }
  /**
   * Writes the records a new display list assigned: every record into a new table, otherwise only those whose
   * Text moved to another record or changed since it was uploaded. Many writes coalesce into one envelope.
   */
  #writeTransforms(
    records: ReadonlyMap<TypeGpuTransform, number>,
    previous: ReadonlyMap<TypeGpuTransform, number> | undefined,
  ): void {
    const changed: [TypeGpuTransform, number][] = [];
    for (const [transform, record] of records) {
      if (previous?.get(transform) === record && this.#uploaded.get(transform) === transform.revision) continue;
      changed.push([transform, record]);
    }
    if (changed.length === 0) return;
    let low = Infinity;
    let high = 0;
    for (const [, record] of changed) {
      low = Math.min(low, record);
      high = Math.max(high, record + 1);
    }
    const queue = this.#root.device.queue;
    if (changed.length <= 16) {
      for (const [transform, record] of changed) {
        queue.writeBuffer(
          this.#table.gpu,
          record * TRANSFORM_RECORD_BYTES,
          new Float32Array([transform.x, transform.y]),
        );
        this.#uploaded.set(transform, transform.revision);
      }
      return;
    }
    // Records outside `changed` inside the envelope are rewritten with their current, already uploaded values.
    const offsets = new Float32Array((high - low) * 2);
    for (const [transform, record] of records) {
      if (record < low || record >= high) continue;
      offsets[(record - low) * 2] = transform.x;
      offsets[(record - low) * 2 + 1] = transform.y;
      this.#uploaded.set(transform, transform.revision);
    }
    queue.writeBuffer(this.#table.gpu, low * TRANSFORM_RECORD_BYTES, offsets);
  }
  #uploadChangedTransforms(): void {
    if (this.#changed.size === 0) return;
    const value = new Float32Array(2);
    for (const transform of this.#changed) {
      value[0] = transform.x;
      value[1] = transform.y;
      this.#uniforms.get(transform)?.write(d.vec2f(transform.x, transform.y));
      const record = this.#records.get(transform);
      if (record === undefined || this.#uploaded.get(transform) === transform.revision) continue;
      this.#root.device.queue.writeBuffer(this.#table.gpu, record * TRANSFORM_RECORD_BYTES, value);
      this.#uploaded.set(transform, transform.revision);
    }
    this.#changed.clear();
  }
  #discardUniforms(created: readonly [TypeGpuTransform, TgpuUniform<d.Vec2f>][]): void {
    for (const [transform, uniform] of created) {
      this.#uniforms.delete(transform);
      uniform.buffer.destroy();
    }
  }
  /** Releases the uniforms of Texts no direct span draws any more. */
  #retireUniforms(): void {
    if (this.#uniforms.size === 0) return;
    const live = new Set<TypeGpuTransform>();
    for (const span of this.#spans) if (span.transform !== undefined) live.add(span.transform);
    for (const [transform, uniform] of this.#uniforms) {
      if (live.has(transform)) continue;
      uniform.buffer.destroy();
      this.#uniforms.delete(transform);
    }
  }
}

function readSpans(children: DisplayList<Bindings>['children']): Span[] {
  const spans: Span[] = [];
  for (const child of children) {
    if (child.kind === 'instance') {
      const input = child.value.input;
      const primitive = input.instance.value.input;
      if (primitive.recordCount === 0) continue;
      spans.push({
        resource: primitive.resource!,
        buffers: Array.from(input.buffers),
        start: primitive.recordIndex,
        count: primitive.recordCount,
        transform: child.transform,
      });
      continue;
    }
    const buffers = Array.from(child.value.input.buffers);
    for (const instance of child.instances) {
      const primitive = instance.value.input;
      if (primitive.recordCount === 0) continue;
      spans.push({
        resource: primitive.resource!,
        buffers,
        start: primitive.recordIndex,
        count: primitive.recordCount,
        transform: undefined,
      });
    }
  }
  return spans;
}

/** Sizes, patches and upload ranges of a frame; allocates replaced buffers, mutates nothing retained. */
function stageBuffers(root: TgpuRoot, frame: CommandBufferView<Bindings>, staged: StagedBuffers): void {
  const { buffers, allocated, mutations, uploads } = staged;
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
  for (const update of frame.updates.buffers) {
    const previous = buffers.get(update.buffer);
    if (previous?.bytes.byteLength === update.byteLength) continue;
    const next = new Uint8Array(update.byteLength);
    if (previous !== undefined) next.set(previous.bytes.subarray(0, next.length));
    const gpu = root.device.createBuffer({
      size: Math.max(4, next.byteLength),
      usage: isStorageLane(update.buffer)
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
}

/** Lanes a vertex stage indexes itself (placement table, placement slot, transform index) rather than steps through. */
function isStorageLane(buffer: BufferBinding): boolean {
  const declaration = buffer.input.declaration;
  return (
    declaration.kind === 'placement' ||
    declaration.value.id === TYPEGPU_PLACEMENT_SLOT_BUFFER_ID ||
    declaration.value.id === TYPEGPU_TRANSFORM_INDEX_BUFFER_ID
  );
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
