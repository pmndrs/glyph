import * as THREE from 'three/webgpu';

import type { CodecBufferId, CodecScalarType } from '../../config/codec.js';
import type { ThreeBufferBinding } from '../schema.js';

export type ScalarArray = Float32Array | Uint32Array | Uint16Array;

declare const threeCodecAttributeNameBrand: unique symbol;
export type ThreeCodecAttributeName = string & { readonly [threeCodecAttributeNameBrand]: true };
export type ThreeBufferBindingId = CodecBufferId | 'placement';

export interface RetainedBuffer {
  readonly binding: ThreeBufferBinding;
  readonly storageKey: string;
  readonly codecBufferId: ThreeBufferBindingId;
  readonly threeAttributeName: ThreeCodecAttributeName;
  readonly scalarType: CodecScalarType;
  readonly vectorWidth: number;
  readonly capacityRecords: number;
  readonly array: ScalarArray;
  readonly attribute: THREE.StorageInstancedBufferAttribute;
}

export type StagedBufferOperation =
  | Readonly<{
      kind: 'write';
      buffer: RetainedBuffer;
      destinationOffset: number;
      payload: Uint8Array;
    }>
  | Readonly<{
      kind: 'fill';
      buffer: RetainedBuffer;
      destinationOffset: number;
      byteLength: number;
      value: number;
    }>
  | Readonly<{
      kind: 'copy';
      buffer: RetainedBuffer;
      destinationOffset: number;
      source: RetainedBuffer;
      sourceOffset: number;
      byteLength: number;
    }>;

export interface StagedBufferUpload {
  readonly buffer: RetainedBuffer;
  /** Envelope of every written byte. */
  start: number;
  end: number;
  /** The written byte ranges, disjoint and unordered; absent until the first write is staged. */
  ranges?: { start: number; end: number }[];
}

export interface StagedBufferMutations {
  readonly operations: readonly StagedBufferOperation[];
  readonly uploads: readonly StagedBufferUpload[];
}

const MAX_UPDATE_RANGES = 32;
/** Mirrors the Codec capability set: gaps under 128 bytes are not worth a separate upload call. */
const UPLOAD_COALESCE_GAP_BYTES = 128;
/** The engine emits at most eight ranges per buffer; more than that means overlapping patches. */
const MAX_UPLOAD_RANGES = 8;

export function scalarArray(scalarType: CodecScalarType, byteLength: number): ScalarArray {
  if (scalarType === 'f32' || scalarType === 'u32') {
    return scalarType === 'f32' ? new Float32Array(byteLength / 4) : new Uint32Array(byteLength / 4);
  }
  return new Uint16Array(byteLength / 2);
}

export function threeCodecAttributeName(id: ThreeBufferBindingId): ThreeCodecAttributeName {
  return `_pmndrsGlyph_${id}` as ThreeCodecAttributeName;
}

export function transformAttribute(transformCapacity: number): THREE.StorageInstancedBufferAttribute {
  const attribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(transformCapacity * 16), 4);
  // Three's common attribute manager uploads DynamicDrawUsage on every render call, regardless of version.
  // Retained storage uses explicit dirty/version markers so shared draws upload each change once on either backend.
  attribute.setUsage(THREE.StreamDrawUsage);
  return attribute;
}

export function includeMutationRange(upload: StagedBufferUpload, byteOffset: number, byteLength: number): void {
  if (byteLength === 0) return;
  upload.start = Math.min(upload.start, byteOffset);
  upload.end = Math.max(upload.end, byteOffset + byteLength);
  const ranges = (upload.ranges ??= []);
  let start = byteOffset;
  let end = byteOffset + byteLength;
  // Ranges closer than the gap are uploaded as one: a second submission costs more than the bytes between them.
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index]!;
    if (range.end + UPLOAD_COALESCE_GAP_BYTES < start || end + UPLOAD_COALESCE_GAP_BYTES < range.start) continue;
    start = Math.min(start, range.start);
    end = Math.max(end, range.end);
    ranges.splice(index, 1);
  }
  ranges.push({ start, end });
  // Past the budget a fragmented edit is cheaper as one envelope.
  if (ranges.length > MAX_UPLOAD_RANGES) ranges.splice(0, ranges.length, { start: upload.start, end: upload.end });
}

export function commitBufferMutations(staged: StagedBufferMutations): void {
  for (const operation of staged.operations) commitBufferOperation(operation);
  for (const upload of staged.uploads) commitBufferUpload(upload);
}

export function commitTransforms(
  attribute: THREE.StorageInstancedBufferAttribute,
  prepared: Readonly<{ rows: readonly number[]; values: Float32Array }>,
): void {
  const { rows, values } = prepared;
  if (rows.length === 0) return;
  const target = attribute.array as Float32Array;
  let start = target.length;
  let end = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const offset = rows[index]! * 16;
    target.set(values.subarray(index * 16, index * 16 + 16), offset);
    start = Math.min(start, offset);
    end = Math.max(end, offset + 16);
  }
  markStorageAttributeUpdated(attribute, start, end - start);
}

