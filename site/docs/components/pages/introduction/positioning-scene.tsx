import { Text, useFont } from '@pmndrs/glyph/react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { Group } from 'three';

import type { GlyphSceneProps } from '../../explainer';
import { MSDF_FONT } from './fonts';
import { paragraphTopFromCenter } from './scene-layout';
import { useSceneReady } from './use-scene-ready';

export function PositioningScene({ onReady }: GlyphSceneProps) {
  const font = useFont(MSDF_FONT.src, { format: MSDF_FONT.format });
  const viewport = useThree((state) => state.viewport);
  const fontSize = Math.min(viewport.width * 0.07, 0.8);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) group.current.rotation.y = Math.sin(elapsed.current * 0.8) * 0.1;
  });
  useSceneReady(onReady);
  return (
    <group ref={group}>
      {(['x', 'y', 'z'] as const).map((axis, index) => (
        <Text
          key={axis}
          font={font}
          position={[
            -viewport.width * 0.33 + index * viewport.width * 0.27,
            paragraphTopFromCenter(fontSize, 0.45 - index * 0.45),
            0.1 * index,
          ]}
          style={{ color: ['#34d399', '#60a5fa', '#fbbf24'][index]!, fontSize }}
        >
          {axis}
        </Text>
      ))}
    </group>
  );
}
