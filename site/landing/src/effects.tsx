import { useFrame, useRenderPipeline } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/examples/jsm/tsl/display/ChromaticAberrationNode.js';
import { lensflare } from 'three/examples/jsm/tsl/display/LensflareNode.js';
import { float, vec3 } from 'three/tsl';

import { graphVersion, live } from './look';
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
  const { rebuild } = useRenderPipeline(({ passes, renderPipeline }) => {
    // Nullable on this r3f alpha: the callback also runs for the teardown pass,
    // where there is no pipeline left to write an output node onto.
    if (renderPipeline === null) return;

    const scene = passes.scenePass.getTextureNode();

    const bloomPass = bloom(scene, live.bloomStrength, live.bloomRadius, live.bloomThreshold);
    // The shipped declarations are narrower than the runtime here: BloomNode
    // does expose getTextureNode, and the flare parameters document
    // `Node | number` while the types demand `Node`.
    const bloomTexture = (
      bloomPass as unknown as { getTextureNode(): Parameters<typeof lensflare>[0] }
    ).getTextureNode();
    const flare = lensflare(bloomTexture, {
      ghostAttenuationFactor: live.flareAttenuation,
      ghostSamples: live.flareSamples,
      ghostSpacing: live.flareSpacing,
      ghostTint: vec3(0.72, 0.82, 1),
      threshold: live.flareThreshold,
    } as unknown as Parameters<typeof lensflare>[1]);

    const composite = scene.add(bloomPass).add(flare);
    // The node's `center` documents a null default that falls back to screen
    // centre, but this build dereferences it — pass one explicitly.
    renderPipeline.outputNode = chromaticAberration(composite, aberrationStrength, aberrationCentre, float(1.06));
  });

  // Pipeline parameters are compiled into the graph rather than read from
  // uniforms, so a change to any of them has to recompile it. Watching a version
  // counter in the frame loop keeps that off the React path entirely.
  const seen = useRef(graphVersion.value);
  useFrame(() => {
    if (seen.current === graphVersion.value) return;
    seen.current = graphVersion.value;
    rebuild();
  });

  return null;
}
