import {
  createEngine,
  type BackendMaterialBinding,
  type BackendTransformBinding,
  type BorrowedBoundCommandBuffer,
  type BorrowedTypedCommandBuffer,
  type GlyphCommandBufferBinder,
  type PlanCandidate,
} from '../core.js';
import type { ThreeTextEngineCoordinator } from './engine-coordinator.js';
import type { ThreeBindings, ThreeGlyphConfig, ThreeRootBinding } from './handle.js';
import type { ThreeRootContext } from './material.js';
import type { ThreeTextEnginePlanOwner } from './engine-plan-target.js';

/** Thin Three integration over the renderer-neutral publication and resource engine. */
export class ThreeCommandBufferBinder implements GlyphCommandBufferBinder<ThreeBindings> {
  readonly #engine: GlyphCommandBufferBinder<ThreeBindings>;

  constructor(coordinator: ThreeTextEngineCoordinator, owner: ThreeTextEnginePlanOwner, config: ThreeGlyphConfig) {
    const rootContext: ThreeRootContext =
      owner.root ?? Object.freeze({ name: undefined, scene: undefined, drawRoot: owner.drawRoot });
    const root: ThreeRootBinding = Object.freeze({
      drawRoot: owner.drawRoot,
      resolveMaterial: (binding: BackendMaterialBinding) => {
        const selected = coordinator.resolveMaterial(binding);
        return Object.freeze({
          ...selected,
          material: selected.material ?? config.material,
          root: rootContext,
        });
      },
      resolveTransform: (binding: BackendTransformBinding, recordIndex: number) => {
        const source = coordinator.resolveTransform(binding);
        return owner.objectForTransform?.(recordIndex, source) ?? source;
      },
    });
    this.#engine = createEngine({ config, codec: coordinator.codec, root });
  }

  source(candidate: PlanCandidate, signal: AbortSignal): BorrowedTypedCommandBuffer {
    return this.#engine.source(candidate, signal);
  }

  decodeDefault(source: BorrowedTypedCommandBuffer): BorrowedBoundCommandBuffer<ThreeBindings> {
    return this.#engine.decodeDefault(source);
  }

  settle(
    source: BorrowedTypedCommandBuffer,
    frame: BorrowedBoundCommandBuffer<ThreeBindings> | undefined,
    accepted: boolean,
  ): void {
    this.#engine.settle(source, frame, accepted);
  }

  dispose(): void {
    this.#engine.dispose();
  }
}
