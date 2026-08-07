import * as THREE from 'three/webgpu';

import type {
  GlyphBatchKey,
  ParagraphId,
  PreparedGlyphBatch,
  PreparedParagraphBatchRevision,
} from '../paragraph-batch.js';
import type { ParagraphBatchTargetRevision } from '../paragraph-batch-attachment.js';
import type { AnyRasterTechnique } from '../raster-technique.js';

export interface RetainedThreeTargetResource<Technique extends AnyRasterTechnique> {
  readonly key: GlyphBatchKey;
  readonly capacity: number;
  update(batch: PreparedGlyphBatch<Technique>): void;
  dispose(): void;
}

export interface RetainedThreeRunIdentity {
  readonly paragraph: ParagraphId;
  readonly batch: GlyphBatchKey;
}

export interface TransferredThreeTargetState<
  Technique extends AnyRasterTechnique,
  Resource extends RetainedThreeTargetResource<Technique>,
> {
  readonly draws: readonly THREE.Mesh[];
  readonly resources: ReadonlyMap<GlyphBatchKey, Resource>;
  readonly runIdentities: readonly RetainedThreeRunIdentity[];
}

export class RetainedThreeTargetRevision<
  Technique extends AnyRasterTechnique,
  Resource extends RetainedThreeTargetResource<Technique>,
> implements ParagraphBatchTargetRevision {
  readonly sourceRevision: number;
  readonly draws: readonly THREE.Mesh[];
  readonly #resources: ReadonlyMap<GlyphBatchKey, Resource>;
  readonly #runIdentities: readonly RetainedThreeRunIdentity[];
  #transferred = false;
  #disposed = false;

  constructor(
    sourceRevision: number,
    draws: readonly THREE.Mesh[],
    resources: ReadonlyMap<GlyphBatchKey, Resource>,
    runIdentities: readonly RetainedThreeRunIdentity[],
  ) {
    this.sourceRevision = sourceRevision;
    this.draws = draws;
    this.#resources = resources;
    this.#runIdentities = runIdentities;
  }

  setRenderOrderBase(base: number): void {
    for (let index = 0; index < this.draws.length; index += 1) this.draws[index]!.renderOrder = base + index;
  }

  canReuse<Variant>(next: PreparedParagraphBatchRevision<Technique, Variant>): boolean {
    if (this.#disposed || this.#transferred || next.glyphBatches.length !== this.#resources.size) return false;
    for (const batch of next.glyphBatches) {
      const resource = this.#resources.get(batch.key);
      if (resource === undefined || resource.capacity !== batch.capacity) return false;
    }
    if (next.glyphRuns.length !== this.#runIdentities.length) return false;
    return next.glyphRuns.every((run, index) => {
      const identity = this.#runIdentities[index];
      return identity?.paragraph === run.paragraph && identity.batch === run.batch;
    });
  }

  transfer<Variant>(
    next: PreparedParagraphBatchRevision<Technique, Variant>,
    renderOrderBase: number,
  ): TransferredThreeTargetState<Technique, Resource> {
    if (!this.canReuse(next)) throw new Error('Three target revision is not compatible for reuse');
    for (const batch of next.glyphBatches) this.#resources.get(batch.key)!.update(batch);
    for (let index = 0; index < next.glyphRuns.length; index += 1) {
      const run = next.glyphRuns[index]!;
      const draw = this.draws[index]!;
      draw.userData.pmndrsTextRunStart = run.start;
      (draw.geometry as THREE.InstancedBufferGeometry).instanceCount = run.count;
      draw.renderOrder = renderOrderBase + index;
    }
    this.#transferred = true;
    return { draws: this.draws, resources: this.#resources, runIdentities: this.#runIdentities };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#transferred) return;
    for (const draw of this.draws) {
      draw.removeFromParent();
      draw.geometry.dispose();
    }
    for (const resource of this.#resources.values()) resource.dispose();
  }
}

export function retainedRunIdentities<Technique extends AnyRasterTechnique, Variant>(
  revision: PreparedParagraphBatchRevision<Technique, Variant>,
): readonly RetainedThreeRunIdentity[] {
  return revision.glyphRuns.map((run) => ({ paragraph: run.paragraph, batch: run.batch }));
}

export function invalidatePboTexture(attribute: THREE.StorageInstancedBufferAttribute): void {
  const pbo = (attribute as THREE.StorageInstancedBufferAttribute & { pbo?: THREE.DataTexture }).pbo;
  if (pbo !== undefined) pbo.needsUpdate = true;
}
