import { Text, useFont } from '@pmndrs/glyph/react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { Group } from 'three';

import type { GlyphSceneProps } from '../../explainer';
import { BITMAP_FONT } from './fonts';
import { paragraphTopFromCenter } from './scene-layout';
import { useBitmapTextScale } from './use-bitmap-text-scale';
import { useSceneReady } from './use-scene-ready';

export function ColumnsScene({ onReady }: GlyphSceneProps) {
  const font = useFont(BITMAP_FONT.src, { format: BITMAP_FONT.format });
  const viewport = useThree((state) => state.viewport);
  const bitmapScale = useBitmapTextScale(16);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  const paragraphHeight = viewport.height * 0.3;
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) group.current.position.x = Math.sin(elapsed.current * 0.9) * 0.05;
  });
  useSceneReady(onReady);
  return (
    <group ref={group}>
      <Text
        constraints={{
          height: { mode: 'exact', size: paragraphHeight },
          width: { mode: 'exact', size: viewport.width * 0.78 },
        }}
        font={font}
        layout={{ align: 'start', columns: { count: 2, gap: 0.35 }, overflow: 'clip', wrap: 'word' }}
        position={[-viewport.width * 0.39, paragraphTopFromCenter(paragraphHeight), 0]}
        rasterPixelRatio={bitmapScale.rasterPixelRatio}
        style={{ color: '#fde68a', fontSize: bitmapScale.fontSize, lineHeight: 1.25 }}
      >
        Two columns are one paragraph. The layout engine flows lines through the first column, then continues into the
        second while preserving the same shaping and style rules.
      </Text>
    </group>
  );
}
