import type { ParagraphLayout } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Label, Outline } from '../layout-kit/kit';

/**
 * Four drop caps on the same paragraph. The cap is the paragraph's first
 * letter at the size its own span gives it; `dropCap` only says how the body
 * makes room. The outline is the paragraph's exact-width box.
 */
export const BODY =
  'fter the initial, the body runs beside it for as many lines as the cap needs, then returns to the full measure of the paragraph.';
export const CAP_SIZE = 0.94;
export const WIDTH = 2.45;

export const CAPS = [
  ['lines: 3', { lines: 3 }],
  ["lines: 1, align: 'baseline'", { lines: 1, align: 'baseline' }],
  ["lines: 3, side: 'inline-end'", { lines: 3, side: 'inline-end' }],
  [
    'lines: 3, contour: [...]',
    {
      lines: 3,
      // The right-hand slope of the letter A, in the unit square of the cap's box.
      contour: [
        [0, 0],
        [0.62, 0],
        [1, 1],
        [0, 1],
      ],
    },
  ],
] as const satisfies readonly (readonly [string, NonNullable<ParagraphLayout['dropCap']>])[];

export default function LayoutDropCap() {
  const inter = useMsdf(INTER);
  return (
    <>
      {CAPS.map(([caption, dropCap], column) => (
        <group key={caption} position={[-5.25 + column * 2.68, 1.25, 0]}>
          <Label at={[0, -0.9]} size={0.15}>
            {caption}
          </Label>
          <Outline box={[0, 0, WIDTH, 2.05]} />
          <Text
            font={inter}
            style={{ fontSize: 0.2, lineHeight: 1.35, color: PAPER }}
            layout={{ dropCap: { marginInline: 0.06, ...dropCap } }}
            constraints={{ width: { mode: 'exact', size: WIDTH } }}
          >
            <Text style={{ fontSize: CAP_SIZE, color: ACCENT }}>A</Text>
            {BODY}
          </Text>
        </group>
      ))}
    </>
  );
}
