import { createFontStack, type ParagraphLayout, type TextStyle } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useMemo, useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { ELLIPSIS, ELLIPSIS_MSDF } from '../layout-kit/fonts';
import { Fill, Label, Outline } from '../layout-kit/kit';
import { PROSE } from '../layout-kit/prose';

/**
 * Text that does not fit. Top row: one paragraph in a box whose exact height
 * breathes. `visible` keeps only the lines that fit whole, `clip` lays out
 * every line and cuts the drawing at the box, `ellipsis` ends the last line
 * that fits with an ellipsis. Bottom row: a line cap, and a single unwrapped
 * line whose ellipsis sits at the end of the paragraph direction.
 */
export const OVERFLOWS = ['visible', 'clip', 'ellipsis'] as const;

export const CAPPED = [
  ["maxLines: 2, overflow: 'ellipsis'", { maxLines: 2, overflow: 'ellipsis' }, {}],
  ["wrap: 'none', overflow: 'ellipsis'", { wrap: 'none', overflow: 'ellipsis' }, {}],
  ["... and direction: 'rtl'", { wrap: 'none', overflow: 'ellipsis' }, { direction: 'rtl' }],
] as const satisfies readonly (readonly [string, ParagraphLayout, TextStyle])[];

const WIDTH = 3.2;
const STYLE = { fontSize: 0.2, lineHeight: 1.35, color: PAPER } as const;
const column = (index: number): number => -5.2 + index * 3.6;

export default function LayoutTruncate() {
  const inter = useMsdf(INTER);
  const ellipsis = useMsdf(ELLIPSIS, ELLIPSIS_MSDF);
  // Inter first; the ellipsis face is consulted only for the character Inter lacks.
  const font = useMemo(() => createFontStack(inter, ellipsis), [inter, ellipsis]);
  const [phase, setPhase] = useState(0);

  useFrame(({ elapsed }) => {
    setPhase(Math.sin(elapsed * 0.5));
  });
  const height = 1.35 + phase * 0.5;
  const line = 2.4 + phase * 0.8;

  return (
    <>
      {OVERFLOWS.map((overflow, index) => (
        <group key={overflow} position={[column(index), 2.35, 0]}>
          <Label at={[0, -0.34]} size={0.18}>{`overflow: '${overflow}'`}</Label>
          <Fill box={[0, 0, WIDTH, height]} />
          <Outline box={[0, 0, WIDTH, height]} color={ACCENT} />
          <Text
            font={font}
            style={STYLE}
            layout={{ overflow }}
            constraints={{ width: { mode: 'exact', size: WIDTH }, height: { mode: 'exact', size: height } }}
          >
            {PROSE}
          </Text>
        </group>
      ))}
      {CAPPED.map(([caption, layout, style], index) => {
        const width = index === 0 ? WIDTH : line;
        return (
          <group key={caption} position={[column(index), -1.2, 0]}>
            <Label at={[0, -0.34]} size={0.18}>
              {caption}
            </Label>
            <Fill box={[0, 0, width, index === 0 ? 0.54 : 0.27]} />
            <Outline box={[0, 0, width, index === 0 ? 0.54 : 0.27]} />
            <Text
              font={font}
              style={[STYLE, style]}
              layout={layout}
              constraints={{ width: { mode: 'exact', size: width } }}
            >
              {PROSE}
            </Text>
          </group>
        );
      })}
    </>
  );
}
