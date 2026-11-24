import { Text, useMsdf, useSlug } from '@pmndrs/glyph/react';

import { Caption } from '../../components/text';
import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { DIGITS, LANGUAGES } from './config';

/**
 * One string, three languages. The four code points are the same in every
 * column; `style.language` selects the OpenType language system, and Amiri's
 * `locl` feature swaps in the digit shapes that language writes. Persian is
 * the font's default; Urdu changes four, six and seven, Sindhi six and seven.
 */
export const AMIRI = new URL('../../../../docs/assets/fonts/styling/amiri-arabic.font.glb', import.meta.url).href;
export const COLUMN = 3.4;

export default function LanguageShaping() {
  useMsdf(INTER);
  const amiri = useSlug(AMIRI);

  return (
    <>
      <Caption x={-5} y={2.3} width={10} size={0.19}>
        the same four code points, U+06F4 to U+06F7
      </Caption>
      {LANGUAGES.map((entry, index) => {
        const x = -5.1 + index * COLUMN;
        return (
          <group key={entry.language}>
            <Text
              font={amiri}
              style={{ fontSize: 1.15, color: index === 0 ? PAPER : ACCENT, language: entry.language }}
              layout={{ align: 'center', wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: COLUMN } }}
              position={[x, 1.55, 0]}
            >
              {DIGITS}
            </Text>
            <Caption x={x} y={-0.75} width={COLUMN} size={0.22}>
              {entry.name}
            </Caption>
            <Caption x={x} y={-1.15} width={COLUMN} size={0.17}>
              {`language: '${entry.language}'`}
            </Caption>
          </group>
        );
      })}
    </>
  );
}