/** @internal Marks one storage-attribute span for both WebGPU and WebGL2/PBO uploads. */
export function markStorageAttributeUpdated(
  attribute: THREE.StorageInstancedBufferAttribute,
  start: number,
  count: number,
): void {
  mergeUpdateRange(attribute, start, count);
  attribute.needsUpdate = true;
  invalidatePboTexture(attribute);
}

function scalarBytes(array: ScalarArray): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function commitBufferOperation(operation: StagedBufferOperation): void {
  const destination = scalarBytes(operation.buffer.array);
  if (operation.kind === 'write') {
    destination.set(operation.payload, operation.destinationOffset);
    return;
  }
  if (operation.kind === 'fill') {
    const view = new DataView(
      destination.buffer,
      destination.byteOffset + operation.destinationOffset,
      operation.byteLength,
    );
    for (let offset = 0; offset < operation.byteLength; offset += 4) view.setUint32(offset, operation.value, true);
    return;
  }
  const source = scalarBytes(operation.source.array);
  if (operation.source === operation.buffer) {
    destination.copyWithin(
      operation.destinationOffset,
      operation.sourceOffset,
      operation.sourceOffset + operation.byteLength,
    );
  } else {
    destination.set(
      source.subarray(operation.sourceOffset, operation.sourceOffset + operation.byteLength),
      operation.destinationOffset,
    );
  }
}

function commitBufferUpload(upload: StagedBufferUpload): void {
  for (const range of upload.ranges ?? [upload]) commitBufferRange(upload.buffer, range.start, range.end);
}

function commitBufferRange(buffer: RetainedBuffer, start: number, end: number): void {
  const byteLength = end - start;
  if (byteLength <= 0) return;
  const source = scalarBytes(buffer.array).subarray(start, end);
  const upload = buffer.attribute.array;
  if (upload !== buffer.array) {
    if (buffer.attribute.itemSize === buffer.vectorWidth) {
      new Uint8Array(upload.buffer, upload.byteOffset + start, byteLength).set(source);
    } else {
      commitPaddedBufferUpload(buffer, start, end);
      return;
    }
  }
  const scalarBytesPerElement = buffer.array.BYTES_PER_ELEMENT;
  markStorageAttributeUpdated(buffer.attribute, start / scalarBytesPerElement, byteLength / scalarBytesPerElement);
}

function commitPaddedBufferUpload(buffer: RetainedBuffer, start: number, end: number): void {
  const source = buffer.array;
  const target = buffer.attribute.array as ScalarArray;
  if (source.BYTES_PER_ELEMENT !== target.BYTES_PER_ELEMENT || buffer.attribute.itemSize < buffer.vectorWidth) {
    throw new Error('Three storage upload view is incompatible with its retained buffer');
  }
  const bytesPerElement = source.BYTES_PER_ELEMENT;
  const firstRecord = Math.floor(start / bytesPerElement / buffer.vectorWidth);
  const finalRecord = Math.ceil(end / bytesPerElement / buffer.vectorWidth);
  for (let record = firstRecord; record < finalRecord; record += 1) {
    const sourceOffset = record * buffer.vectorWidth;
    target.set(source.subarray(sourceOffset, sourceOffset + buffer.vectorWidth), record * buffer.attribute.itemSize);
  }
  markStorageAttributeUpdated(
    buffer.attribute,
    firstRecord * buffer.attribute.itemSize,
    (finalRecord - firstRecord) * buffer.attribute.itemSize,
  );
}

function mergeUpdateRange(attribute: THREE.BufferAttribute, start: number, count: number): void {
  let mergedStart = start;
  let mergedEnd = start + count;
  for (let index = attribute.updateRanges.length - 1; index >= 0; index -= 1) {
    const range = attribute.updateRanges[index]!;
    const rangeEnd = range.start + range.count;
    if (rangeEnd < mergedStart || mergedEnd < range.start) continue;
    mergedStart = Math.min(mergedStart, range.start);
    mergedEnd = Math.max(mergedEnd, rangeEnd);
    attribute.updateRanges.splice(index, 1);
  }
  if (attribute.updateRanges.length >= MAX_UPDATE_RANGES) {
    for (const range of attribute.updateRanges) {
      mergedStart = Math.min(mergedStart, range.start);
      mergedEnd = Math.max(mergedEnd, range.start + range.count);
    }
    attribute.clearUpdateRanges();
  }
  attribute.addUpdateRange(mergedStart, mergedEnd - mergedStart);
}

function invalidatePboTexture(attribute: THREE.StorageInstancedBufferAttribute): void {
  const pbo = (attribute as THREE.StorageInstancedBufferAttribute & { pbo?: THREE.DataTexture }).pbo;
  if (pbo !== undefined) pbo.needsUpdate = true;
}
