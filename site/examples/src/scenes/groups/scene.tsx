import { glyph } from '@pmndrs/glyph';
import { GlyphProvider } from '@pmndrs/glyph/react';
import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { ThreeConfig, type TextGroup as ThreeTextGroup } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { use, useRef, useState } from 'react';

import { COUNT, Ring } from './components/Ring';

import { INTER } from '../../fonts';
import { plannedDraws } from '../../lib/planned-draws';
import { PAPER_DIM } from '../../theme';

/**
 * Many labels in one `TextGroup` on a named root. The group is a scene parent
 * — it moves and hides its children as one — and it is also the batching
 * boundary: one font, one material, forty-eight labels, one draw. The root is
 * named so the count in the centre is the ring's alone; the caption lives on
 * the default root.
 */

/** A handle needs the engine, so it waits on `glyph.init()`; the component suspends on this like on a font. */
const handleReady = glyph.init().then(() => glyph.handle('examples:groups', ThreeConfig));

export default function Groups() {
  const handle = use(handleReady);
  const inter = useMsdf(INTER);
  const ring = useRef<ThreeTextGroup>(null);
  const [draws, setDraws] = useState(0);

  useFrame(({ scene, elapsed }) => {
    if (ring.current !== null) ring.current.rotation.z = elapsed * 0.08;
    const planned = plannedDraws(scene, 'ring');
    if (planned !== draws) setDraws(planned);
  });

  return (
    <>
      <GlyphProvider handle={handle('ring')}>
        <Ring ref={ring} />
      </GlyphProvider>
      <Text
        font={inter}
        style={{ fontSize: 0.22, color: PAPER_DIM }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 4 } }}
        position={[-2, 0.16, 0]}
      >
        {`${COUNT} labels, ${draws} ${draws === 1 ? 'draw' : 'draws'}`}
      </Text>
    </>
  );
}
