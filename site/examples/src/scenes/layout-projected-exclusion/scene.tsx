import type { msdf, TextFlowExclusion } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { projectTextFlowBounds, type Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import { Box3, Vector3, type Mesh } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Outline } from '../layout-kit/kit';
import { FLOW_PROSE } from '../layout-kit/prose';

/**
 * A cube floating in front of a paragraph. Each frame its bounding box is
 * projected through the camera onto the text plane, and the result is an
 * ordinary exclusion. The text wraps around what the camera sees of the
 * cube, so the cube never covers a word. `wrapSide: 'largest'` keeps each
 * cut line on the wider side of the cube.
 */
export const REGION = [0, 0, 8.4, 3.9] as const;
export const SIZE = 0.9;
export const BOUNDS = new Box3(new Vector3(-SIZE / 2, -SIZE / 2, -SIZE / 2), new Vector3(SIZE / 2, SIZE / 2, SIZE / 2));

export default function LayoutProjectedExclusion() {
  const inter = useMsdf(INTER);
  const text = useRef<ThreeText<typeof msdf>>(null);
  const cube = useRef<Mesh>(null);
  const [exclusion, setExclusion] = useState<TextFlowExclusion | undefined>(undefined);

  useFrame(({ camera, elapsed }) => {
    if (text.current === null || cube.current === null) return;
    cube.current.position.set(Math.sin(elapsed * 0.4) * 2.6, 0.35 + Math.sin(elapsed * 0.63) * 1.0, 1.6);
    cube.current.rotation.set(elapsed * 0.5, elapsed * 0.35, 0);
    setExclusion(
      projectTextFlowBounds({
        key: 'cube',
        camera,
        text: text.current,
        object: cube.current,
        bounds: BOUNDS,
        flowBounds: REGION,
        marginInline: 0.12,
        wrapSide: 'largest',
      }),
    );
  });

  return (
    <>
      <mesh ref={cube}>
        <boxGeometry args={[SIZE, SIZE, SIZE]} />
        <meshStandardNodeMaterial color={ACCENT} roughness={0.45} />
      </mesh>
      <group position={[-REGION[2] / 2, REGION[3] / 2, 0]}>
        <Outline box={[REGION[0], REGION[1], REGION[2], REGION[3]]} />
        <Text
          ref={text}
          font={inter}
          style={{ fontSize: 0.2, lineHeight: 1.35, color: PAPER }}
          flow={{
            regions: [
              {
                key: 'page',
                shape: { kind: 'rectangle', bounds: REGION },
                exclusions: exclusion === undefined ? [] : [exclusion],
              },
            ],
          }}
        >
          {FLOW_PROSE}
        </Text>
      </group>
    </>
  );
}
