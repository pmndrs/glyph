import type * as THREE from 'three/webgpu';

import type { TslMsdfEffects } from '../../shaders/tsl/index.js';
import type { RetainedBuffer } from './host-buffer.js';
import type { RetainedMsdfAtlas } from './renderer-resources.js';

/** What the publication pass needs to keep one MSDF draw's atlas cells resident. */
interface MsdfAtlasUse {
  readonly atlas: RetainedMsdfAtlas;
  /** The technique's effect lane; its fourth value is the instance's glyph table row. */
  readonly glyphs: RetainedBuffer;
}

const atlasUseByMaterial = new WeakMap<THREE.Material, MsdfAtlasUse>();

/** Records which atlas and glyph lane every draw of `material` reads. */
export function registerMsdfAtlasUse(
  material: THREE.NodeMaterial,
  atlas: RetainedMsdfAtlas,
  glyphs: RetainedBuffer,
): void {
  atlasUseByMaterial.set(material, { atlas, glyphs });
}

/**
 * The materials one default MSDF draw can render with, one per combination of effects its instances use.
 *
 * Composing an outline and a shadow costs every fragment their interpolated inputs even when no glyph has either.
 * The draw therefore renders with the graph that composes exactly the effects present in its instance range, and
 * moves to another graph when an edit or a paint change adds or removes one.
 */
export interface MsdfEffectVariants {
  /** The technique's packed `[outline, shadow]` color lane; an alpha byte of zero means the effect is absent. */
  readonly colors: RetainedBuffer;
  material(effects: TslMsdfEffects): THREE.NodeMaterial;
}

const variantsByComplete = new WeakMap<THREE.Material, MsdfEffectVariants>();

/**
 * Makes `complete` (the graph composing both effects) the owner of lazily built specializations. They are disposed
 * with it, so the publication's material lifetime rules keep covering every variant.
 */
export function registerMsdfEffectVariants(
  complete: THREE.NodeMaterial,
  colors: RetainedBuffer,
  create: (effects: TslMsdfEffects) => THREE.NodeMaterial,
): void {
  const specialized = new Map<number, THREE.NodeMaterial>();
  complete.addEventListener('dispose', () => {
    for (const material of specialized.values()) material.dispose();
    specialized.clear();
  });
  variantsByComplete.set(complete, {
    colors,
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

/** Remembers a new draw's MSDF state; the mesh may later render with a specialization instead of `material`. */
export function attachMsdfDrawState(mesh: THREE.Mesh, material: THREE.Material): void {
  const variants = variantsByComplete.get(material);
  if (variants !== undefined) mesh.userData.pmndrsGlyphEffectVariants = variants;
  const atlasUse = atlasUseByMaterial.get(material);
  if (atlasUse !== undefined) mesh.userData.pmndrsGlyphAtlasUse = atlasUse;
}

/**
 * Brings each MSDF draw in line with the instances a publication just wrote: the atlas cells of every glyph it draws
 * are resident before the frame that first shows them, and it renders with the graph for the effects in its range.
 * A publication that kept its draws only revisits those whose lanes it wrote.
 */
export function syncMsdfDraws(
  draws: readonly THREE.Mesh[],
  publication: Readonly<{
    draws: { readonly changed: boolean };
    bufferMutations: { readonly uploads: readonly { readonly buffer: RetainedBuffer }[] };
  }>,
): void {
  const uploads = publication.bufferMutations.uploads;
  if (!publication.draws.changed && uploads.length === 0) return;
  const written = publication.draws.changed ? undefined : new Set(uploads.map(({ buffer }) => buffer));
  for (const mesh of draws) {
    const start = (mesh.userData.pmndrsGlyphRunStart as number | undefined) ?? 0;
    const end = start + (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
    const atlasUse = mesh.userData.pmndrsGlyphAtlasUse as MsdfAtlasUse | undefined;
    if (atlasUse !== undefined && (written === undefined || written.has(atlasUse.glyphs))) {
      atlasUse.atlas.use(atlasUse.glyphs.array as Float32Array, start, end, atlasUse.glyphs.vectorWidth);
    }
    const variants = mesh.userData.pmndrsGlyphEffectVariants as MsdfEffectVariants | undefined;
    if (variants !== undefined && (written === undefined || written.has(variants.colors))) {
      mesh.material = variants.material(effectsInUse(variants.colors, start, end));
    }
  }
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
