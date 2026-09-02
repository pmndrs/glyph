import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useFrame, useRenderPipeline } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import type { UniformNode } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * Post-processing sees text as pixels in the scene pass, nothing more. Bloom
 * thresholds on brightness, so the dim words stay put while the bright one
 * blooms; its strength is a uniform, animated without rebuilding the pipeline.
 */
const DIM = '#4b5568';
const BRIGHT = '#fff3c4';

export default function Bloom() {
  const inter = useMsdf(INTER);

  return (
    <>
      <Glow />
      <Text
        font={inter}
        style={{ fontSize: 1.1, color: DIM }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 10 } }}
        position={[-5, 0.75, 0]}
      >
        words that <Text style={{ color: BRIGHT }}>shine</Text>
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.26, color: DIM, letterSpacing: 0.02 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 10 } }}
        position={[-5, -0.7, 0]}
      >
        bloom threshold 0.55
      </Text>
    </>
  );
}

function Glow() {
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
