import type { TextFlow, TextFlowExclusion } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Fill, Label, Outline } from '../layout-kit/kit';
import { LONG_PROSE } from '../layout-kit/prose';

/**
 * The same sliding rectangle under each `wrapSide`. `both` keeps text on
 * each side; `inline-start` and `inline-end` keep one side and leave the
 * other empty; `largest` keeps whichever side is wider, so the text changes
 * sides as the rectangle crosses the middle.
 */
export const SIDES = ['both', 'inline-start', 'inline-end', 'largest'] as const satisfies readonly NonNullable<
  TextFlowExclusion['wrapSide']
>[];
export const PANEL = [5.05, 2.3] as const;
/** The exclusion as `[inline start, block start, inline end, block end]` for a given centre. */
export const block = (center: number) => [center - 0.5, 0.42, center + 0.5, 1.55] as const;
/** Where panel `index` sits in the scene: two rows of two. */
export const panelPosition = (index: number) =>
  [-5.25 + (index % 2) * 5.45, 2.5 - Math.floor(index / 2) * 2.95] as const;

export function flowBeside(wrapSide: (typeof SIDES)[number], center: number): TextFlow {
  return {
    regions: [
      {
        key: 'panel',
        shape: { kind: 'rectangle', bounds: [0, 0, PANEL[0], PANEL[1]] },
        exclusions: [
          { key: 'block', shape: { kind: 'rectangle', bounds: block(center) }, wrapSide, marginInline: 0.1 },
        ],
      },
    ],
  };
}

export default function LayoutWrapSide() {
  const inter = useMsdf(INTER);
  const [center, setCenter] = useState(PANEL[0] / 2);

  useFrame(({ elapsed }) => {
    setCenter(PANEL[0] / 2 + Math.sin(elapsed * 0.5) * 0.8);
  });
  const [inlineStart, blockStart, inlineEnd, blockEnd] = block(center);
  const box = [inlineStart, blockStart, inlineEnd - inlineStart, blockEnd - blockStart] as const;

  return (
    <>
      {SIDES.map((wrapSide, index) => {
        const [x, y] = panelPosition(index);
        return (
          <group key={wrapSide} position={[x, y, 0]}>
            <Label at={[0, -0.32]} size={0.18}>{`wrapSide: '${wrapSide}'`}</Label>
            <Outline box={[0, 0, PANEL[0], PANEL[1]]} />
            <Fill box={box} color="#2c2718" />
            <Outline box={box} color={ACCENT} />
            <Text
              font={inter}
              style={{ fontSize: 0.17, lineHeight: 1.35, color: PAPER }}
              flow={flowBeside(wrapSide, center)}
            >
              {LONG_PROSE}
            </Text>
          </group>
        );
      })}
    </>
  );
}
