import * as THREE from 'three/webgpu';

import type { PlanAcceptance, PlanTarget } from '../core.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { ThreeEngineDomainLease } from './engine-domain.js';
import { ThreeTextRenderPlanExecutor, type ThreeTextEnginePlanOwner } from './engine-plan-target.js';
import type { Text } from './text.js';

/** @internal Constructed only by `Text.breakApart()`. */
interface DecorationsOptions<Technique extends AnyRasterTechnique> {
  readonly source: Text<Technique>;
  readonly copy: (target: PlanTarget) => PlanAcceptance;
  readonly domain: ThreeEngineDomainLease;
}

const decorationsConstructorToken: unique symbol = Symbol('pmndrs.glyph.Decorations');
let constructDecorations: ((options: DecorationsOptions<AnyRasterTechnique>) => Decorations) | undefined;
let decorationsHaveDraws: ((decorations: Decorations) => boolean) | undefined;

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

/** An independently rendered copy of one committed paragraph's decorations. */
export class Decorations extends THREE.Group {
  readonly #target: ThreeTextRenderPlanExecutor;
  readonly #domain: ThreeEngineDomainLease;
  #disposed = false;

  static {
    constructDecorations = (options) => new Decorations(decorationsConstructorToken, options);
    decorationsHaveDraws = (decorations) => decorations.#target.draws.length !== 0;
  }

  private constructor(token: typeof decorationsConstructorToken, options: DecorationsOptions<AnyRasterTechnique>) {
    super();
    if (token !== decorationsConstructorToken) {
      throw new TypeError('Decorations objects are created by Text.breakApart()');
    }
    this.#domain = options.domain;
    let target: ThreeTextRenderPlanExecutor | undefined;
    try {
      this.matrix.copy(options.source.matrix);
      this.matrix.decompose(this.position, this.quaternion, this.scale);
      this.matrixWorldNeedsUpdate = true;
      this.renderOrder = options.source.renderOrder;

      const owner: ThreeTextEnginePlanOwner = {
        drawRoot: this,
        pixelSnapping: options.source.pixelSnapping,
        renderOrderBase: options.source.renderOrder,
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
