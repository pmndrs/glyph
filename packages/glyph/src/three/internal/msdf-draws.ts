import type * as THREE from 'three/webgpu';

import type { TslMsdfEffects } from '../../shaders/tsl/index.js';
import { msdfSchema } from '../../raster/msdf.js';
import type { RetainedBuffer } from './host-buffer.js';
import type { MaterialRealization } from './render-state.js';
import type { RetainedMsdfAtlas } from './renderer-resources.js';

const atlasByMaterial = new WeakMap<THREE.Material, RetainedMsdfAtlas>();

/** Records which atlas every draw of `material` samples. */
export function registerMsdfAtlasUse(material: THREE.NodeMaterial, atlas: RetainedMsdfAtlas): void {
  atlasByMaterial.set(material, atlas);
}

/**
 * The materials one default MSDF draw can render with, one per combination of effects its instances use.
 *
 * Composing an outline and a shadow costs every fragment their interpolated inputs even when no glyph has either.
 * The draw therefore renders with the graph that composes exactly the effects present in its instance range, and
 * moves to another graph when an edit or a paint change adds or removes one.
 */
export interface MsdfEffectVariants {
  material(effects: TslMsdfEffects): THREE.NodeMaterial;
}

/**
 * What the publication pass reads for one MSDF draw. The lanes belong to the draw, not its material: a material
 * outlives the buffers it was built over, while a draw is rebuilt whenever its buffers are replaced.
 */
interface MsdfDrawState {
  readonly atlas: RetainedMsdfAtlas;
  /** The technique's effect lane; its fourth value is the instance's glyph table row. */
  readonly glyphs: RetainedBuffer;
  /** The packed `[outline, shadow]` color lane; an alpha byte of zero means the effect is absent. */
  readonly colors: RetainedBuffer;
  readonly variants: MsdfEffectVariants | undefined;
}

const variantsByComplete = new WeakMap<THREE.Material, MsdfEffectVariants>();

/**
 * Makes `complete` (the graph composing both effects) the owner of lazily built specializations. They are disposed
 * with it, so the publication's material lifetime rules keep covering every variant.
 */
export function registerMsdfEffectVariants(
  complete: THREE.NodeMaterial,
  create: (effects: TslMsdfEffects) => THREE.NodeMaterial,
): void {
  const specialized = new Map<number, THREE.NodeMaterial>();
  complete.addEventListener('dispose', () => {
    for (const material of specialized.values()) material.dispose();
    specialized.clear();
  });
  variantsByComplete.set(complete, {
    material(effects) {
      if (effects.outline && effects.shadow) return complete;
      const key = (effects.outline ? 1 : 0) | (effects.shadow ? 2 : 0);
      let material = specialized.get(key);
      if (material === undefined) {
        material = create(effects);
        specialized.set(key, material);
      }
      return material;
    },
  });
}

/** Remembers a new MSDF draw's lanes and materials; it may later render with a specialization of `material`. */
export function attachMsdfDrawState(
  mesh: THREE.Mesh,
  material: THREE.Material,
  lanes: ReadonlyMap<RetainedBuffer['codecBufferId'], RetainedBuffer>,
): void {
  const atlas = atlasByMaterial.get(material);
  const glyphs = lanes.get(msdfSchema.buffers.effect.id);
  const colors = lanes.get(msdfSchema.buffers.effectColor.id);
  if (atlas === undefined || glyphs === undefined || colors === undefined) return;
  const state: MsdfDrawState = { atlas, glyphs, colors, variants: variantsByComplete.get(material) };
  mesh.userData.pmndrsGlyphMsdf = state;
}

/**
 * Brings the renderer in line with what a publication just committed.
 *
 * Materials adopted by successor buffers are pointed at them. Then, for each MSDF draw whose lanes the publication
 * wrote (or every draw, when it replaced them), the atlas cells of the glyphs it draws are made resident before the
 * frame that first shows them, and the draw renders with the graph for the effects in its range.
 */
export function syncMsdfDraws(
  draws: readonly THREE.Mesh[],
  publication: Readonly<{
    context: { readonly materials: ReadonlyMap<string, MaterialRealization> };
    draws: { readonly changed: boolean };
    bufferMutations: { readonly uploads: readonly { readonly buffer: RetainedBuffer }[] };
  }>,
): void {
  for (const realization of publication.context.materials.values()) bindSuccessorStorage(realization);
  const uploads = publication.bufferMutations.uploads;
  if (!publication.draws.changed && uploads.length === 0) return;
  const written = publication.draws.changed ? undefined : new Set(uploads.map(({ buffer }) => buffer));
  for (const mesh of draws) {
    const state = mesh.userData.pmndrsGlyphMsdf as MsdfDrawState | undefined;
    if (state === undefined) continue;
    const start = (mesh.userData.pmndrsGlyphRunStart as number | undefined) ?? 0;
    const end = start + (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
    if (written === undefined || written.has(state.glyphs)) {
      state.atlas.use(state.glyphs.array as Float32Array, start, end, state.glyphs.vectorWidth);
    }
    if (state.variants !== undefined && (written === undefined || written.has(state.colors))) {
      mesh.material = state.variants.material(effectsInUse(state.colors, start, end));
    }
  }
}

function bindSuccessorStorage(realization: MaterialRealization): void {
  if (realization.pendingStorage === undefined) return;
  for (const [node, attribute] of realization.pendingStorage) node.value = attribute;
  delete realization.pendingStorage;
}

function effectsInUse(lane: RetainedBuffer, start: number, end: number): TslMsdfEffects {
  const colors = lane.array;
  const width = lane.vectorWidth;
  let outline = 0;
  let shadow = 0;
  for (let offset = start * width; offset < end * width; offset += width) {
    outline |= colors[offset]! >>> 24;
    shadow |= colors[offset + 1]! >>> 24;
  }
  return { outline: outline !== 0, shadow: shadow !== 0 };
}
