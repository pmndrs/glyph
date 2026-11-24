import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { PAPER } from '../../theme';
import { Fill, Label, Outline } from '../layout-kit/kit';

/**
 * One sentence under the three wrap modes while its exact width breathes.
 * `none` keeps one line and runs past the box; `word` breaks between words;
 * `character` breaks between any two characters, so it fills every line.
 */
export const SENTENCE = 'Lines break nowhere, between words, or between any two characters.';
export const WRAPS = ['none', 'word', 'character'] as const;

export default function LayoutWrap() {
  const inter = useMsdf(INTER);
  const [width, setWidth] = useState(4);

  useFrame(({ elapsed }) => {
    setWidth(4 + Math.sin(elapsed * 0.55) * 1.6);
  });

  return (
    <>
      {WRAPS.map((wrap, row) => (
        <group key={wrap} position={[-3.1, 2.65 - row * 1.9, 0]}>
          <Label at={[-2.2, 0.04]} size={0.2}>{`wrap: '${wrap}'`}</Label>
          <Fill box={[0, 0, width, 1.3]} />
          <Outline box={[0, 0, width, 1.3]} />
          <Text
            font={inter}
            style={{ fontSize: 0.24, lineHeight: 1.3, color: PAPER }}
            layout={{ wrap }}
            constraints={{ width: { mode: 'exact', size: width } }}
          >
            {SENTENCE}
          </Text>
        </group>
      ))}
    </>
  );
}
