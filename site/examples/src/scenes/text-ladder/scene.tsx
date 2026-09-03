import { Text } from '@pmndrs/glyph/react';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { useThree } from '@react-three/fiber/webgpu';

import { INTER, INTER_STRIKES } from '../../fonts';
import { PAPER, PAPER_DIM } from '../../theme';

/**
 * 8 px upward on a pixel-unit stage, one format per column. The stage is
 * orthographic so a `fontSize` is a device pixel at DPR 1: this is the ladder
 * to read a format's range off, not a composition. Rows stop where the word
 * would no longer fit its column, so the ladder is as tall as the viewport
 * is wide.
 */
const SIZES = [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512] as const;
/** "Glyph" is about 2.6 em wide in Inter; the size prefix adds a little. */
const WIDTH_PER_PX = 3.4;

export default function TextLadder() {
  const { width, height } = useThree((state) => state.viewport);
  const bitmap = useBitmap(INTER, INTER_STRIKES);
  const msdf = useMsdf(INTER);
  const slug = useSlug(INTER);
  const columns = [
    ['bitmap', bitmap],
    ['msdf', msdf],
    ['slug', slug],
  ] as const;
  const columnWidth = width / columns.length;
  const sizes = SIZES.filter((size) => size * WIDTH_PER_PX <= columnWidth - 32);

  return (
    <>
      {columns.map(([label, font], column) => {
        const x = -width / 2 + column * columnWidth + 24;
        let y = height / 2 - 64;
        return (
          <group key={label}>
            <Text
              font={msdf}
              style={{ fontSize: 12, color: PAPER_DIM, letterSpacing: 1 }}
              layout={{ wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: columnWidth } }}
              position={[x, y, 0]}
            >
              {label.toUpperCase()}
            </Text>
            {sizes.map((size) => {
              y -= size * 1.15 + 6;
              return (
                <Text
                  key={size}
                  font={font}
                  style={{ fontSize: size, color: PAPER, lineHeight: 1 }}
                  layout={{ wrap: 'none', overflow: 'clip' }}
                  constraints={{ width: { mode: 'exact', size: columnWidth - 32 } }}
                  position={[x, y + size, 0]}
                  pixelSnapping={label === 'bitmap'}
                >
                  {`${size} Glyph`}
                </Text>
              );
            })}
          </group>
        );
      })}
    </>
  );
}
