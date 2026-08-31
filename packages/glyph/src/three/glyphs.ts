import * as THREE from 'three/webgpu';

import type { PlanAcceptance, PlanTarget } from '../core.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { GlyphPlacement, GlyphPlacements } from '../glyph-placement.js';
import type { ThreeEngineDomainLease } from './engine-domain.js';
import {
  markStorageAttributeUpdated,
  ThreeTextRenderPlanExecutor,
  type ThreeTextEnginePlanOwner,
} from './engine-plan-target.js';
import type { ThreeGlyphGeometrySource, ThreeGlyphMeasurement } from './glyph-measurement.js';
import { measureGlyphPlacements } from './glyph-measurement.js';
import type { Text } from './text.js';
import { copyCurrentLocalTransform } from './detached-object.js';

/**
 * Converts an instance matrix from the `Glyphs` object's world space into its local space.
 *
 * @param glyphsMatrixWorld - Current `matrixWorld` of the `Glyphs` object that owns the instance.
 * @param matrixWorld - Instance transform expressed in world space.
 * @param target - Matrix that receives the local transform; it may alias `matrixWorld`.
 */
export function worldToLocalMatrix(
  glyphsMatrixWorld: THREE.Matrix4,
  matrixWorld: THREE.Matrix4,
  target: THREE.Matrix4,
): THREE.Matrix4 {
  if (matrixWorld === target) return target.premultiply(glyphsMatrixWorld.clone().invert());
  return target.copy(glyphsMatrixWorld).invert().multiply(matrixWorld);
}

/**
 * Converts an instance matrix from `Glyphs`-local space into world space.
 *
 * @param glyphsMatrixWorld - Current `matrixWorld` of the `Glyphs` object that owns the instance.
 * @param matrixLocal - Instance transform expressed in the owning `Glyphs` object's local space.
 * @param target - Matrix that receives the world transform; it may alias `matrixLocal`.
 */
export function localToWorldMatrix(
  glyphsMatrixWorld: THREE.Matrix4,
  matrixLocal: THREE.Matrix4,
  target: THREE.Matrix4,
): THREE.Matrix4 {
  if (matrixLocal === target) return target.premultiply(glyphsMatrixWorld);
  return target.copy(glyphsMatrixWorld).multiply(matrixLocal);
}

/** @internal Constructed only by `Text.breakApart()`. */
interface GlyphsOptions<Technique extends AnyRasterTechnique> {
  readonly source: Text<Technique>;
  readonly placements: GlyphPlacements;
  readonly geometry?: ReadonlyMap<number, ThreeGlyphGeometrySource>;
  readonly copy: (target: PlanTarget) => PlanAcceptance;
  readonly domain: ThreeEngineDomainLease;
  readonly renderOrderBase: number;
}

const glyphsConstructorToken: unique symbol = Symbol('pmndrs.glyph.Glyphs');
let constructGlyphs: ((options: GlyphsOptions<AnyRasterTechnique>) => Glyphs) | undefined;
let configureGlyphDrawOrder: ((glyphs: Glyphs, start: number) => number) | undefined;

/** @internal Constructs the detached branch while keeping the public class receive-only. */
export function createGlyphs(options: GlyphsOptions<AnyRasterTechnique>): Glyphs {
  if (constructGlyphs === undefined) {
    options.domain.dispose();
    throw new Error('Glyphs constructor is unavailable');
  }
  return constructGlyphs(options);
}

/** @internal Assigns the detached glyph draw range and returns its draw count. */
export function setGlyphDrawOrder(glyphs: Glyphs, start: number): number {
  if (configureGlyphDrawOrder === undefined) throw new Error('Glyphs draw-order coordinator is unavailable');
  return configureGlyphDrawOrder(glyphs, start);
}

/** Immutable identity and grouping metadata for one drawable record in a detached `Glyphs` object. */
export interface DetachedGlyph {
  /** Dense index accepted by every `Glyphs` matrix method. */
  readonly index: number;
  /** Original visual-order index in the committed source paragraph. */
  readonly sourceIndex: number;
  readonly key: GlyphPlacement['key'];
  readonly cluster: number;
  readonly line: number;
  readonly word: number;
  readonly fontSize: number;
  readonly advance: number;
}

interface DetachedGlyphStorage {
  readonly transforms: THREE.StorageInstancedBufferAttribute;
  readonly pivots: THREE.StorageInstancedBufferAttribute;
}

interface DetachedGlyphRecordAddress {
  readonly storageKey: string;
  readonly index: number;
}

