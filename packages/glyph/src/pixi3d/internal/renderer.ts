import type {
  BufferPatch,
  CommandBufferView,
  GlyphRenderer,
  LayoutPoint,
  PreparedRendererCommit,
} from '../../index.js';
import type { Container3D, Mesh3D } from '@pixi/3d';

import { Pixi3DMeshPool } from './mesh-pool.js';
import { pixi3dSystemBuffers } from './codec.js';
import type { Pixi3DBindings, Pixi3DBufferBinding } from './bindings.js';
import { createDecorationMeshes, createRasterMeshes, destroyBitmapMeshes, type RetainedPixi3DBuffer } from './mesh.js';
import type { Pixi3DResolvedResource } from './resource.js';
import type { Pixi3DText } from '../text.js';

interface Span {
  readonly resource: Pixi3DResolvedResource | undefined;
  readonly kind: 'glyph' | 'decoration';
  readonly buffers: readonly Pixi3DBufferBinding[];
  readonly transform: Pixi3DText;
  readonly start: number;
  readonly count: number;
}

/** @internal Shared identity placement; no metrics query or native transform write is required. */
export const zeroAnchor: LayoutPoint = Object.freeze({ x: 0, y: 0 });

interface PreparedDraw {
  offset: LayoutPoint;
  readonly span: Span;
  readonly meshes: readonly Mesh3D[];
}

export class Pixi3DRenderer implements GlyphRenderer<Pixi3DBindings, void> {
  #buffers = new Map<Pixi3DBufferBinding, RetainedPixi3DBuffer>();
  #spans: readonly Span[] = [];
  #draws: readonly PreparedDraw[] = [];
  readonly #pool = new Pixi3DMeshPool();
  #disposed = false;
  constructor(
    private readonly destination?: Container3D,
    private readonly detachedOffset: LayoutPoint = zeroAnchor,
  ) {}

