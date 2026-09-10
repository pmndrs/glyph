import { useSlug } from '@pmndrs/glyph/react/slug';
import { useFrame } from '@react-three/fiber/webgpu';
import { useMemo, useRef } from 'react';
import { type Group, Vector3 } from 'three/webgpu';

import { TextOnPath } from '../../components/text';
import { INTER } from '../../fonts';
import { bandGeometry } from '../../lib/band';
import { curvePath } from '../../lib/paths';
import { CURVE, LINE, REPEATS, RIBBON } from './config';
import { ribbonInk, ribbonMaterial } from './materials';

/**
 * Words printed on a ribbon that runs through the frame. The ribbon is a
 * flat band built on an open curve whose normal faces the camera; the same
 * curve is the path the glyphs are placed on, laid across the band's width,
 * so the type lies on the ribbon and turns with it. The type is depth-tested
 * and lifted a little off the band toward the viewer, so the band never
 * bleeds through it.
 */
const FACING = new Vector3(0, 0, 1);

export default function Ribbon() {
  const inter = useSlug(INTER);
  const path = useMemo(() => curvePath(CURVE, FACING), []);
  const geometry = useMemo(() => bandGeometry(path, RIBBON.width, 480, false), [path]);
  const material = useMemo(() => ribbonMaterial(), []);
  const sway = useRef<Group>(null);

  useFrame(({ elapsed }) => {
    if (sway.current !== null) sway.current.rotation.y = Math.sin(elapsed * 0.3) * RIBBON.sway;
  });

  return (
    <group ref={sway}>
      <mesh geometry={geometry} material={material} />
      <TextOnPath
        font={inter}
        path={path}
        speed={RIBBON.speed}
        angle={-Math.PI / 2}
        height={-RIBBON.size * 0.36}
        lift={0.03}
        size={RIBBON.size}
        letterSpacing={RIBBON.letterSpacing}
        material={ribbonInk}
      >
        {LINE.repeat(REPEATS)}
      </TextOnPath>
    </group>
  );
}
