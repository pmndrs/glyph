import * as THREE from 'three/webgpu';

import { markStorageAttributeUpdated } from './host-buffer.js';

export interface LiveGlyphTransformStorage {
  readonly transforms: THREE.StorageInstancedBufferAttribute;
  readonly owners: Uint32Array;
}

export class LiveGlyphTransformStore {
  readonly #storages = new Map<string, LiveGlyphTransformStorage>();
  readonly #composed = new THREE.Matrix4();
  readonly #inversePivot = new THREE.Matrix4();

  get byteLength(): number {
    let bytes = 0;
    for (const storage of this.#storages.values()) bytes += storage.transforms.array.byteLength;
    return bytes;
  }

  prepare(storageKey: string, capacityRecords: number): void {
    const existing = this.#storages.get(storageKey);
    if (existing !== undefined) {
      if (existing.transforms.count / 4 !== capacityRecords) {
        throw new Error('live glyph transform storage changed physical record capacity');
      }
      return;
    }
    const capacity = Math.max(1, capacityRecords);
    const values = new Float32Array(capacity * 16);
    for (let record = 0; record < capacity; record += 1) writeIdentity(values, record * 16);
    const transforms = new THREE.StorageInstancedBufferAttribute(values, 4);
    transforms.setUsage(THREE.DynamicDrawUsage);
    transforms.needsUpdate = true;
    this.#storages.set(storageKey, { transforms, owners: new Uint32Array(capacity) });
  }

  get(storageKey: string): LiveGlyphTransformStorage | undefined {
    return this.#storages.get(storageKey);
  }

  ensureRecord(storageKey: string, record: number, stableId: number): void {
    const storage = this.#record(storageKey, record);
    if (storage.owners[record] === stableId) return;
    storage.owners[record] = stableId;
    writeIdentity(storage.transforms.array as Float32Array, record * 16);
    markStorageAttributeUpdated(storage.transforms, record * 16, 16);
  }

  setMatrix(storageKey: string, record: number, stableId: number, matrix: THREE.Matrix4, x: number, y: number): void {
    const storage = this.#record(storageKey, record);
    this.ensureRecord(storageKey, record, stableId);
    this.#inversePivot.makeTranslation(-x, -y, 0);
    this.#composed.copy(matrix).multiply(this.#inversePivot);
    const values = storage.transforms.array as Float32Array;
    const offset = record * 16;
    if (matrixEqualsFloat32(values, offset, this.#composed.elements)) return;
    this.#composed.toArray(values, offset);
    markStorageAttributeUpdated(storage.transforms, record * 16, 16);
  }

  reset(storageKey: string, record: number, stableId: number): void {
    const storage = this.#record(storageKey, record);
    if (storage.owners[record] !== stableId) return;
    const values = storage.transforms.array as Float32Array;
    const offset = record * 16;
    if (isIdentity(values, offset)) return;
    writeIdentity(values, offset);
    markStorageAttributeUpdated(storage.transforms, record * 16, 16);
  }

  retain(storageKeys: ReadonlySet<string>): void {
    for (const [storageKey, storage] of this.#storages) {
      if (storageKeys.has(storageKey)) continue;
      storage.transforms.dispose();
      this.#storages.delete(storageKey);
    }
  }

  dispose(): void {
    for (const storage of this.#storages.values()) storage.transforms.dispose();
    this.#storages.clear();
  }

  #record(storageKey: string, record: number): LiveGlyphTransformStorage {
    const storage = this.#storages.get(storageKey);
    if (storage === undefined) throw new Error('live glyph transform storage is not prepared');
    if (!Number.isInteger(record) || record < 0 || record >= storage.owners.length) {
      throw new RangeError(`live glyph transform record ${record} is out of range`);
    }
    return storage;
  }
}

function writeIdentity(target: Float32Array, offset: number): void {
  target.fill(0, offset, offset + 16);
  target[offset] = 1;
  target[offset + 5] = 1;
  target[offset + 10] = 1;
  target[offset + 15] = 1;
}

function matrixEqualsFloat32(target: Float32Array, offset: number, matrix: readonly number[]): boolean {
  for (let lane = 0; lane < 16; lane += 1) {
    if (target[offset + lane] !== Math.fround(matrix[lane]!)) return false;
  }
  return true;
}

function isIdentity(target: Float32Array, offset: number): boolean {
  for (let lane = 0; lane < 16; lane += 1) {
    const expected = lane === 0 || lane === 5 || lane === 10 || lane === 15 ? 1 : 0;
    if (target[offset + lane] !== expected) return false;
  }
  return true;
}
