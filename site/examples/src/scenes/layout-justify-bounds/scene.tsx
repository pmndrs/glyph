import type { ParagraphLayout } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Fill, Label, Segment } from '../layout-kit/kit';

/**
 * Justification on a narrow measure, four ways. Unbounded word spaces fill
 * every line but open wide gaps. A `maxWordSpaceRatio` caps the gaps, and
 * lines that cannot reach the gold edge stay short. `letterSpaceExpansion`
 * lets the remainder spread between letters. `lastLine: 'justify'` also
 * fills the final line.
 */
export const PARAGRAPH =
  'A narrow measure is the honest test of justification. Long words leave large gaps, and the composer must decide where the spare room goes.';

export const RULES = [
  ["align: 'justify'", {}],
  ['maxWordSpaceRatio: 1.5', { justify: { maxWordSpaceRatio: 1.5 } }],
  ['letterSpaceExpansion: 0.02', { justify: { maxWordSpaceRatio: 1.5, letterSpaceExpansion: 0.02 } }],
  ["lastLine: 'justify'", { lastLine: 'justify' }],
] as const satisfies readonly (readonly [string, ParagraphLayout])[];

export default function LayoutJustifyBounds() {
  const inter = useMsdf(INTER);
  const [width, setWidth] = useState(2.2);

  useFrame(({ elapsed }) => {
    setWidth(2.2 + Math.sin(elapsed * 0.5) * 0.22);
  });

  return (
    <>
      {RULES.map(([caption, rule], column) => (
        <group key={caption} position={[-5.25 + column * 2.68, 1.5, 0]}>
          <Label at={[0, -0.36]} size={0.145}>
            {caption}
          </Label>
          <Fill box={[0, 0, width, 3.1]} />
          <Segment from={[width, 0]} to={[width, 3.1]} color={ACCENT} />
          <Text
            font={inter}
            style={{ fontSize: 0.21, lineHeight: 1.35, color: PAPER }}
            layout={{ align: 'justify', ...rule }}
            constraints={{ width: { mode: 'exact', size: width } }}
          >
            {PARAGRAPH}
          </Text>
        </group>
      ))}
    </>
  );
}
