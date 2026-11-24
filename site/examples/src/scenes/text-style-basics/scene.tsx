import { TextStyle } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';

import { LabeledRow } from '../../components/text';
import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * The six everyday `TextStyle` properties. The left column changes one
 * property per row against the first, unstyled row; the right column sets the
 * same three lines at two line heights, because `lineHeight` only shows once
 * a paragraph has more than one line. Every length is in the units `fontSize`
 * is in — here, world units.
 */
const styles = TextStyle.create({
  base: { fontSize: 0.3, color: PAPER },
  caption: { fontSize: 0.14, color: PAPER_DIM, letterSpacing: 0.02 },
});

export const ROWS = [
  ['base', {}],
  ['fontSize: 0.42', { fontSize: 0.42 }],
  ['letterSpacing: 0.05', { letterSpacing: 0.05 }],
  ['wordSpacing: 0.3', { wordSpacing: 0.3 }],
  ["color: '#ffd166'", { color: ACCENT }],
  ['color: [0, 0.4, 1, 1]', { color: [0, 0.4, 1, 1] }],
  ['opacity: 0.4', { opacity: 0.4 }],
] as const;

export const LINE_HEIGHTS = [1, 1.8] as const;
export const SAMPLE = 'Quartz sphinx 123';
export const LINES = 'Line height is a\nmultiple of the\nfont size.';

export default function StyleBasics() {
  const inter = useMsdf(INTER);
  return (
    <>
      {ROWS.map(([name, override], index) => (
        <LabeledRow key={name} index={index} name={name} top={2.1} step={0.62}>
          <Text font={inter} style={[styles.base, override]} layout={{ wrap: 'none' }}>
            {SAMPLE}
          </Text>
        </LabeledRow>
      ))}
      {LINE_HEIGHTS.map((lineHeight, index) => (
        <group key={lineHeight} position={[2.2, 2.18 - index * 2.2, 0]}>
          <Text font={inter} style={styles.caption} layout={{ wrap: 'none' }}>
            {`lineHeight: ${lineHeight}`}
          </Text>
          <Text font={inter} style={[styles.base, { lineHeight }]} position={[0, -0.34, 0]}>
            {LINES}
          </Text>
        </group>
      ))}
    </>
  );
}
