import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/examples/jsm/tsl/display/ChromaticAberrationNode.js';
import { lensflare } from 'three/examples/jsm/tsl/display/LensflareNode.js';
import { float, vec3 } from 'three/tsl';

import { useLook } from './controls';
import { aberrationCentre, aberrationStrength } from './lens';

/**
 * Bloom feeds the flare, not the other way round: `lensflare` takes the bloom
 * texture as its input, so the ghosts are drawn from whatever bloom judged
 * bright. That only works when the mark sits mostly *below* the threshold and
 * the specular glint is the one thing above it — a uniformly bright mark blooms
 * everywhere and produces haze rather than flare.
 *
 * Aberration goes last, over the composite, so the fringing lands on the flare
 * and the letter edges alike and reads as the lens rather than as an effect
 * applied to the type.
 */
export function Effects() {
  const look = useLook();

  const { rebuild } = useRenderPipeline(({ passes, renderPipeline }) => {
    const scene = passes.scenePass.getTextureNode();

    const bloomPass = bloom(scene, look.bloomStrength, look.bloomRadius, look.bloomThreshold);
    // The shipped declarations are narrower than the runtime here: BloomNode
    // does expose getTextureNode, and the flare parameters document
    // `Node | number` while the types demand `Node`.
    const bloomTexture = (
      bloomPass as unknown as { getTextureNode(): Parameters<typeof lensflare>[0] }
    ).getTextureNode();
    const flare = lensflare(bloomTexture, {
      ghostAttenuationFactor: look.flareAttenuation,
      ghostSamples: look.flareSamples,
      ghostSpacing: look.flareSpacing,
      ghostTint: vec3(0.72, 0.82, 1),
      threshold: look.flareThreshold,
    } as unknown as Parameters<typeof lensflare>[1]);

    const composite = scene.add(bloomPass).add(flare);
    // The node's `center` documents a null default that falls back to screen
    // centre, but this build dereferences it — pass one explicitly.
    renderPipeline.outputNode = chromaticAberration(composite, aberrationStrength, aberrationCentre, float(1.06));
  });

  // Pipeline parameters are baked into the compiled graph rather than read from
  // uniforms, so a change to any of them has to recompile it.
  useEffect(() => {
    rebuild();
  }, [
    rebuild,
    look.bloomRadius,
    look.bloomStrength,
    look.bloomThreshold,
    look.flareAttenuation,
    look.flareSamples,
    look.flareSpacing,
    look.flareThreshold,
  ]);

  return null;
}
