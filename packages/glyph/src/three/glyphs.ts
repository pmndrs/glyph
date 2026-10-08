import * as THREE from 'three/webgpu';

import type { GlyphCopy } from '../config/glyph.js';
import type { GlyphOutlineContour } from '../glyph-outline.js';
import type { GlyphLayoutInspection } from '../layout.js';
import type { GlyphPlacement, GlyphPlacements } from '../glyph-placement.js';
import { ThreeCommandBufferRenderer, type ThreeRendererHost } from './command-buffer-renderer.js';
import type { ThreeGlyphGeometrySource, ThreeGlyphMeasurement } from './glyph-measurement.js';
import { measureGlyphPlacements } from './glyph-measurement.js';
import { markStorageAttributeUpdated } from './internal/host-buffer.js';
import type { ThreePublicationBoundary } from './internal/publication-boundary.js';
import type { ThreeRendererResources } from './internal/renderer-resources.js';
import { copyCurrentLocalTransform } from './detached-object.js';

interface DetachedTextSource extends THREE.Object3D {
  readonly pixelSnapping: boolean;
}

/** Converts an instance matrix from world into one `Glyphs` object's local space using a precomputed inverse (no allocation/recompute); `target` may alias `matrixWorld`. */
export function worldToLocalMatrix(
  glyphsMatrixWorldInverse: THREE.Matrix4,
  matrixWorld: THREE.Matrix4,
  target: THREE.Matrix4,
): THREE.Matrix4 {
  if (matrixWorld === target) return target.premultiply(glyphsMatrixWorldInverse);
  return target.copy(glyphsMatrixWorldInverse).multiply(matrixWorld);
}

/** Converts an instance matrix from `Glyphs`-local space into world space using the owner's current `matrixWorld`; `target` may alias `matrixLocal`. */
export function localToWorldMatrix(
  glyphsMatrixWorld: THREE.Matrix4,
  matrixLocal: THREE.Matrix4,
  target: THREE.Matrix4,
): THREE.Matrix4 {
  if (matrixLocal === target) return target.premultiply(glyphsMatrixWorld);
  return target.copy(glyphsMatrixWorld).multiply(matrixLocal);
}

/** @internal Constructed only by `Text.breakApart()`. */
interface GlyphsOptions {
  readonly source: DetachedTextSource;
  readonly placements: GlyphPlacements;
  readonly geometry?: ReadonlyMap<number, ThreeGlyphGeometrySource>;
  readonly copy: (renderer: ThreeCommandBufferRenderer, boundary: ThreePublicationBoundary) => GlyphCopy<void>;
  readonly resources: ThreeRendererResources;
  readonly renderOrderBase: number;
}

const glyphsConstructorToken: unique symbol = Symbol('pmndrs.glyph.Glyphs');
let constructGlyphs: ((options: GlyphsOptions) => Glyphs) | undefined;
let configureGlyphDrawOrder: ((glyphs: Glyphs, start: number) => number) | undefined;

/** @internal Constructs the detached branch while keeping the public class receive-only. */
export function createGlyphs(options: GlyphsOptions): Glyphs {
  if (constructGlyphs === undefined) {
    throw new Error('Glyphs constructor is unavailable');
  }
  return constructGlyphs(options);
}

/** @internal Assigns the detached glyph draw range and returns its draw count. */
export function setGlyphDrawOrder(glyphs: Glyphs, start: number): number {
  if (configureGlyphDrawOrder === undefined) throw new Error('Glyphs draw-order coordinator is unavailable');
  return configureGlyphDrawOrder(glyphs, start);
}

/** Immutable identity and grouping metadata for one glyph of a detached `Glyphs` object. */
export interface DetachedGlyph {
  /** The glyph's layout index, the one `text.glyphs()`, `text.withGlyphs()`, `GlyphPlacement.index`, and every `Glyphs` method use. */
  readonly index: number;
  readonly key: GlyphPlacement['key'];
  /** The font that shaped this glyph: a plain number, never reused, that retains nothing. Equals `text.glyphs().fontHandles[glyphFontSlots[index]]`. */
  readonly fontHandle: number;
  /** The glyph index in that font, not a Unicode code point or a layout index. Equal `fontHandle` and `glyphId` mean an equal outline. */
  readonly glyphId: number;
  readonly cluster: number;
  readonly line: number;
  readonly word: number;
  readonly fontSize: number;
  readonly advance: number;
}

interface DetachedGlyphStorage {
  /** Shader matrix already composed with the inverse rest pivot, one per physical record. */
  readonly transforms: THREE.StorageInstancedBufferAttribute;
}

/**
 * A detached render-plan branch from `Text.breakApart()`: imports the planner's compacted publication into the normal renderer without child Text objects; per-glyph matrices are Three-side only and never reach the live paragraph.
 *
 * Every per-glyph datum is indexed by the layout glyph index of `text.glyphs()`. Blank glyphs keep their index and
 * matrix but have no render record.
 */
