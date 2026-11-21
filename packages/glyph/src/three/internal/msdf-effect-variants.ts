import type * as THREE from 'three/webgpu';

import type { TslMsdfEffects } from '../../shaders/tsl/index.js';
import type { RetainedBuffer } from './host-buffer.js';

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

/** Remembers a new draw's variants; the mesh may later render with a specialization instead of `material`. */
export function attachMsdfEffectVariants(mesh: THREE.Mesh, material: THREE.Material): void {
  const variants = variantsByComplete.get(material);
  if (variants !== undefined) mesh.userData.pmndrsGlyphEffectVariants = variants;
}

/**
 * Points each draw at the graph for the effects in its current instance range, after the publication's buffer writes
 * have landed. A publication that kept its draws only revisits those whose color lane it wrote.
 */
export function selectMsdfEffectVariants(
  draws: readonly THREE.Mesh[],
  publication: Readonly<{
    draws: { readonly changed: boolean };
    bufferMutations: { readonly uploads: readonly { readonly buffer: RetainedBuffer }[] };
  }>,
): void {
  const uploads = publication.bufferMutations.uploads;
  if (!publication.draws.changed && uploads.length === 0) return;
  const written = publication.draws.changed ? undefined : new Set(uploads.map(({ buffer }) => buffer));
  for (const mesh of draws) selectMsdfEffectVariant(mesh, written);
}

function selectMsdfEffectVariant(mesh: THREE.Mesh, changed: ReadonlySet<RetainedBuffer> | undefined): void {
  const variants = mesh.userData.pmndrsGlyphEffectVariants as MsdfEffectVariants | undefined;
  if (variants === undefined || (changed !== undefined && !changed.has(variants.colors))) return;
  const colors = variants.colors.array;
  const width = variants.colors.vectorWidth;
  const start = ((mesh.userData.pmndrsGlyphRunStart as number | undefined) ?? 0) * width;
  const end = start + (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount * width;
  let outline = 0;
  let shadow = 0;
  for (let offset = start; offset < end; offset += width) {
    outline |= colors[offset]! >>> 24;
    shadow |= colors[offset + 1]! >>> 24;
  }
  mesh.material = variants.material({ outline: outline !== 0, shadow: shadow !== 0 });
}
