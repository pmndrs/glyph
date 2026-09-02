import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import type { Mesh } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../stage';

/**
 * The default material draws over everything — `depthTest: false` — so a
 * label is never lost behind the model it annotates. Turn the test on and the
 * text is a surface in the scene: geometry in front of it hides it, geometry
 * behind it does not. `depthWrite` stays off either way; a glyph quad is
 * transparent outside its ink and would punch a rectangle into whatever it
 * covers.
 */
const inScene = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  material.depthTest = true;
  return material;
});

export default function Depth() {
  const inter = useMsdf(INTER);
  const ball = useRef<Mesh>(null);
  const elapsed = useRef(0);

  useFrame((_state, delta) => {
    elapsed.current += delta;
    const t = elapsed.current * 0.6;
    // An ellipse through both words: in front of them for half a turn, behind for the other half.
    ball.current?.position.set(Math.sin(t) * 3.4, 0.15, Math.cos(t) * 1.4);
  });

  return (
    <>
      <mesh ref={ball}>
        <sphereGeometry args={[0.9, 48, 32]} />
        <meshStandardNodeMaterial color={ACCENT} metalness={0.1} roughness={0.35} />
      </mesh>
      <Text
        font={inter}
        material={inScene}
        style={{ fontSize: 1.05, color: PAPER }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 5 } }}
        position={[-5.25, 0.55, 0]}
      >
        occluded
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 1.05, color: PAPER }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 5 } }}
        position={[0.25, 0.55, 0]}
      >
        overlaid
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.26, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 5 } }}
        position={[-5.25, -0.95, 0]}
      >
        depthTest: true
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.26, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 5 } }}
        position={[0.25, -0.95, 0]}
      >
        the default
      </Text>
    </>
  );
}