/**
 * A detached render-plan branch produced by `Text.breakApart()`.
 *
 * The planner has already compacted the selected glyph records into a complete publication. This
 * object imports that publication into the normal Three render-plan executor, retaining the same
 * atlas/resource relationships and compatible instancing without making child Text objects.
 * Per-glyph matrices are an additional Three-side instance attribute; the live paragraph never
 * receives them and continues to shape normally.
 */
export class Glyphs extends THREE.Group {
  readonly #target: ThreeTextRenderPlanExecutor;
  readonly #domain: ThreeEngineDomainLease;
  readonly #owner: ThreeTextEnginePlanOwner;
  readonly #placements: readonly GlyphPlacement[];
  readonly #glyphs: readonly DetachedGlyph[];
  readonly #measurements: readonly ThreeGlyphMeasurement[];
  readonly #recordAddresses: readonly DetachedGlyphRecordAddress[];
  readonly #storages = new Map<string, DetachedGlyphStorage>();
  readonly #worldLocal = new THREE.Matrix4();
  #disposed = false;

  static {
    constructGlyphs = (options) => new Glyphs(glyphsConstructorToken, options);
    configureGlyphDrawOrder = (glyphs, start) => {
      for (const [index, draw] of glyphs.#target.draws.entries()) draw.renderOrder = start + index;
      return glyphs.#target.draws.length;
    };
  }

  private constructor(token: typeof glyphsConstructorToken, options: GlyphsOptions<AnyRasterTechnique>) {
    super();
    if (token !== glyphsConstructorToken) throw new TypeError('Glyphs objects are created by Text.breakApart()');
    this.#domain = options.domain;
    let target: ThreeTextRenderPlanExecutor | undefined;
    try {
      const incomplete = new Set(options.placements.incomplete);
      this.#placements = Object.freeze(options.placements.glyphs.filter((_, index) => !incomplete.has(index)));
      this.#glyphs = Object.freeze(
        this.#placements.map((placement, index) =>
          Object.freeze({
            index,
            sourceIndex: placement.index,
            key: placement.key,
            cluster: placement.cluster,
            line: placement.line,
            word: placement.word,
            fontSize: placement.fontSize,
            advance: placement.advance,
          }),
        ),
      );
      this.#measurements = Object.freeze(
        measureGlyphPlacements(options.placements, options.geometry)
          .filter((_, index) => !incomplete.has(index))
          .map((measurement, index) => Object.freeze({ ...measurement, index })),
      );
      copyCurrentLocalTransform(options.source, this);
      // A Glyphs object may receive world-space instance writes in the first useFrame after it is
      // attached, before the renderer has traversed the scene once.
      this.matrixWorldNeedsUpdate = true;

