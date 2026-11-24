import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { PAPER } from '../../theme';
import { Fill, Label, Outline } from '../layout-kit/kit';

/**
 * One paragraph under the four alignments, in the same exact width. The box
 * breathes so each line can be seen holding its edge, its centre, or both.
 */
export const PARAGRAPH =
  'Alignment places each line inside the paragraph width. A line that does not fill the width leaves its spare room at the end, on both sides, at the start, or between its words.';
export const ALIGNS = ['start', 'center', 'end', 'justify'] as const;

export default function LayoutAlign() {
  const inter = useMsdf(INTER);
  const [width, setWidth] = useState(2.2);

  useFrame(({ elapsed }) => {
    setWidth(2.2 + Math.sin(elapsed * 0.55) * 0.25);
  });

  return (
    <>
      {ALIGNS.map((align, column) => (
        <group key={align} position={[-5.25 + column * 2.68, 1.5, 0]}>
          <Label at={[0, -0.36]} size={0.2}>{`align: '${align}'`}</Label>
          <Fill box={[0, 0, width, 3.1]} />
          <Outline box={[0, 0, width, 3.1]} />
          <Text
            font={inter}
            style={{ fontSize: 0.21, lineHeight: 1.35, color: PAPER }}
            layout={{ align }}
            constraints={{ width: { mode: 'exact', size: width } }}
          >
            {PARAGRAPH}
          </Text>
        </group>
      ))}
    </>
  );
}
