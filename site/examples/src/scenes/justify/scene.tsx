import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import type { msdf } from '@pmndrs/glyph/three/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import type { Group } from 'three/webgpu';

import { INTER } from '../../fonts';
import { PAPER, PAPER_DIM } from '../../stage';

/**
 * An editorial page: a justified lede on one measure, then the body flowing
 * through two ordered columns under it. The measure breathes, and every
 * reflow negotiates each line inside the declared bounds — word spaces may
 * shrink to three quarters and grow by well over half, and only past that does
 * a sliver of the deficit spill into letter spacing. The reader should notice none of it.
 */
export const LEDE =
  'The pull of a justified column is older than the press that made it common. A page holds its measure, both edges true, while every line negotiates its own interior: word spaces widen and narrow inside declared bounds, and the letters lend a fraction of a unit when the words alone cannot settle the difference.';
export const BODY =
  'Typography is the craft of endowing human language with a durable visual form. The paragraph opens with a small indent, carries its own space before and after, and asks the composer for restraint: expansion capped near a third of a space, compression never past three quarters, and the last line left to fall where it may. A tight measure is the honest test. When the column narrows, the breaker may borrow back the declared shrink to seat one more word; when it widens, capped word growth spills into hair-fine letter spacing rather than rivers. The reader should notice none of this, only that the page sits quietly.';

export const JUSTIFY = { minWordSpaceRatio: 0.75, maxWordSpaceRatio: 1.6, letterSpaceExpansion: 0.01 } as const;
const FONT_SIZE = 0.27;
const LINE_HEIGHT = 1.3;
const BODY_HEIGHT = FONT_SIZE * LINE_HEIGHT * 9;

export default function Justify() {
  const inter = useMsdf(INTER);
  const lede = useRef<ThreeText<typeof msdf>>(null);
  const body = useRef<Group>(null);
  const [width, setWidth] = useState(8);

  useFrame(({ elapsed }) => {
    // The measure breathes; a new width is a new constraint, and the paragraphs reflow on the next frame.
    const next = 7.6 + Math.sin(elapsed * 0.35) * 1.4;
    if (Math.abs(next - width) > 0.03) setWidth(next);
    // The body hangs off the lede's committed height, which includes its spaceAfter.
    const top = lede.current;
    if (top !== null && body.current !== null && top.commitState().status === 'committed') {
      body.current.position.y = -top.measure().height;
    }
  });

  const left = -width / 2;
  return (
    <group position={[left, 2.1, 0]}>
      <Text
        ref={lede}
        font={inter}
        style={{ fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, color: PAPER }}
        layout={{ wrap: 'word', align: 'justify', justify: JUSTIFY, spaceAfter: FONT_SIZE * 0.8 }}
        constraints={{ width: { mode: 'exact', size: width } }}
      >
        {LEDE}
      </Text>
      <group ref={body}>
        <Text
          font={inter}
          style={{ fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, color: PAPER_DIM, wordSpacing: FONT_SIZE * 0.05 }}
          layout={{
            wrap: 'word',
            align: 'justify',
            justify: JUSTIFY,
            firstLineIndent: FONT_SIZE * 1.5,
            columns: { count: 2, gap: FONT_SIZE * 1.2 },
            overflow: 'clip',
          }}
          constraints={{ width: { mode: 'exact', size: width }, height: { mode: 'exact', size: BODY_HEIGHT } }}
        >
          {BODY}
        </Text>
      </group>
    </group>
  );
}
