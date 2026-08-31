import * as THREE from 'three/webgpu';

import type { PlanAcceptance, PlanTarget } from '../core.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { ThreeEngineDomainLease } from './engine-domain.js';
import { ThreeTextRenderPlanExecutor, type ThreeTextEnginePlanOwner } from './engine-plan-target.js';
import type { Text } from './text.js';
import { copyCurrentLocalTransform } from './detached-object.js';

/** @internal Constructed only by `Text.breakApart()`. */
interface DecorationsOptions<Technique extends AnyRasterTechnique> {
  readonly source: Text<Technique>;
  readonly copy: (target: PlanTarget) => PlanAcceptance;
  readonly domain: ThreeEngineDomainLease;
  readonly renderOrderBase: number;
}

const decorationsConstructorToken: unique symbol = Symbol('pmndrs.glyph.Decorations');
let constructDecorations: ((options: DecorationsOptions<AnyRasterTechnique>) => Decorations) | undefined;
let decorationsHaveDraws: ((decorations: Decorations) => boolean) | undefined;
let inspectDecorationDraws:
  | ((decorations: Decorations) => Readonly<{ under: readonly THREE.Mesh[]; over: readonly THREE.Mesh[] }>)
  | undefined;

/** @internal Constructs the detached branch while keeping the public class receive-only. */
export function createDecorations(options: DecorationsOptions<AnyRasterTechnique>): Decorations | undefined {
  if (constructDecorations === undefined || decorationsHaveDraws === undefined) {
    options.domain.dispose();
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
export class Decorations extends THREE.Group {
  readonly #target: ThreeTextRenderPlanExecutor;
  readonly #domain: ThreeEngineDomainLease;
  #disposed = false;

  static {
    constructDecorations = (options) => new Decorations(decorationsConstructorToken, options);
    decorationsHaveDraws = (decorations) => decorations.#target.draws.length !== 0;
    inspectDecorationDraws = (decorations) => {
      const under: THREE.Mesh[] = [];
      const over: THREE.Mesh[] = [];
      for (const draw of decorations.#target.draws) {
        if (draw.userData.pmndrsGlyphDepthKey === 2) over.push(draw);
        else under.push(draw);
      }
      return Object.freeze({ under: Object.freeze(under), over: Object.freeze(over) });
    };
  }

  private constructor(token: typeof decorationsConstructorToken, options: DecorationsOptions<AnyRasterTechnique>) {
    super();
    if (token !== decorationsConstructorToken) {
      throw new TypeError('Decorations objects are created by Text.breakApart()');
    }
    this.#domain = options.domain;
    let target: ThreeTextRenderPlanExecutor | undefined;
    try {
      copyCurrentLocalTransform(options.source, this);

      const owner: ThreeTextEnginePlanOwner = {
        drawRoot: this,
        pixelSnapping: options.source.pixelSnapping,
        renderOrderBase: options.renderOrderBase,
        objectForTransform: () => this,
      };
      target = new ThreeTextRenderPlanExecutor(options.domain.coordinator, owner);
      this.#target = target;
      const result = options.copy(target);
      if (!result.accepted) throw result.error;
      this.matrixWorldNeedsUpdate = true;
    } catch (error) {
      try {
        target?.dispose();
      } finally {
        options.domain.dispose();
      }
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
      this.#target.dispose();
    } catch (error) {
      failure = error;
    }
    try {
      this.#domain.dispose();
    } catch (error) {
      failure ??= error;
    }
    this.removeFromParent();
    if (failure !== undefined) throw failure;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('decorations have been disposed');
  }
}
