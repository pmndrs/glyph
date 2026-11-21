import { defineTypeGpuConfig } from '@pmndrs/glyph/typegpu';
import { resourceLease, msdfSchema } from '@pmndrs/glyph/core';
import { TYPEGPU_PLACEMENT_SLOT_BUFFER_ID } from '../../dist/typegpu/internal/codec.js';

globalThis.GPUBufferUsage ??= { VERTEX: 32, COPY_DST: 8, STORAGE: 128 };

// A recording host at the public config seam. The real engine authors all commands and bytes.
export function recordingHost(rasterSchema = msdfSchema) {
  const allocations = new Set();
  const recorded = [];
  const uploads = [];
  const projectedBuffers = [];
  const uniforms = [];
  const codecIdByGpu = new WeakMap();
  const stats = { allocations: 0, preparations: 0, publications: 0, uniformWrites: 0, reject: false };
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
      const allocation = buffer(8);
      const uniform = {
        buffer: allocation,
        value: [0, 0],
        failNextWrite: false,
        writes: 0,
        write(value) {
          stats.uniformWrites++;
          this.writes++;
          if (this.failNextWrite) {
            this.failNextWrite = false;
            throw new Error('Injected uniform write failure');
          }
          this.value = [...value];
        },
      };
      uniforms.push(uniform);
      return uniform;
    },
    device: {
      createBuffer({ size, usage }) {
        stats.allocations++;
        return buffer(size, usage);
      },
      queue: {
        writeBuffer(target, offset, bytes) {
          uploads.push({
            codecId: codecIdByGpu.get(target),
            offset,
            length: bytes.byteLength,
            capacity: target.bytes.byteLength,
            usage: target.usage,
          });
          target.bytes.set(bytes, offset);
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
          prepare(buffers, placementTable, viewport, position, start, count) {
            stats.preparations++;
            for (const [codecId, gpu] of buffers) codecIdByGpu.set(gpu, codecId);
            return {
              draw() {
                const placementSlots = buffers
                  .get(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID)
                  .bytes.slice(start * 4, (start + count) * 4);
                const placementTableBytes = placementTable.bytes.slice();
                const slotView = new DataView(
                  placementSlots.buffer,
                  placementSlots.byteOffset,
                  placementSlots.byteLength,
                );
                const tableView = new DataView(
                  placementTableBytes.buffer,
                  placementTableBytes.byteOffset,
                  placementTableBytes.byteLength,
                );
                recorded.push({
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
                  position: [...position.value],
                  viewport: [...viewport.value],
                  start,
                  count,
                });
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
          const transform = { position: root.createUniform() };
          let state = { ...options, font, transform };
          let controller;
          let disposed = false;
          try {
            controller = context.services.createText(state);
          } catch (error) {
            transform.position.buffer.destroy();
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
                transform.position.buffer.destroy();
                font.dispose();
              }
            },
          };
        };
        return selected;
      },
    },
  };
  return { config, allocations, recorded, uploads, projectedBuffers, uniforms, stats };
}
