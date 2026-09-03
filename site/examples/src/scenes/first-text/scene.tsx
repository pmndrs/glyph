import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import type { msdf } from '@pmndrs/glyph/three/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';

import { INTER } from '../../fonts';
import { ACCENT } from '../../theme';

/**
 * The tutorial's finished state: styled, wrapped to a box, and centred on
 * what was actually drawn rather than on the box.
 */
export default function FirstText() {
  const inter = useMsdf(INTER);
  const ref = useRef<ThreeText<typeof msdf>>(null);

  useFrame(() => {
    const text = ref.current;
    if (text === null) return;
    // Ink is what was drawn; the advance box is what layout reserved. A script
    // face with swashes overhangs its advance, so centre on ink.
    const ink = text.measure().inkBounds;
    if (ink !== undefined) text.position.set(-(ink.x + ink.width / 2), ink.y + ink.height / 2, 0);
  });

  return (
    <Text
      ref={ref}
      font={inter}
      style={{ fontSize: 0.6, color: ACCENT, letterSpacing: 0.02 }}
      layout={{ wrap: 'word', align: 'center' }}
      constraints={{ width: { mode: 'at-most', size: 6 } }}
    >
      The quick brown fox jumps over the lazy dog
    </Text>
  );
}