  decode(frame: CommandBufferView<Pixi3DBindings>): PreparedRendererCommit<void> {
    this.#assertActive();
    const buffers = new Map(this.#buffers);
    const copied = new Set<Pixi3DBufferBinding>();
    for (const update of frame.updates.buffers) {
      const previous = buffers.get(update.buffer);
      const bytes = new Uint8Array(update.byteLength);
      if (previous !== undefined) bytes.set(previous.bytes.subarray(0, bytes.length));
      copied.add(update.buffer);
      buffers.set(update.buffer, {
        binding: update.buffer,
        scalarType: update.scalarType,
        vectorWidth: update.vectorWidth,
        bytes,
      });
    }
    for (const patch of frame.updates.patches) {
      const binding = patch.kind === 'copy' ? patch.destination : patch.buffer;
      const previous = buffers.get(binding);
      if (previous !== undefined && !copied.has(binding)) {
        buffers.set(binding, { ...previous, bytes: previous.bytes.slice() });
        copied.add(binding);
      }
      applyPatch(buffers, patch);
    }
    for (const retirement of frame.updates.retirements) {
      if (retirement.kind === 'buffer') buffers.delete(retirement.buffer);
    }
    const placementTables = [...buffers.values()].filter(
      (candidate) => candidate.binding.input.declaration.kind === 'placement',
    );
    if (placementTables.length > 1) throw new Error('Pixi3D needs at most one session placement table');
    const placementTable = placementTables[0]!;

    let spans = this.#spans;
    if (frame.displayList.kind === 'replace' && frame.displayList.retainedTopology !== true) {
      const next: Span[] = [];
      for (const child of frame.displayList.value.children) {
        if (child.kind !== 'instance') throw new Error('Pixi3D direct Codec emitted a batch');
        const input = child.value.input;
        const primitive = input.instance.value.input;
        if (primitive.kind !== 'glyph' && primitive.kind !== 'decoration')
          throw new Error(`Pixi3D cannot render ${primitive.kind} primitives`);
        if (primitive.recordCount === 0) continue;
        if ((primitive.kind === 'glyph' && primitive.resource === undefined) || child.transform === undefined) {
          throw new Error('Pixi3D Bitmap draw is missing its resource or transform');
        }
        next.push({
          resource: primitive.resource,
          kind: primitive.kind,
          buffers: Array.from(input.buffers),
          transform: child.transform,
          start: primitive.recordIndex,
          count: primitive.recordCount,
        });
      }
      spans = next;
    }

    const changed =
      spans !== this.#spans ||
      frame.updates.buffers.length !== 0 ||
      frame.updates.patches.length !== 0 ||
      frame.updates.retirements.length !== 0;
    const created: Mesh3D[] = [];
    const prepared: PreparedDraw[] = [];
    const candidates = new Map<Pixi3DText, PreparedDraw[]>();
    for (const draw of this.#draws) {
      const list = candidates.get(draw.span.transform) ?? [];
      list.push(draw);
      candidates.set(draw.span.transform, list);
    }
    if (changed) {
      try {
        for (const span of spans) {
          const list = candidates.get(span.transform);
          const index = list?.findIndex((draw) => reusable(draw.span, span, this.#buffers, buffers)) ?? -1;
          if (index >= 0) {
            const previous = list!.splice(index, 1)[0]!;
            prepared.push({ span, meshes: previous.meshes, offset: previous.offset });
            continue;
          }
          const meshes =
            span.kind === 'decoration'
              ? createDecorationMeshes(span.buffers, buffers, span.start, span.count, this.#pool)
              : createRasterMeshes(
                  span.resource!,
                  span.buffers,
                  buffers,
                  placementTable,
                  span.start,
                  span.count,
                  span.transform.material,
                  this.#pool,
                );
          created.push(...meshes);
          prepared.push({ span, meshes, offset: zeroAnchor });
        }
      } catch (error) {
        destroyBitmapMeshes(created);
        throw error;
      }
    }

    let active = true;
    return {
      result: undefined,
      commit: () => {
        if (!active) return;
        active = false;
        this.#assertActive();
        this.#buffers = buffers;
        this.#spans = spans;
        if (!changed) return;
        const retained = new Set(prepared.flatMap((draw) => draw.meshes));
        destroyBitmapMeshes(this.#draws.flatMap((draw) => draw.meshes).filter((mesh) => !retained.has(mesh)));
        for (const draw of prepared)
          for (const mesh of draw.meshes)
            if (mesh.parent !== (this.destination ?? draw.span.transform))
              (this.destination ?? draw.span.transform).addChild(mesh);
        this.#draws = prepared;
        if (this.destination !== undefined) this.syncTransforms();
      },
      discard: () => {
        if (!active) return;
        active = false;
        destroyBitmapMeshes(created);
      },
    };
  }

  syncTransforms(): void {
    for (const draw of this.#draws) {
      const offset = this.destination === undefined ? draw.span.transform.acceptedAnchor : this.detachedOffset;
      if (offset === draw.offset) continue;
      if (offset.x !== draw.offset.x || offset.y !== draw.offset.y)
        for (const mesh of draw.meshes) mesh.position.set(offset.x, offset.y === 0 ? 0 : -offset.y, 0);
      draw.offset = offset;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    destroyBitmapMeshes(this.#draws.flatMap((draw) => draw.meshes));
    this.#draws = [];
    this.#spans = [];
    this.#buffers.clear();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Pixi3D renderer is disposed');
  }
}

function reusable(
  previous: Span,
  next: Span,
  before: ReadonlyMap<Pixi3DBufferBinding, RetainedPixi3DBuffer>,
  after: ReadonlyMap<Pixi3DBufferBinding, RetainedPixi3DBuffer>,
): boolean {
  if (
    previous.kind !== next.kind ||
    previous.resource !== next.resource ||
    previous.start !== next.start ||
    previous.count !== next.count ||
    previous.buffers.length !== next.buffers.length ||
    previous.buffers.some((binding, i) => binding !== next.buffers[i])
  )
    return false;
  for (const binding of next.buffers) {
    const a = before.get(binding),
      b = after.get(binding);
    if (a === b) continue;
    if (a === undefined || b === undefined) return false;
    const stride = (b.scalarType === 'u16' ? 2 : 4) * b.vectorWidth;
    if (!sameRange(a.bytes, b.bytes, next.start * stride, next.count * stride)) return false;
  }
  if (next.kind === 'decoration') return true;
  const oldPlacement = [...before.values()].find((buffer) => buffer.binding.input.declaration.kind === 'placement');
  const newPlacement = [...after.values()].find((buffer) => buffer.binding.input.declaration.kind === 'placement');
  if (oldPlacement === newPlacement) return true;
  if (oldPlacement === undefined || newPlacement === undefined) return false;
  const slots = next.buffers.find(
    (binding) =>
      binding.input.declaration.kind === 'codec' &&
      binding.input.declaration.value.id === pixi3dSystemBuffers.placementSlot.id,
  )!;
  const bytes = after.get(slots)!.bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = next.start; i < next.start + next.count; i++) {
    const slot = view.getUint32(i * 4, true);
    if (!sameRange(oldPlacement.bytes, newPlacement.bytes, slot * 8, 8)) return false;
  }
  return true;
}
function sameRange(a: Uint8Array, b: Uint8Array, start: number, length: number): boolean {
  if (start + length > a.length || start + length > b.length) return false;
  for (let i = start; i < start + length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function applyPatch(
  buffers: Map<Pixi3DBufferBinding, RetainedPixi3DBuffer>,
  patch: BufferPatch<Pixi3DBufferBinding>,
): void {
  const targetBinding = patch.kind === 'copy' ? patch.destination : patch.buffer;
  const target = buffers.get(targetBinding);
  if (target === undefined) throw new Error('Pixi3D patch references an unknown buffer');
  switch (patch.kind) {
    case 'allocate-or-resize':
    case 'retire':
      return;
    case 'write':
      target.bytes.set(patch.payload, patch.destinationOffset);
      return;
    case 'fill': {
      const view = new DataView(
        target.bytes.buffer,
        target.bytes.byteOffset + patch.destinationOffset,
        patch.byteLength,
      );
      for (let offset = 0; offset < patch.byteLength; offset += 4) view.setUint32(offset, patch.value, true);
      return;
    }
    case 'copy': {
      const source = buffers.get(patch.source);
      if (source === undefined) throw new Error('Pixi3D copy references an unknown source buffer');
      if (source === target) {
        target.bytes.copyWithin(patch.destinationOffset, patch.sourceOffset, patch.sourceOffset + patch.byteLength);
      } else {
        target.bytes.set(
          source.bytes.subarray(patch.sourceOffset, patch.sourceOffset + patch.byteLength),
          patch.destinationOffset,
        );
      }
    }
  }
}
