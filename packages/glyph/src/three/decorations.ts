import * as THREE from 'three/webgpu';

import type { GlyphCopy } from '../glyph-config.js';
import type { AnyRasterFormat } from '../raster-format.js';
import { ThreeTextRenderPlanExecutor, type ThreeTextEnginePlanOwner } from './engine-plan-target.js';
import type { ThreeRootBinding } from './handle.js';
import type { ThreeRendererResources } from './renderer-resources.js';
import type { Text } from './text.js';
import { copyCurrentLocalTransform } from './detached-object.js';

/** @internal Constructed only by `Text.breakApart()`. */
interface DecorationsOptions<Technique extends AnyRasterFormat> {
  readonly source: Text<Technique>;
  readonly copy: (renderer: ThreeTextRenderPlanExecutor, boundary: ThreeRootBinding) => GlyphCopy<void>;
  readonly resources: ThreeRendererResources;
  readonly renderOrderBase: number;
}

const decorationsConstructorToken: unique symbol = Symbol('pmndrs.glyph.Decorations');
let constructDecorations: ((options: DecorationsOptions<AnyRasterFormat>) => Decorations) | undefined;
let decorationsHaveDraws: ((decorations: Decorations) => boolean) | undefined;
let inspectDecorationDraws:
  | ((decorations: Decorations) => Readonly<{ under: readonly THREE.Mesh[]; over: readonly THREE.Mesh[] }>)
  | undefined;

/** @internal Constructs the detached branch while keeping the public class receive-only. */
export function createDecorations(options: DecorationsOptions<AnyRasterFormat>): Decorations | undefined {
  if (constructDecorations === undefined || decorationsHaveDraws === undefined) {
    throw new Error('Decorations constructor is unavailable');
  }
  const decorations = constructDecorations(options);
  if (decorationsHaveDraws(decorations)) return decorations;
  decorations.dispose();
  return undefined;
}

/** @internal Returns detached decoration draws partitioned by CSS paint pass. */
export function decorationDraws(
  decorations: Decorations,
): Readonly<{ under: readonly THREE.Mesh[]; over: readonly THREE.Mesh[] }> {
  if (inspectDecorationDraws === undefined) throw new Error('Decorations draw-order coordinator is unavailable');
  return inspectDecorationDraws(decorations);
}

/** An independently rendered copy of one committed paragraph's decorations. */
export class Decorations extends THREE.Object3D {
  readonly #target: ThreeTextRenderPlanExecutor;
  readonly #copy: GlyphCopy<void>;
  #disposed = false;

  static {
    constructDecorations = (options) => new Decorations(decorationsConstructorToken, options);
    decorationsHaveDraws = (decorations) => decorations.#target.draws.length !== 0;
    inspectDecorationDraws = (decorations) => {
      const under: THREE.Mesh[] = [];
      const over: THREE.Mesh[] = [];
      for (const draw of decorations.#target.draws) {
        const depthKey = draw.userData.pmndrsGlyphDepthKey;
        if (depthKey === 0) under.push(draw);
        else if (depthKey === 2) over.push(draw);
        else throw new Error(`detached decoration draw has unsupported depth key ${String(depthKey)}`);
      }
      return Object.freeze({ under: Object.freeze(under), over: Object.freeze(over) });
    };
  }

  private constructor(token: typeof decorationsConstructorToken, options: DecorationsOptions<AnyRasterFormat>) {
    super();
    if (token !== decorationsConstructorToken) {
      throw new TypeError('Decorations objects are created by Text.breakApart()');
    }
    let target: ThreeTextRenderPlanExecutor | undefined;
    let copy: GlyphCopy<void> | undefined;
    try {
      copyCurrentLocalTransform(options.source, this);

      const owner: ThreeTextEnginePlanOwner = {
        drawRoot: this,
        pixelSnapping: options.source.pixelSnapping,
        renderOrderBase: options.renderOrderBase,
        objectForTransform: () => this,
      };
      target = new ThreeTextRenderPlanExecutor(options.resources, owner);
      this.#target = target;
      copy = options.copy(target, {
        drawRoot: this,
        root: Object.freeze({ name: undefined, scene: undefined, drawRoot: this }),
        material: options.resources.material,
        objectForTransform: () => this,
      });
      this.#copy = copy;
      this.matrixWorldNeedsUpdate = true;
    } catch (error) {
      copy?.dispose();
      if (copy === undefined) target?.dispose();
      throw error;
    }
  }

  /** Mutable material instances owned by this detached branch. */
  get materials(): readonly THREE.NodeMaterial[] {
    this.#assertActive();
    return this.#target.materials;
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
    this.removeFromParent();
    if (failure !== undefined) throw failure;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('decorations have been disposed');
  }
}
