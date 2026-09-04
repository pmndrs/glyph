import { Text, useFont } from '@pmndrs/glyph/react';
import { useThree } from '@react-three/fiber/webgpu';

import type { GlyphSceneProps } from '../../explainer';
import { AnimatedGroup } from './animated-group';
import { BITMAP_FONT, MSDF_FONT, SLUG_FONT } from './fonts';
import { paragraphTopFromCenter } from './scene-layout';
import { useBitmapTextScale } from './use-bitmap-text-scale';
import { useSceneReady } from './use-scene-ready';

export function TechniqueScene({ onReady }: GlyphSceneProps) {
  const slugFont = useFont(SLUG_FONT.src, { format: SLUG_FONT.format });
  const msdfFont = useFont(MSDF_FONT.src, { format: MSDF_FONT.format });
  const bitmapFont = useFont(BITMAP_FONT.src, { format: BITMAP_FONT.format });
  const viewport = useThree((state) => state.viewport);
  const bitmapScale = useBitmapTextScale(16);
  const titleSize = Math.min(viewport.width * 0.16, 2.2);
  const subtitleSize = Math.min(viewport.width * 0.075, 0.9);
  useSceneReady(onReady);
  return (
    <AnimatedGroup speed={0.8} amount={0.035}>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={slugFont}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, paragraphTopFromCenter(titleSize, 0.72), 0]}
        style={{ color: '#f0abfc', fontSize: titleSize }}
      >
        Lovers + Quarrel
      </Text>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={msdfFont}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, paragraphTopFromCenter(subtitleSize), 0]}
        style={{ color: '#7dd3fc', fontSize: subtitleSize }}
      >
        Geist MSDF subtitle
      </Text>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={bitmapFont}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, paragraphTopFromCenter(bitmapScale.fontSize, -0.62), 0]}
        rasterPixelRatio={bitmapScale.rasterPixelRatio}
        style={{ color: '#fbbf24', fontSize: bitmapScale.fontSize }}
      >
        VT323 bitmap prose keeps the pixels honest.
      </Text>
    </AnimatedGroup>
  );
}
