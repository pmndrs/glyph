import type * as THREE from 'three/webgpu';

import type { ParagraphBatchTarget, ParagraphBatchTargetRevision } from '../paragraph-batch-attachment.js';
import type { ParagraphId } from '../paragraph-batch.js';
import type { AnyRasterTechnique, RasterTechniqueId } from '../raster-technique.js';

/**
 * The scene-side state a Three raster program needs to place its draws. Every first-party target and every third-party
 * program receives exactly this view; a program never reaches the owning `Text` or `TextGroup`.
 */
export interface ThreeRasterTargetOwner {
  objectForParagraph(paragraph: ParagraphId): THREE.Object3D;
  readonly renderOrderBase: number;
}

/**
 * Optional GPU accounting a Three target may report: the bytes of the engine resources it currently retains. Only the
 * target knows its realized allocation, so a portable technique never reports one; a third-party program may omit it.
 */
export interface ThreeRasterTargetAccounting {
  readonly gpuBytes?: number;
}

/**
 * Builds the Three target that realizes one technique's prepared glyph batches as engine resources and draws. Core
 * owns partitioning, packing, and ordering; a program owns shaders, pipelines, and final draw compilation.
 */
export type ThreeRasterProgram<Technique extends AnyRasterTechnique = AnyRasterTechnique> = (
  owner: ThreeRasterTargetOwner,
) => ParagraphBatchTarget<Technique, never, ParagraphBatchTargetRevision> & ThreeRasterTargetAccounting;

const programs = new Map<RasterTechniqueId, ThreeRasterProgram>();

/**
 * Registers the Three program for a raster technique, keyed by the technique's stable identifier rather than its object
 * identity. Identifier keying lets an application wrap a technique — to instrument its runtime baker, for example —
 * without losing the ability to render it.
 *
 * The technique is inferred, so a program may type its prepared batches, storage, and binding concretely; the registry
 * itself is heterogeneous and holds the erased form, having already proven the pairing at this call.
 */
export function registerThreeRasterProgram<Technique extends AnyRasterTechnique>(
  technique: Technique,
  program: ThreeRasterProgram<Technique>,
): void {
  const erased = program as ThreeRasterProgram;
  const existing = programs.get(technique.id);
  if (existing !== undefined && existing !== erased) {
    throw new TypeError(`a different Three raster program is already registered for "${technique.id}"`);
  }
  programs.set(technique.id, erased);
}

/** Resolves the registered Three program for a technique, or `undefined` when no program has been registered. */
export function threeRasterProgram(technique: AnyRasterTechnique): ThreeRasterProgram | undefined {
  return programs.get(technique.id);
}