      const owner = this;
      this.#owner = {
        drawRoot: this,
        pixelSnapping: options.source.pixelSnapping,
        renderOrderBase: options.renderOrderBase,
        objectForTransform() {
          return owner;
        },
        prepareGlyphStorage(storageKey, capacityRecords) {
          const existing = owner.#storages.get(storageKey);
          if (existing !== undefined) {
            if (existing.pivots.count !== capacityRecords) {
              throw new Error('detached glyph plan changed physical record capacity during realization');
            }
            return;
          }
          const capacity = Math.max(1, capacityRecords);
          const transforms = new THREE.StorageInstancedBufferAttribute(new Float32Array(capacity * 16), 4);
          const pivots = new THREE.StorageInstancedBufferAttribute(new Float32Array(capacity * 2), 2);
          transforms.setUsage(THREE.DynamicDrawUsage);
          pivots.setUsage(THREE.StaticDrawUsage);
          owner.#storages.set(storageKey, { transforms, pivots });
        },
        glyphStorage(storageKey) {
          return owner.#storages.get(storageKey);
        },
      };
      target = new ThreeTextRenderPlanExecutor(options.domain.coordinator, this.#owner);
      this.#target = target;
      const result = options.copy(this.#target);
      if (!result.accepted) throw result.error;
      if (this.#storages.size === 0) {
        throw new Error('detached glyph copy produced no drawable record storage');
      }
      this.#recordAddresses = Object.freeze(
        this.#placements.map((placement) => {
          const stableId = options.placements.layout.glyphStableIds[placement.index];
          if (stableId === undefined) throw new Error(`detached glyph ${placement.index} has no stable id`);
          const address = this.#target.glyphRecord(stableId);
          if (address === undefined)
            throw new Error(`detached glyph ${placement.index} is missing from the planner slice`);
          const storage = this.#storages.get(address.storageKey);
          if (storage === undefined) {
            throw new Error(`detached glyph ${placement.index} references unknown physical record storage`);
          }
          if (address.index < 0 || address.index >= storage.pivots.count) {
            throw new RangeError(
              `detached glyph ${placement.index} exceeds the copied plan's physical record capacity`,
            );
          }
          return address;
        }),
      );
      this.#initializeTransforms();
      // Plan realization visits the root before it is attached and consumes the initial dirty flag.
      // Re-dirty it so the first scene traversal composes this exact local matrix with its real parent.
      this.matrixWorldNeedsUpdate = true;
    } catch (error) {
      try {
        target?.dispose();
        for (const storage of this.#storages.values()) {
          storage.transforms.dispose();
          storage.pivots.dispose();
        }
        this.#storages.clear();
      } finally {
        options.domain.dispose();
      }
      throw error;
    }
  }

  get count(): number {
    return this.#placements.length;
  }

  get measurements(): readonly ThreeGlyphMeasurement[] {
    return this.#measurements;
  }

  /** Mutable material instances owned by this detached branch. */
  get materials(): readonly THREE.NodeMaterial[] {
    this.#assertActive();
    return this.#target.materials;
  }

  getMatrixAt(index: number, target: THREE.Matrix4): void {
    this.#assertActive();
    const { storage, index: record } = this.#record(index);
    target.fromArray(storage.transforms.array as Float32Array, record * 16);
  }

  setMatrixAt(index: number, matrix: THREE.Matrix4): void {
    this.#assertActive();
    const { storage, index: record } = this.#record(index);
    const offset = record * 16;
    storage.transforms.array.set(matrix.elements, offset);
    markStorageAttributeUpdated(storage.transforms, offset, 16);
  }

  /**
   * Writes a full affine instance transform expressed in world space.
   *
   * This single-record convenience updates the detached root's ancestor chain. Bulk callers should
   * update that chain once, convert with `worldToLocalMatrix()`, and call `setMatrixAt()` per glyph.
   */
  setWorldMatrixAt(index: number, matrixWorld: THREE.Matrix4): void {
    this.#assertActive();
    this.updateWorldMatrix(true, false, true);
    worldToLocalMatrix(this.matrixWorld, matrixWorld, this.#worldLocal);
    this.setMatrixAt(index, this.#worldLocal);
  }

  /** Reads a full affine instance transform expressed in world space. */
  getWorldMatrixAt(index: number, target: THREE.Matrix4): void {
    this.#assertActive();
    this.updateWorldMatrix(true, false, true);
    this.getMatrixAt(index, target);
    localToWorldMatrix(this.matrixWorld, target, target);
  }

  glyphAt(index: number): DetachedGlyph | undefined {
    return this.#glyphs[index];
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    try {
      this.#target.dispose();
    } catch (error) {
      failure = error;
    }
    for (const storage of this.#storages.values()) {
      try {
        storage.transforms.dispose();
        storage.pivots.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    this.#storages.clear();
    try {
      this.#domain.dispose();
    } catch (error) {
      failure ??= error;
    }
    this.removeFromParent();
    if (failure !== undefined) throw failure;
  }

  #initializeTransforms(): void {
    for (const [index, placement] of this.#placements.entries()) {
      const address = this.#recordAddresses[index]!;
      const storage = this.#storages.get(address.storageKey);
      if (storage === undefined) throw new Error(`detached glyph ${index} lost its physical record storage`);
      const transforms = storage.transforms.array as Float32Array;
      const pivots = storage.pivots.array as Float32Array;
      const record = address.index;
      const x = placement.x;
      const y = -placement.y;
      pivots.set([x, y], record * 2);
      new THREE.Matrix4().makeTranslation(x, y, 0).toArray(transforms, record * 16);
    }
    for (const storage of this.#storages.values()) {
      storage.pivots.needsUpdate = true;
      storage.transforms.needsUpdate = true;
    }
  }

  #record(index: number): Readonly<{ storage: DetachedGlyphStorage; index: number }> {
    if (!Number.isInteger(index) || index < 0 || index >= this.#recordAddresses.length) {
      throw new RangeError(`glyph index ${index} is out of range`);
    }
    const address = this.#recordAddresses[index]!;
    const storage = this.#storages.get(address.storageKey);
    if (storage === undefined) throw new Error(`glyph ${index} has no physical record storage`);
    return { storage, index: address.index };
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('glyphs have been disposed');
  }
}
