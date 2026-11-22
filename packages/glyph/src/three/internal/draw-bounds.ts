import * as THREE from 'three/webgpu';

import { bitmap, bitmapSchema } from '../../raster/bitmap.js';
import { msdf, msdfSchema } from '../../raster/msdf.js';
import { slug, slugSchema } from '../../raster/slug.js';
import { decorationSchema, threeSystemBuffers } from '../codec.js';
import type { RetainedBuffer, ThreeBufferBindingId } from './host-buffer.js';
import type { ThreeHostResource, TransformRealization } from './render-state.js';

/** Two consecutive lanes of one retained Codec buffer, read per record. */
export interface RecordLanes {
  readonly buffer: RetainedBuffer;
  readonly lane: number;
}

/**
 * Everything a built-in glyph or decoration draw reads to place its quads, captured when the draw is created. A
 * draw's realization key names every buffer below, so they stay fixed for the draw's lifetime; only their contents,
 * the run start and the instance count change, and each content change bumps its attribute's `version` because that
 * is what uploads it.
 */
export interface DrawBoundsSource {
  /** Paragraph-local quad origin, y down (`x`, `y`). */
  readonly origin: RecordLanes;
  /** Quad extent (`width`, `height`). */
  readonly size: RecordLanes;
  /** Session x/y placement added to the origin, selected by a per-record slot. */
  readonly placement?: Readonly<{ slot: RecordLanes; table: RetainedBuffer }>;
  /**
   * Slug widens each quad on screen by its antialiasing fringe, a margin of screen pixels no object-space bound can
   * contain for every camera. Each quad is padded by its own larger extent, which covers the fringe whenever the glyph
   * spans at least one screen pixel.
   */
  readonly screenFringe: boolean;
  /** Per-record transform index into the root's shared table (indexed transform mode). */
  readonly indexed?: Readonly<{ indices: RetainedBuffer; table: THREE.StorageInstancedBufferAttribute }>;
  /** Per-record glyph matrices of a detached `Glyphs` branch, applied before the record's transform. */
  readonly glyphTransforms?: THREE.StorageInstancedBufferAttribute;
}

interface DrawBoundsInput {
  /** Undefined for a decoration draw. */
  readonly resource: ThreeHostResource | undefined;
  readonly buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>;
  readonly placementTable: RetainedBuffer | undefined;
  readonly transform: TransformRealization;
  readonly transformTable: THREE.StorageInstancedBufferAttribute;
  readonly glyphTransforms: THREE.StorageInstancedBufferAttribute | undefined;
  /** A caller's material factory may displace vertices anywhere, so its draws stay unculled. */
  readonly customMaterial: boolean;
}

/**
 * Where a built-in draw's quads come from, or undefined when nothing provable bounds them: a caller's material, or a
 * raster program this package did not write. Bitmap and decoration quads are drawn exactly; pixel snapping rounds each
 * projected corner to the nearest pixel edge, which never brings a quad that lies outside a frustum plane inside it.
 * An MSDF quad never leaves its atlas cell, whatever its outline width, shadow offset or trim.
 */
