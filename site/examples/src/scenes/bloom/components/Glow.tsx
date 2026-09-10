import { useFrame, useRenderPipeline } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import type { UniformNode } from 'three/webgpu';

/** Bloom over the scene pass; its strength is a uniform, breathed per frame without rebuilding the pipeline. */
export function Glow() {
  const strength = useRef<UniformNode<'float', number> | null>(null);
  const elapsed = useRef(0);

  useRenderPipeline(({ passes, renderPipeline }) => {
    // Nullable on this r3f alpha: the callback also runs for the teardown pass.
    if (renderPipeline === null) return;
    const scene = passes.scenePass.getTextureNode();
    const glow = bloom(scene, 0.9, 0.4, 0.55);
    strength.current = glow.strength;
    renderPipeline.outputNode = scene.add(glow);
  });

  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (strength.current !== null) strength.current.value = 0.75 + Math.sin(elapsed.current * 1.4) * 0.45;
  });

  return null;
}
