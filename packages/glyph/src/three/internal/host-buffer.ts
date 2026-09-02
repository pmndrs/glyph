import * as THREE from 'three/webgpu';

import type { CodecBufferId, RenderPlanScalarType } from '../../index.js';
import type { ThreeBufferBinding } from '../handle.js';

export type ScalarArray = Float32Array | Uint32Array | Uint16Array;

declare const threeCodecAttributeNameBrand: unique symbol;
export type ThreeCodecAttributeName = string & { readonly [threeCodecAttributeNameBrand]: true };
export type ThreeBufferBindingId = CodecBufferId | 'order';

export interface RetainedBuffer {
  readonly binding: ThreeBufferBinding;
  readonly storageKey: string;
  readonly codecBufferId: ThreeBufferBindingId;
  readonly threeAttributeName: ThreeCodecAttributeName;
  readonly scalarType: RenderPlanScalarType;
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
  start: number;
  end: number;
}

export interface StagedBufferMutations {
  readonly operations: readonly StagedBufferOperation[];
  readonly uploads: readonly StagedBufferUpload[];
}

const MAX_UPDATE_RANGES = 32;

export function scalarArray(scalarType: RenderPlanScalarType, byteLength: number): ScalarArray {
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
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
}

export function includeMutationRange(upload: StagedBufferUpload, byteOffset: number, byteLength: number): void {
  if (byteLength === 0) return;
  upload.start = Math.min(upload.start, byteOffset);
  upload.end = Math.max(upload.end, byteOffset + byteLength);
}

export function commitBufferMutations(staged: StagedBufferMutations): void {
  for (const operation of staged.operations) commitBufferOperation(operation);
  for (const upload of staged.uploads) commitBufferUpload(upload);
}

export function commitTransforms(
  attribute: THREE.StorageInstancedBufferAttribute,
  prepared: Readonly<{ contents: Float32Array; start: number; end: number }>,
): void {
  if (prepared.end <= prepared.start) return;
  const target = attribute.array as Float32Array;
  target.set(prepared.contents.subarray(prepared.start, prepared.end), prepared.start);
  markStorageAttributeUpdated(attribute, prepared.start, prepared.end - prepared.start);
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

function commitBufferUpload(uploadRange: StagedBufferUpload): void {
  const { buffer, start, end } = uploadRange;
  const byteLength = end - start;
  const source = scalarBytes(buffer.array).subarray(start, end);
  const upload = buffer.attribute.array;
  if (upload !== buffer.array) {
    new Uint8Array(upload.buffer, upload.byteOffset + start, byteLength).set(source);
  }
  const scalarBytesPerElement = buffer.array.BYTES_PER_ELEMENT;
  markStorageAttributeUpdated(buffer.attribute, start / scalarBytesPerElement, byteLength / scalarBytesPerElement);
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