export function drawBoundsSource(input: DrawBoundsInput): DrawBoundsSource | undefined {
  if (input.customMaterial) return undefined;
  const { buffers, resource } = input;
  const lanes = (id: ThreeBufferBindingId, lane: number): RecordLanes => ({ buffer: buffers.get(id)!, lane });
  const placement = (slot: RecordLanes) => ({ slot, table: input.placementTable! });
  const shared = {
    ...(input.transform.kind === 'indexed'
      ? { indexed: { indices: input.transform.indices, table: input.transformTable } }
      : {}),
    ...(input.glyphTransforms === undefined ? {} : { glyphTransforms: input.glyphTransforms }),
  };
  if (resource === undefined) {
    const rect = decorationSchema.buffers.rect.id;
    return { origin: lanes(rect, 0), size: lanes(rect, 2), screenFringe: false, ...shared };
  }
  const slot = lanes(threeSystemBuffers.placementSlot.id, 0);
  if (resource.format === bitmap.id) {
    return {
      origin: lanes(bitmapSchema.buffers.origin.id, 0),
      size: lanes(bitmapSchema.buffers.size.id, 0),
      placement: placement(slot),
      screenFringe: false,
      ...shared,
    };
  }
  if (resource.format === msdf.id) {
    const rect = msdfSchema.buffers.rect.id;
    return { origin: lanes(rect, 0), size: lanes(rect, 2), placement: placement(slot), screenFringe: false, ...shared };
  }
  if (resource.format === slug.id) {
    const rect = slugSchema.buffers.rect.id;
    return {
      origin: lanes(rect, 0),
      size: lanes(rect, 2),
      // Slug carries its placement slot in the second lane of its glyph buffer.
      placement: placement(lanes(slugSchema.buffers.glyph.id, 1)),
      screenFringe: true,
      ...shared,
    };
  }
  return undefined;
}

const emptySphere = Object.freeze(new THREE.Sphere(new THREE.Vector3(), -Infinity));

/**
 * A glyph or decoration draw whose frustum test reads a conservative bound of every quad it currently draws.
 *
 * Three's frustum test reads `boundingSphere` from the object before falling back to its geometry, so the bound lives
 * on the draw and the geometry keeps the unit quad Three sorts by. The bound is recomputed lazily on the first test
 * after anything it reads changed: a static draw costs one version comparison per buffer per test.
 */
export class GlyphDraw extends THREE.Mesh {
  readonly #bounds: DrawBounds | undefined;

  /** `source` undefined leaves the draw unculled: a caller material may move vertices anywhere. */
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, source: DrawBoundsSource | undefined) {
    super(geometry, material);
    this.#bounds = source === undefined ? undefined : new DrawBounds(source);
    this.frustumCulled = source !== undefined;
  }

  /** Draw-local bound of every quad this draw currently places; read by Three's frustum test. */
  get boundingSphere(): THREE.Sphere | undefined {
    return this.#bounds?.sphere(this);
  }
}

/** The cached bound of one draw and the buffer versions it was computed from. */
class DrawBounds {
  readonly #source: DrawBoundsSource;
  /** Attributes whose contents the per-record pass reads; the transform table is composed separately. */
  readonly #recordAttributes: readonly THREE.BufferAttribute[];
  readonly #recordVersions: Int32Array;
  #recordStart = -1;
  #recordCount = -1;
  #tableVersion = -1;
  /** Six scalars (min xyz, max xyz) per transform identity when indexed, else one for the whole draw. */
  readonly #recordBoxes = new Map<number, Float64Array>();
  readonly #box = new THREE.Box3();
  readonly #sphere = new THREE.Sphere();
  readonly #corner = new THREE.Vector3();
  /** The draw matrix's linear part the sphere was fitted under; translation moves a sphere exactly. */
  readonly #linear = new Float64Array(9).fill(Number.NaN);
  #empty = true;

  constructor(source: DrawBoundsSource) {
    this.#source = source;
    const buffers = [source.origin.buffer, source.size.buffer];
    if (source.placement !== undefined) buffers.push(source.placement.slot.buffer, source.placement.table);
    if (source.indexed !== undefined) buffers.push(source.indexed.indices);
    const attributes: THREE.BufferAttribute[] = [...new Set(buffers.map((buffer) => buffer.attribute))];
    if (source.glyphTransforms !== undefined) attributes.push(source.glyphTransforms);
    this.#recordAttributes = attributes;
    this.#recordVersions = new Int32Array(attributes.length).fill(-1);
  }

