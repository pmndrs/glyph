import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { useFrame } from '@react-three/fiber/webgpu';

import { INTER } from '../../fonts';
import { BANDS, FONT_SIZE, GLYPH, SWEEP } from './config';
import { CAPTION, anatomyInk, sweep } from './materials';

/**
 * One Slug glyph, large, with its anatomy drawn over it: the sixteen-by-
 * sixteen bands the outline is sorted into, the two bands a pixel walks,
 * and the analytic edge. Nothing here is a texture; the material only reads
 * what the technique computes.
 */
export default function SlugAnatomy() {
  const slugInter = useSlug(INTER);
  const inter = useMsdf(INTER);

  useFrame(({ elapsed }) => {
    sweep.value = Math.floor(elapsed / SWEEP) % BANDS;
  });

  return (
    <>
      <Text
        font={slugInter}
        material={anatomyInk}
        style={{ fontSize: FONT_SIZE, color: '#e7ecf6' }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 8 } }}
        position={[-4, 3.1, 0]}
      >
        {GLYPH}
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.26, color: CAPTION, letterSpacing: 0.04 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 10 } }}
        position={[-5, -3.05, 0]}
      >
        16 by 16 bands, the two a pixel walks, and the analytic edge
      </Text>
    </>
  );
}
