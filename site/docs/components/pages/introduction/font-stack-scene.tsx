import { createFontStack } from '@pmndrs/glyph';
import { Text, useFont } from '@pmndrs/glyph/react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useMemo, useRef } from 'react';
import { Group } from 'three';

import type { GlyphSceneProps } from '../../explainer';
import { CJK_FONT, MSDF_FONT } from './fonts';
import { paragraphTopFromCenter } from './scene-layout';
import { useSceneReady } from './use-scene-ready';

export function FontStackScene({ onReady }: GlyphSceneProps) {
  const latin = useFont(MSDF_FONT.src, { format: MSDF_FONT.format });
  const cjk = useFont(CJK_FONT.src, { format: CJK_FONT.format });
  const stack = useMemo(() => createFontStack(latin, cjk), [cjk, latin]);
  const viewport = useThree((state) => state.viewport);
  const fontSize = Math.min(viewport.width * 0.075, 0.9);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) group.current.scale.setScalar(1 + Math.sin(elapsed.current * 1.1) * 0.02);
  });
  useSceneReady(onReady);
  return (
    <group ref={group}>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={stack}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, paragraphTopFromCenter(fontSize), 0]}
        style={{ color: '#c4b5fd', fontSize }}
      >
        glyph 文字 字形
      </Text>
    </group>
  );
}
