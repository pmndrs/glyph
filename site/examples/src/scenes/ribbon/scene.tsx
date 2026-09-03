import { useSlug } from '@pmndrs/glyph/react/slug';
import { useMemo } from 'react';
import { TubeGeometry } from 'three/webgpu';

import { TextOnPath } from '../../components/text';
import { INTER } from '../../fonts';
import { curvePath } from '../../lib/paths';
import { CURVE, LINE, RIBBON } from './config';
import { ribbonInk, ribbonMaterial } from './materials';

/**
 * Words flowing along a ribbon through the scene. The ribbon is a tube on a
 * closed curve; the same curve is the path the glyphs are placed on, so they
 * ride its surface, standing on it and turning with it, upright the whole
 * way round. The type is depth-tested, so the ribbon hides the words that
 * pass behind it.
 */
export default function Ribbon() {
  const inter = useSlug(INTER);
  const path = useMemo(() => curvePath(CURVE), []);
  const geometry = useMemo(() => new TubeGeometry(CURVE, 480, RIBBON.radius, 14, true), []);
  const material = useMemo(() => ribbonMaterial(), []);

  return (
    <group rotation={[0.22, 0, 0.06]}>
      <mesh geometry={geometry} material={material} />
      <TextOnPath
        font={inter}
        path={path}
        speed={RIBBON.speed}
        height={RIBBON.radius + 0.02}
        size={RIBBON.size}
        letterSpacing={RIBBON.letterSpacing}
        material={ribbonInk}
      >
        {LINE.repeat(3)}
      </TextOnPath>
    </group>
  );
}