export class Glyphs extends THREE.Object3D {
  readonly #target: ThreeCommandBufferRenderer;
  readonly #copy: GlyphCopy<void>;
  readonly #owner: ThreeRendererHost;
  readonly #layout: GlyphLayoutInspection;
  readonly #glyphs: readonly DetachedGlyph[];
  readonly #measurements: readonly ThreeGlyphMeasurement[];
  /** Public matrices, 16 per glyph, keep the user-facing pivot-relative contract. */
  readonly #matrices: Float32Array;
  /** Each glyph's drawn pen origin, 2 per glyph. */
  readonly #pivots: Float32Array;
  /** Physical record of each glyph in its storage, or -1 when the glyph draws nothing. */
  readonly #records: Int32Array;
  readonly #recordStorages: (DetachedGlyphStorage | undefined)[];
  readonly #storages = new Map<string, DetachedGlyphStorage>();
  readonly #worldLocal = new THREE.Matrix4();
  readonly #worldInverse = new THREE.Matrix4();
  readonly #composed = new THREE.Matrix4();
  readonly #inversePivot = new THREE.Matrix4();
  #disposed = false;

  static {
    constructGlyphs = (options) => new Glyphs(glyphsConstructorToken, options);
    configureGlyphDrawOrder = (glyphs, start) => {
      for (const [index, draw] of glyphs.#target.draws.entries()) draw.renderOrder = start + index;
      return glyphs.#target.draws.length;
    };
  }

  private constructor(token: typeof glyphsConstructorToken, options: GlyphsOptions) {
    super();
    if (token !== glyphsConstructorToken) throw new TypeError('Glyphs objects are created by Text.breakApart()');
    let target: ThreeCommandBufferRenderer | undefined;
    let copy: GlyphCopy<void> | undefined;
    try {
      const layout = options.placements.layout;
      this.#layout = layout;
      const incomplete = new Set(options.placements.incomplete);
      const placements = options.placements.glyphs;
      this.#glyphs = Object.freeze(
        placements.map((placement, index) =>
          Object.freeze({
            index,
            fontHandle: layout.fontHandles[layout.glyphFontSlots[index]!]!,
            glyphId: layout.glyphIds[index]!,
            key: placement.key,
            cluster: placement.cluster,
            line: placement.line,
            word: placement.word,
            fontSize: placement.fontSize,
            advance: placement.advance,
          }),
        ),
      );
      this.#measurements = measureGlyphPlacements(options.placements, options.geometry);
      this.#matrices = new Float32Array(placements.length * 16);
      this.#pivots = new Float32Array(placements.length * 2);
      this.#records = new Int32Array(placements.length).fill(-1);
      this.#recordStorages = new Array<DetachedGlyphStorage | undefined>(placements.length).fill(undefined);
      copyCurrentLocalTransform(options.source, this);
      // A Glyphs object may receive world-space instance writes in the first useFrame after it is
      // attached, before the renderer has traversed the scene once.
      this.matrixWorldNeedsUpdate = true;

      const owner = this;
      this.#owner = {
        renderObject: this,
        pixelSnapping: options.source.pixelSnapping,
        renderOrderBase: options.renderOrderBase,
        objectForTransform() {
          return owner;
        },
        prepareGlyphStorage(storageKey, capacityRecords) {
          const existing = owner.#storages.get(storageKey);
          if (existing !== undefined) {
            if (existing.transforms.count / 4 !== capacityRecords) {
              throw new Error('detached glyph plan changed physical record capacity during realization');
            }
            return;
          }
          const capacity = Math.max(1, capacityRecords);
          const transforms = new THREE.StorageInstancedBufferAttribute(new Float32Array(capacity * 16), 4);
          transforms.setUsage(THREE.DynamicDrawUsage);
          owner.#storages.set(storageKey, { transforms });
        },
        glyphStorage(storageKey) {
          return owner.#storages.get(storageKey);
        },
      };
      target = new ThreeCommandBufferRenderer(options.resources, this.#owner);
      this.#target = target;
      copy = options.copy(this.#target, {
        renderObject: this,
        root: Object.freeze({ name: undefined, scene: undefined, renderObject: this }),
        material: options.resources.material,
        objectForTransform: (_recordIndex, _source) => this,
      });
      this.#copy = copy;
      if (this.#storages.size === 0) {
        throw new Error('detached glyph copy produced no drawable record storage');
      }
      for (const [index, placement] of placements.entries()) {
        if (incomplete.has(index)) continue;
        const stableId = layout.glyphStableIds[index];
        if (stableId === undefined) throw new Error(`detached glyph ${placement.index} has no stable id`);
        const address = this.#target.glyphRecord(stableId);
        if (address === undefined)
          throw new Error(`detached glyph ${placement.index} is missing from the planner slice`);
        const storage = this.#storages.get(address.storageKey);
        if (storage === undefined) {
          throw new Error(`detached glyph ${placement.index} references unknown physical record storage`);
        }
        if (address.index < 0 || address.index >= storage.transforms.count / 4) {
          throw new RangeError(`detached glyph ${placement.index} exceeds the copied plan's physical record capacity`);
        }
        this.#records[index] = address.index;
        this.#recordStorages[index] = storage;
      }
      this.#initializeTransforms(placements);
      // Command-buffer realization visits the root before it is attached and consumes the initial dirty flag.
      // Re-dirty it so the first scene traversal composes this exact local matrix with its real parent.
      this.matrixWorldNeedsUpdate = true;
    } catch (error) {
      copy?.dispose();
      if (copy === undefined) target?.dispose();
      for (const storage of this.#storages.values()) {
        storage.transforms.dispose();
      }
      this.#storages.clear();
      throw error;
    }
  }

  /** The layout's glyph count, drawn or not: every index below it is valid. */
  get count(): number {
    return this.#glyphs.length;
  }

  /** One measurement per glyph, at the glyph's index. */
  get measurements(): readonly ThreeGlyphMeasurement[] {
    return this.#measurements;
  }

  /** Mutable material instances owned by this detached branch. */
  get materials(): readonly THREE.NodeMaterial[] {
    this.#assertActive();
    return this.#target.materials;
  }

  /** Reads glyph `index`'s matrix, a blank glyph's included: its rest value is a translation to its pen origin. */
  getMatrixAt(index: number, target: THREE.Matrix4): void {
    this.#assertActive();
    this.#assertIndex(index);
    target.fromArray(this.#matrices, index * 16);
  }

  /** Writes glyph `index`'s matrix. A blank glyph stores it and draws nothing. */
  setMatrixAt(index: number, matrix: THREE.Matrix4): void {
    this.#assertActive();
    this.#assertIndex(index);
    this.#matrices.set(matrix.elements, index * 16);
    const storage = this.#recordStorages[index];
    if (storage === undefined) return;
    const pivotOffset = index * 2;
    this.#inversePivot.makeTranslation(-this.#pivots[pivotOffset]!, -this.#pivots[pivotOffset + 1]!, 0);
    this.#composed.copy(matrix).multiply(this.#inversePivot);
    const offset = this.#records[index]! * 16;
    storage.transforms.array.set(this.#composed.elements, offset);
    markStorageAttributeUpdated(storage.transforms, offset, 16);
  }

  /** Writes a world-space transform; this per-call convenience updates the ancestor chain and inverts `matrixWorld` each time — bulk callers should do that once and call `setMatrixAt()` per glyph. */
  setWorldMatrixAt(index: number, matrixWorld: THREE.Matrix4): void {
    this.#assertActive();
    this.updateWorldMatrix(true, false, true);
    this.#worldInverse.copy(this.matrixWorld).invert();
    worldToLocalMatrix(this.#worldInverse, matrixWorld, this.#worldLocal);
    this.setMatrixAt(index, this.#worldLocal);
  }

  /** Reads a full affine instance transform expressed in world space. */
  getWorldMatrixAt(index: number, target: THREE.Matrix4): void {
    this.#assertActive();
    this.updateWorldMatrix(true, false, true);
    this.getMatrixAt(index, target);
    localToWorldMatrix(this.matrixWorld, target, target);
  }

  /** Glyph `index`'s identity, grouping, and whether it draws. Throws `RangeError` outside `0 <= index < count`. */
  glyphAt(index: number): DetachedGlyph {
    this.#assertIndex(index);
    return this.#glyphs[index]!;
  }

  /**
   * Reads glyph `index`'s outline as `text.glyphs().outlineAt(index)` does: closed contours of
   * `[x0, y0, cx, cy, x1, y1, isLine]` curves in em units, y down, origin at the glyph's pen origin, the pivot of the
   * matrix `setMatrixAt` places. To draw the glyph where this object draws it, scale each coordinate by
   * `DetachedGlyph.fontSize`, negate y (this object's local space is y up), and place the result with the glyph's
   * matrix. A blank glyph returns `[]`.
   *
   * The outlines were captured when `breakApart()` ran, so, like `glyphAt`, this still reads after the source `Text`
   * re-lays out and after the font or this object is disposed. Throws `RangeError` outside `0 <= index < count`, and
   * `TypeError` when the glyph's font was baked without outlines.
   */
  outlineAt(index: number): GlyphOutlineContour[] {
    this.#assertIndex(index);
    return this.#layout.outlineAt(index);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    try {
      this.#copy.dispose();
    } catch (error) {
      failure = error;
    }
    for (const storage of this.#storages.values()) {
      try {
        storage.transforms.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    this.#storages.clear();
    this.removeFromParent();
    if (failure !== undefined) throw failure;
  }

  #initializeTransforms(placements: readonly GlyphPlacement[]): void {
    for (const [index, placement] of placements.entries()) {
      const x = placement.x;
      const y = -placement.y;
      this.#pivots.set([x, y], index * 2);
      this.#composed.makeTranslation(x, y, 0);
      this.#composed.toArray(this.#matrices, index * 16);
      const storage = this.#recordStorages[index];
      if (storage === undefined) continue;
      this.#composed.identity().toArray(storage.transforms.array as Float32Array, this.#records[index]! * 16);
    }
    for (const storage of this.#storages.values()) {
      storage.transforms.needsUpdate = true;
    }
  }

  #assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.#glyphs.length) {
      throw new RangeError(`glyph index ${index} is out of range`);
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('glyphs have been disposed');
  }
}
