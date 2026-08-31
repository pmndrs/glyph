import { Text, useFont } from '@pmndrs/glyph/react';
import { useThree } from '@react-three/fiber/webgpu';

import type { GlyphSceneProps } from '../../explainer';
import { AnimatedGroup } from './animated-group';
import { MSDF_FONT } from './fonts';
import { paragraphTopFromCenter } from './scene-layout';
import { useSceneReady } from './use-scene-ready';

export function StylingScene({ onReady }: GlyphSceneProps) {
  const font = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  const fontSize = Math.min(viewport.width * 0.1, 1.2);
  useSceneReady(onReady);
  return (
    <AnimatedGroup speed={1.2} amount={0.05}>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={font}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, paragraphTopFromCenter(fontSize), 0]}
        style={{ fontSize }}
      >
        <Text style={{ color: '#f8fafc' }}>styled </Text>
        <Text style={{ color: '#22d3ee' }}>runs </Text>
        <Text style={{ color: '#f472b6' }}>inherit</Text>
      </Text>
    </AnimatedGroup>
  );
}
