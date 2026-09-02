import type {
  BufferPatch,
  Retirement,
  TypedBuffer,
  TypedPatchCommand,
  TypedResource,
  TypedRetirementCommand,
} from '../glyph-config.js';

/** @internal Explicitly constructs a renderer-bound patch from one trusted decoded view. */
export function bindPatch<Buffer extends object>(
  patch: TypedPatchCommand,
  buffer: (identity: TypedBuffer) => Buffer,
): BufferPatch<Buffer> {
  switch (patch.kind) {
    case 'allocate-or-resize':
    case 'retire':
      return Object.freeze({
        kind: patch.kind,
        buffer: buffer(patch.buffer),
        destinationOffset: patch.destinationOffset,
        byteLength: patch.byteLength,
      });
    case 'write':
      return Object.freeze({
        kind: patch.kind,
        buffer: buffer(patch.buffer),
        destinationOffset: patch.destinationOffset,
        payload: patch.payload,
      });
    case 'fill':
      return Object.freeze({
        kind: patch.kind,
        buffer: buffer(patch.buffer),
        destinationOffset: patch.destinationOffset,
        byteLength: patch.byteLength,
        value: patch.value,
      });
    case 'copy':
      return Object.freeze({
        kind: patch.kind,
        source: buffer(patch.source),
        sourceOffset: patch.sourceOffset,
        destination: buffer(patch.destination),
        destinationOffset: patch.destinationOffset,
        byteLength: patch.byteLength,
      });
  }
}

interface RetirementBindings<Resource extends object, Buffer extends object> {
  resource(identity: TypedResource): Resource | undefined;
  buffer(identity: TypedBuffer): Buffer | undefined;
}

/** @internal Explicitly constructs one bound retirement; absent superseded state is omitted. */
export function bindRetirement<Resource extends object, Buffer extends object>(
  retirement: TypedRetirementCommand,
  bindings: RetirementBindings<Resource, Buffer>,
): Retirement<Resource, Buffer> | undefined {
  switch (retirement.kind) {
    case 'resource': {
      const resource = bindings.resource(retirement.resource);
      return resource === undefined ? undefined : Object.freeze({ kind: retirement.kind, resource });
    }
    case 'buffer': {
      const buffer = bindings.buffer(retirement.buffer);
      return buffer === undefined ? undefined : Object.freeze({ kind: retirement.kind, buffer });
    }
    case 'slot-range':
    case 'output-bytes':
      return Object.freeze({
        kind: retirement.kind,
        byteOffset: retirement.byteOffset,
        byteLength: retirement.byteLength,
      });
  }
}
