import { Text, useFont } from '@pmndrs/glyph/react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import { Group } from 'three';

import type { GlyphSceneProps } from '../../explainer';
import { SLUG_FONT } from './fonts';
import { paragraphTopFromCenter } from './scene-layout';
import { useSceneReady } from './use-scene-ready';

export function WordScene({ inputs, onReady, scene }: GlyphSceneProps) {
  const font = useFont(SLUG_FONT.input, SLUG_FONT.raster.technique);
  const viewport = useThree((state) => state.viewport);
  const mark = useRef<Group>(null);
  const elapsed = useRef(0);
  const [pressed, setPressed] = useState(false);
  const word = scene === 'shaping' ? 'glÿph' : 'glyph';
  const fontSize = Math.min(viewport.width * 0.2, viewport.height * 0.35);
  useFrame((_state, delta) => {
    for (const input of inputs.drain()) if (input.type === 'pointerdown') setPressed((value) => !value);
    elapsed.current += delta;
    if (mark.current) mark.current.rotation.z = Math.sin(elapsed.current * 1.2) * 0.025;
  });
  useSceneReady(onReady);
  return (
    <group ref={mark}>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={font}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, paragraphTopFromCenter(fontSize), 0]}
        style={{
          color: pressed ? '#fb7185' : '#7dd3fc',
          fontSize,
        }}
      >
        {word}
      </Text>
    </group>
  );
}