  sphere(draw: THREE.Mesh): THREE.Sphere {
    const start = (draw.userData.pmndrsGlyphRunStart as number | undefined) ?? 0;
    const count = (draw.geometry as THREE.InstancedBufferGeometry).instanceCount;
    let recordsChanged = start !== this.#recordStart || count !== this.#recordCount;
    const attributes = this.#recordAttributes;
    for (let index = 0; index < attributes.length; index += 1) {
      const version = attributes[index]!.version;
      if (this.#recordVersions[index] === version) continue;
      this.#recordVersions[index] = version;
      recordsChanged = true;
    }
    const table = this.#source.indexed?.table;
    const tableChanged = table !== undefined && table.version !== this.#tableVersion;
    if (recordsChanged) {
      this.#recordStart = start;
      this.#recordCount = count;
      this.#measureRecords(start, count);
    }
    const boxChanged = recordsChanged || tableChanged;
    if (boxChanged) {
      if (table === undefined) {
        const box = this.#recordBoxes.get(0);
        if (box === undefined) this.#box.makeEmpty();
        else {
          this.#box.min.set(box[0]!, box[1]!, box[2]!);
          this.#box.max.set(box[3]!, box[4]!, box[5]!);
        }
      } else {
        this.#tableVersion = table.version;
        this.#composeTransforms(table.array as Float32Array);
      }
      this.#empty = this.#box.isEmpty();
    }
    if (this.#empty) return emptySphere;
    if (observeLinearPart(draw.matrixWorld.elements, this.#linear) || boxChanged) this.#fitSphere(draw.matrixWorld);
    return this.#sphere;
  }

  /**
   * Three moves a bound with `Sphere.applyMatrix4`, which scales the radius by the longest matrix column. Under shear
   * (a rotation inside a non-uniform scale) a box corner can move further than that, so the local radius is the
   * furthest corner's world distance divided by the same column length: the world sphere Three tests then contains the
   * world box exactly.
   */
  #fitSphere(matrixWorld: THREE.Matrix4): void {
    const box = this.#box;
    const center = box.getCenter(this.#sphere.center);
    const scale = matrixWorld.getMaxScaleOnAxis();
    const m = matrixWorld.elements;
    const halfX = (box.max.x - box.min.x) / 2;
    const halfY = (box.max.y - box.min.y) / 2;
    const halfZ = (box.max.z - box.min.z) / 2;
    let furthest = 0;
    for (let corner = 0; corner < 8; corner += 1) {
      const x = corner & 1 ? halfX : -halfX;
      const y = corner & 2 ? halfY : -halfY;
      const z = corner & 4 ? halfZ : -halfZ;
      const worldX = m[0]! * x + m[4]! * y + m[8]! * z;
      const worldY = m[1]! * x + m[5]! * y + m[9]! * z;
      const worldZ = m[2]! * x + m[6]! * y + m[10]! * z;
      furthest = Math.max(furthest, worldX * worldX + worldY * worldY + worldZ * worldZ);
    }
    // A singular draw matrix collapses every corner onto the centre.
    this.#sphere.radius = scale === 0 ? Math.hypot(halfX, halfY, halfZ) : Math.sqrt(furthest) / scale;
    this.#sphere.center.copy(center);
  }

  /** Unions every record's quad, in draw-local space or, when indexed, per transform identity. */
  #measureRecords(start: number, count: number): void {
    const { origin, size, placement, screenFringe, indexed, glyphTransforms } = this.#source;
    const originArray = origin.buffer.array;
    const originStride = origin.buffer.vectorWidth;
    const sizeArray = size.buffer.array;
    const sizeStride = size.buffer.vectorWidth;
    const slotArray = placement?.slot.buffer.array;
    const slotStride = placement?.slot.buffer.vectorWidth ?? 0;
    const slotLane = placement?.slot.lane ?? 0;
    const tableArray = placement?.table.array;
    const indices = indexed?.indices.array;
    const matrices = glyphTransforms?.array as Float32Array | undefined;
    const boxes = this.#recordBoxes;
    boxes.clear();
    let current: Float64Array | undefined;
    let currentTransform = -1;
    for (let record = start; record < start + count; record += 1) {
      const transform = indices === undefined ? 0 : indices[record]!;
      if (transform !== currentTransform) {
        currentTransform = transform;
        current = boxes.get(transform);
        if (current === undefined) {
          current = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
          boxes.set(transform, current);
        }
      }
      const originOffset = record * originStride + origin.lane;
      const sizeOffset = record * sizeStride + size.lane;
      let x = originArray[originOffset]!;
      let y = originArray[originOffset + 1]!;
      const width = sizeArray[sizeOffset]!;
      const height = sizeArray[sizeOffset + 1]!;
      if (slotArray !== undefined && tableArray !== undefined) {
        const slot = slotArray[record * slotStride + slotLane]! * 2;
        x += tableArray[slot]!;
        y += tableArray[slot + 1]!;
      }
      const pad = screenFringe ? Math.max(Math.abs(width), Math.abs(height)) : 0;
      // Shaders place `origin + corner * size` with y down, then negate y.
      const left = x + Math.min(0, width) - pad;
      const right = x + Math.max(0, width) + pad;
      const bottom = -(y + Math.max(0, height)) - pad;
      const top = -(y + Math.min(0, height)) + pad;
      if (matrices === undefined) {
        expandBox(current!, left, bottom, 0);
        expandBox(current!, right, top, 0);
      } else {
        const offset = record * 16;
        for (let corner = 0; corner < 4; corner += 1) {
          const cornerX = (corner & 1) === 0 ? left : right;
          const cornerY = (corner & 2) === 0 ? bottom : top;
          expandBox(
            current!,
            matrices[offset]! * cornerX + matrices[offset + 4]! * cornerY + matrices[offset + 12]!,
            matrices[offset + 1]! * cornerX + matrices[offset + 5]! * cornerY + matrices[offset + 13]!,
            matrices[offset + 2]! * cornerX + matrices[offset + 6]! * cornerY + matrices[offset + 14]!,
          );
        }
      }
    }
  }

  /** Places each transform identity's box with its current table row; a hidden (zero) row draws nothing. */
  #composeTransforms(table: Float32Array): void {
    const box = this.#box.makeEmpty();
    const corner = this.#corner;
    for (const [transform, local] of this.#recordBoxes) {
      const offset = transform * 16;
      if (zeroRow(table, offset)) continue;
      for (let index = 0; index < 8; index += 1) {
        const x = local[(index & 1) === 0 ? 0 : 3]!;
        const y = local[(index & 2) === 0 ? 1 : 4]!;
        const z = local[(index & 4) === 0 ? 2 : 5]!;
        corner.set(
          table[offset]! * x + table[offset + 4]! * y + table[offset + 8]! * z + table[offset + 12]!,
          table[offset + 1]! * x + table[offset + 5]! * y + table[offset + 9]! * z + table[offset + 13]!,
          table[offset + 2]! * x + table[offset + 6]! * y + table[offset + 10]! * z + table[offset + 14]!,
        );
        box.expandByPoint(corner);
      }
    }
  }
}

function expandBox(box: Float64Array, x: number, y: number, z: number): void {
  if (x < box[0]!) box[0] = x;
  if (y < box[1]!) box[1] = y;
  if (z < box[2]!) box[2] = z;
  if (x > box[3]!) box[3] = x;
  if (y > box[4]!) box[4] = y;
  if (z > box[5]!) box[5] = z;
}

/** Copies the upper 3x3 of a column-major matrix into `observed`, reporting whether it changed. */
function observeLinearPart(elements: readonly number[], observed: Float64Array): boolean {
  let changed = false;
  for (let column = 0; column < 3; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      const value = elements[column * 4 + row]!;
      const index = column * 3 + row;
      if (observed[index] === value) continue;
      observed[index] = value;
      changed = true;
    }
  }
  return changed;
}

function zeroRow(table: Float32Array, offset: number): boolean {
  for (let index = 0; index < 16; index += 1) {
    if (table[offset + index] !== 0) return false;
  }
  return true;
}
