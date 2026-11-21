import type { BaseMaterial3D, Geometry3D, Mesh3D } from '@pixi/3d';
import type { Buffer } from 'pixi.js';
import { detachPixi3DTextMaterial, type Pixi3DTextMaterial, type Pixi3DTextMaterialFormat } from './material.js';

interface GeometryEntry {
  readonly geometry: Geometry3D;
  readonly hash: number | undefined;
  readonly key?: object;
  references: number;
}
interface MaterialEntry {
  readonly material: BaseMaterial3D;
  references: number;
}
const owners = new WeakMap<Mesh3D, Pixi3DMeshPool>();

/** Root-owned leases keep native instancing identities stable without sharing mutable text effects. */
export class Pixi3DMeshPool {
  readonly #leases = new WeakMap<Mesh3D, { geometry: Geometry3D; material: BaseMaterial3D }>();
  readonly #geometries = new Map<number, GeometryEntry[]>();
  readonly #geometryEntries = new Map<Geometry3D, GeometryEntry>();
  readonly #materials = new Map<
    object,
    Map<Pixi3DTextMaterial | undefined, Map<Pixi3DTextMaterialFormat, MaterialEntry>>
  >();
  readonly #materialEntries = new Map<BaseMaterial3D, MaterialEntry>();
  readonly #canonical = new Map<object, GeometryEntry>();
  canonicalGeometry(key: object, create: () => Geometry3D): Geometry3D {
    const previous = this.#canonical.get(key);
    if (previous !== undefined) {
      previous.references++;
      return previous.geometry;
    }
    const entry = { geometry: create(), hash: undefined, key, references: 1 };
    this.#canonical.set(key, entry);
    this.#geometryEntries.set(entry.geometry, entry);
    return entry.geometry;
  }
  uniqueMaterial(create: () => BaseMaterial3D): BaseMaterial3D {
    const material = create();
    this.#materialEntries.set(material, { material, references: 1 });
    return material;
  }
  geometry(candidate: Geometry3D): Geometry3D {
    const hash = geometryHash(candidate);
    const bucket = this.#geometries.get(hash) ?? [];
    const match = bucket.find((entry) => equalGeometry(entry.geometry, candidate));
    if (match !== undefined) {
      match.references++;
      candidate.destroy(true);
      return match.geometry;
    }
    const entry = { geometry: candidate, hash, references: 1 };
    bucket.push(entry);
    this.#geometries.set(hash, bucket);
    this.#geometryEntries.set(candidate, entry);
    return candidate;
  }
  material(
    scope: object,
    extension: Pixi3DTextMaterial | undefined,
    format: Pixi3DTextMaterialFormat,
    create: () => BaseMaterial3D,
  ): BaseMaterial3D {
    const shared = extension?.create === undefined || extension.shared;
    let variants = this.#materials.get(scope);
    let formats = variants?.get(extension);
    const previous = shared ? formats?.get(format) : undefined;
    if (previous !== undefined) {
      previous.references++;
      return previous.material;
    }
    const material = create();
    const entry = { material, references: 1 };
    this.#materialEntries.set(material, entry);
    if (shared) {
      variants ??= new Map();
      formats ??= new Map();
      formats.set(format, entry);
      variants.set(extension, formats);
      this.#materials.set(scope, variants);
    }
    return material;
  }
  own(mesh: Mesh3D): void {
    owners.set(mesh, this);
    this.#leases.set(mesh, { geometry: mesh.geometry, material: mesh.material });
  }
  release(mesh: Mesh3D): void {
    owners.delete(mesh);
    const lease = this.#leases.get(mesh)!;
    this.#leases.delete(mesh);
    const geometry = this.#geometryEntries.get(lease.geometry)!;
    if (--geometry.references === 0) {
      this.#geometryEntries.delete(lease.geometry);
      if (geometry.key !== undefined) this.#canonical.delete(geometry.key);
      if (geometry.hash !== undefined) {
        const bucket = this.#geometries.get(geometry.hash)!;
        bucket.splice(bucket.indexOf(geometry), 1);
        if (bucket.length === 0) this.#geometries.delete(geometry.hash);
      }
      geometry.geometry.destroy(true);
    }
    const material = this.#materialEntries.get(lease.material)!;
    if (--material.references === 0) {
      this.#materialEntries.delete(material.material);
      for (const [scope, variants] of this.#materials) {
        for (const [extension, formats] of variants) {
          for (const [format, entry] of formats) if (entry === material) formats.delete(format);
          if (formats.size === 0) variants.delete(extension);
        }
        if (variants.size === 0) this.#materials.delete(scope);
      }
      detachPixi3DTextMaterial(material.material);
      material.material.destroy();
    }
    mesh.destroy({ geometry: false, material: false });
  }
}
export function releasePooledMesh(mesh: Mesh3D): boolean {
  const pool = owners.get(mesh);
  if (pool === undefined) return false;
  pool.release(mesh);
  return true;
}
function bytes(buffer: Buffer): Uint8Array {
  const data = buffer.data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
function geometryHash(geometry: Geometry3D): number {
  let hash = 2166136261;
  const add = (value: number): void => {
    hash = Math.imul(hash ^ value, 16777619) >>> 0;
  };
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    for (const character of `${name}:${attribute.format}:${attribute.stride}:${attribute.offset}:${attribute.instance}`)
      add(character.charCodeAt(0));
    for (const value of bytes(attribute.buffer)) add(value);
  }
  if (geometry.indexBuffer !== undefined) for (const value of bytes(geometry.indexBuffer)) add(value);
  return hash;
}
function equalBytes(left: Buffer, right: Buffer): boolean {
  const a = bytes(left),
    b = bytes(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function equalGeometry(left: Geometry3D, right: Geometry3D): boolean {
  const a = Object.entries(left.attributes),
    b = Object.entries(right.attributes);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const [name, attribute] = a[i]!;
    const [otherName, other] = b[i]!;
    if (
      name !== otherName ||
      attribute.format !== other.format ||
      attribute.stride !== other.stride ||
      attribute.offset !== other.offset ||
      attribute.instance !== other.instance ||
      !equalBytes(attribute.buffer, other.buffer)
    )
      return false;
  }
  if (left.indexBuffer === undefined || right.indexBuffer === undefined) return left.indexBuffer === right.indexBuffer;
  return equalBytes(left.indexBuffer, right.indexBuffer);
}
