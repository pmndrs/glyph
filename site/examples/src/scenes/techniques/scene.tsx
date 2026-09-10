import { Text } from '@pmndrs/glyph/react';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import type { Font } from '@pmndrs/glyph';

import { INTER, INTER_STRIKES } from '../../fonts';
import { PAPER, PAPER_DIM } from '../../theme';

/**
 * The same word in the three raster formats, at three sizes, from one GLB.
 * Bitmap is exact at its strike and soft elsewhere; MSDF holds its edge across
 * the range; Slug keeps curves at any size.
 */
const SIZES = [0.18, 0.5, 1.4] as const;

export default function Techniques() {
  const bitmap = useBitmap(INTER, INTER_STRIKES);
  const msdf = useMsdf(INTER);
  const slug = useSlug(INTER);

  const rows: readonly [label: string, font: Font<typeof bitmap.raster | typeof msdf.raster | typeof slug.raster>][] = [
    ['bitmap', bitmap],
    ['msdf', msdf],
    ['slug', slug],
  ];

  return (
    <>
      {rows.map(([label, font], row) => (
        <group key={label} position={[0, 1.6 - row * 1.6, 0]}>
          <Text
            font={msdf}
            style={{ fontSize: 0.16, color: PAPER_DIM, letterSpacing: 0.02 }}
            layout={{ align: 'start', wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 2 } }}
            position={[-5.2, 0.1, 0]}
          >
            {label}
          </Text>
          {SIZES.map((size, column) => (
            <Text
              key={size}
              font={font}
              style={{ fontSize: size, color: PAPER }}
              layout={{ align: 'start', wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: 3 } }}
              position={[-3.2 + column * 2.4, size * 0.5, 0]}
            >
              Glyph
            </Text>
          ))}
        </group>
      ))}
    </>
  );
}
