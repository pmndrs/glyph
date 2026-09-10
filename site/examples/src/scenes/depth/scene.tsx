import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import type { Mesh } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * The default material draws over everything — `depthTest: false` — so a
 * label is never lost behind the model it annotates. Turn the test on and the
 * text is a surface in the scene: geometry in front of it hides it. A ball
 * slides across both words at one depth, in front of the text plane: it hides
 * the occluded word and passes under the overlaid one. `depthWrite` stays off
 * either way; a glyph quad is transparent outside its ink and would punch a
 * rectangle into whatever it covers.
 */
const inScene = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  material.depthTest = true;
  return material;
});

const BALL_RADIUS = 0.9;
/** The whole ball stays in front of the text plane at z = 0. */
const BALL_Z = BALL_RADIUS + 0.25;
/** Level with the words' middle. */
const BALL_Y = 0.05;
/** Far enough to clear both words. */
const BALL_SWING = 3.9;

export default function Depth() {
  const inter = useMsdf(INTER);
  const ball = useRef<Mesh>(null);

  useFrame(({ elapsed }) => {
    // One axis: the ball slides across both words at a fixed depth just in
    // front of the text plane, so it never intersects the text. The occluded
    // word hides behind it; the overlaid word draws over it.
    ball.current?.position.set(Math.sin(elapsed * 0.6) * BALL_SWING, BALL_Y, BALL_Z);
  });

  return (
    <>
      <mesh ref={ball} position={[0, BALL_Y, BALL_Z]}>
        <sphereGeometry args={[BALL_RADIUS, 48, 32]} />
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
