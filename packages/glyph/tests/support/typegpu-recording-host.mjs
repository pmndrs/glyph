import { defineTypeGpuConfig } from '@pmndrs/glyph/typegpu';
import { resourceLease, msdfSchema } from '@pmndrs/glyph/core';
import {
  TYPEGPU_PLACEMENT_SLOT_BUFFER_ID,
  TYPEGPU_TRANSFORM_INDEX_BUFFER_ID,
} from '../../dist/typegpu/internal/codec.js';
import { TypeGpuTransform } from '../../dist/typegpu/internal/renderer.js';

globalThis.GPUBufferUsage ??= { VERTEX: 32, COPY_DST: 8, STORAGE: 128 };

// A recording host at the public config seam. The real engine authors all commands and bytes.
export function recordingHost(rasterSchema = msdfSchema) {
  const allocations = new Set();
  const recorded = [];
  const uploads = [];
  const projectedBuffers = [];
  const codecIdByGpu = new WeakMap();
  const transformTables = new WeakSet();
  const stats = { allocations: 0, preparations: 0, publications: 0, transformWrites: 0, reject: false };
  function buffer(size, usage = 0) {
    const value = {
      bytes: new Uint8Array(size),
      usage,
      destroyed: false,
      destroy() {
        this.destroyed = true;
        allocations.delete(this);
      },
    };
    allocations.add(value);
    return value;
  }
  const root = {
    createUniform() {
      return {
        buffer: buffer(8),
        value: [0, 0],
        write(value) {
          this.value = [...value];
        },
      };
    },
    device: {
      createBuffer({ size, usage }) {
        stats.allocations++;
        return buffer(size, usage);
      },
      queue: {
        writeBuffer(target, offset, bytes) {
          if (transformTables.has(target)) stats.transformWrites++;
          uploads.push({
            codecId: codecIdByGpu.get(target),
            offset,
            length: bytes.byteLength,
            capacity: target.bytes.byteLength,
            usage: target.usage,
          });
          target.bytes.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset);
        },
      },
    },
  };
  const base = defineTypeGpuConfig({ root, format: 'rgba8unorm' });
  const config = {
    ...base,
    renderer: ({ defaultRenderer }) => ({
      decode(frame) {
        stats.publications++;
        projectedBuffers.push({
          updates: Array.from(frame.updates.buffers, (command) => command.buffer),
          retirements: Array.from(frame.updates.retirements)
            .filter((command) => command.kind === 'buffer')
            .map((command) => command.buffer),
        });
        const prepared = defaultRenderer.decode(frame);
        if (stats.reject) {
          prepared.discard();
          throw new Error('Injected renderer rejection');
        }
        return prepared;
      },
      syncTransforms: () => defaultRenderer.syncTransforms(),
      dispose: () => defaultRenderer.dispose(),
    }),
    resolve: () =>
      resourceLease(
        {
          // MSDF and bitmap draws are batched: one draw covers consecutive Texts. It is recorded as one entry per
          // Text (per run of one transform record), with that Text's offset read back from the transform table.
          bind(lanes) {
            stats.preparations++;
            const { buffers, placementTable, transformTable, viewport } = lanes;
            transformTables.add(transformTable);
            for (const [codecId, gpu] of buffers) codecIdByGpu.set(gpu, codecId);
            return {
              watchedLanes: [],
              variant: () => 0,
              draw(_pass, _bindGroups, _variant, first, count) {
                const indices = new DataView(buffers.get(TYPEGPU_TRANSFORM_INDEX_BUFFER_ID).bytes.buffer);
                const table = new DataView(transformTable.bytes.buffer);
                let start = first;
                while (start < first + count) {
                  const record = indices.getUint32(start * 4, true);
                  let end = start + 1;
                  while (end < first + count && indices.getUint32(end * 4, true) === record) end++;
                  recorded.push(
                    recordedDraw(buffers, placementTable, viewport, start, end - start, [
                      table.getFloat32(record * 8, true),
                      table.getFloat32(record * 8 + 4, true),
                    ]),
                  );
                  start = end;
                }
              },
            };
          },
        },
        () => {},
      ),
    root: {
      create(context) {
        const selected = base.root.create(context);
        selected.createCoreText = (selection, options) => {
          const font = context.fonts.acquire(selection);
          const transform = new TypeGpuTransform(() => {});
          let state = { ...options, font, transform };
          let controller;
          let disposed = false;
          try {
            controller = context.services.createText(state);
          } catch (error) {
            font.dispose();
            throw error;
          }
          return {
            update(update) {
              if (disposed) throw new Error('core test text is disposed');
              const next = { ...state, ...update, font, transform };
              controller.update(next);
              state = next;
            },
            dispose() {
              if (disposed) return;
              disposed = true;
              try {
                controller.dispose();
              } finally {
                font.dispose();
              }
            },
          };
        };
        return selected;
      },
    },
  };
  function recordedDraw(buffers, placementTable, viewport, start, count, position) {
    const placementSlots = buffers.get(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID).bytes.slice(start * 4, (start + count) * 4);
    const placementTableBytes = placementTable.bytes.slice();
    const slotView = new DataView(placementSlots.buffer, placementSlots.byteOffset, placementSlots.byteLength);
    const tableView = new DataView(
      placementTableBytes.buffer,
      placementTableBytes.byteOffset,
      placementTableBytes.byteLength,
    );
    return {
      // Compare raster inputs, not lifecycle-specific stable glyph identities.
      buffers: Object.values(rasterSchema.buffers).map((declaration) => {
        const stride = declaration.lanes.length * 4;
        return buffers.get(declaration.id).bytes.slice(start * stride, (start + count) * stride);
      }),
      placementSlots,
      placementTable: placementTableBytes,
      resolvedPlacement: Array.from({ length: count }, (_, index) => {
        const slot = slotView.getUint32(index * 4, true);
        return [tableView.getFloat32(slot * 8, true), tableView.getFloat32(slot * 8 + 4, true)];
      }),
      position,
      viewport: [...viewport.value],
      start,
      count,
    };
  }
  return { config, allocations, recorded, uploads, projectedBuffers, stats };
}
