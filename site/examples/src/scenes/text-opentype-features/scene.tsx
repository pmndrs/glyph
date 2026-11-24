import { Text, useMsdf } from '@pmndrs/glyph/react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { ROWS, SERIF_MSDF } from './config';

/**
 * OpenType features, off and on, in Source Serif 4. Each row is the same
 * string twice; only `style.features` differs. `liga` is on by default, so
 * its "off" side passes `value: 0`; the others are off by default and the
 * "on" side names the tag. The last row limits a feature to a UTF-16 range
 * of the text with `start` and `end`.
 */
export const SERIF = new URL('../../../../docs/assets/fonts/styling/source-serif-features.font.glb', import.meta.url)
  .href;

export const OFF_X = -2.3;
export const ON_X = 1.9;
export const TOP = 1.95;
export const STEP = 0.78;

export default function OpenTypeFeatures() {
  const inter = useMsdf(INTER);
  const serif = useMsdf(SERIF, SERIF_MSDF);
  const caption = { fontSize: 0.15, color: PAPER_DIM, letterSpacing: 0.02 } as const;

  return (
    <>
      <Text font={inter} style={caption} layout={{ wrap: 'none' }} position={[OFF_X, TOP + 0.55, 0]}>
        feature off
      </Text>
      <Text font={inter} style={caption} layout={{ wrap: 'none' }} position={[ON_X, TOP + 0.55, 0]}>
        feature on
      </Text>
      {ROWS.map((row, index) => {
        const y = TOP - index * STEP;
        return (
          <group key={row.tag} position={[0, y, 0]}>
            <Text
              font={inter}
              style={{ fontSize: 0.2, color: PAPER }}
              layout={{ wrap: 'none' }}
              position={[-5.1, -0.1, 0]}
            >
              {row.tag}
            </Text>
            <Text font={inter} style={caption} layout={{ wrap: 'none' }} position={[-5.1, -0.38, 0]}>
              {row.note}
            </Text>
            <Text
              font={serif}
              style={{ fontSize: 0.5, color: PAPER, features: row.off }}
              layout={{ wrap: 'none' }}
              position={[OFF_X, 0, 0]}
            >
              {row.text}
            </Text>
            <Text
              font={serif}
              style={{ fontSize: 0.5, color: ACCENT, features: row.on }}
              layout={{ wrap: 'none' }}
              position={[ON_X, 0, 0]}
            >
              {row.text}
            </Text>
          </group>
        );
      })}
    </>
  );
}
