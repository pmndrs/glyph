import { Text } from '@pmndrs/glyph/react';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import type { Group } from 'three/webgpu';

import { INTER, INTER_STRIKES } from '../../fonts';
import { PAPER, PAPER_DIM } from '../../theme';

/**
 * The same word, the same 32 px raster, magnified 1× to 4× by the scene
 * transform — not by `fontSize`. What each format does under magnification is
 * the whole difference between them: a Bitmap strike is pixels and blurs, an
 * MSDF field holds a clean edge until its range runs out, and Slug evaluates
 * the outline at every pixel and never softens.
 */
const SIZE = 32;

export default function Zoom() {
  const { width, height } = useThree((state) => state.viewport);
  const bitmap = useBitmap(INTER, INTER_STRIKES);
  const msdf = useMsdf(INTER);
  const slug = useSlug(INTER);
  const columns = useRef<(Group | null)[]>([]);
  const shown = useRef(0);
  const [magnification, setMagnification] = useState(1);

  useFrame(({ elapsed }) => {
    // 1 → 4 and back, exponential so each doubling takes the same time; below 1× the three look alike,
    // and above 4× the columns would overlap.
    const scale = 2 ** (1 + Math.sin(elapsed * 0.45));
    for (const column of columns.current) column?.scale.setScalar(scale);
    if (Math.abs(scale - shown.current) > 0.05) {
      shown.current = scale;
      setMagnification(scale);
    }
  });

  const formats = [
    ['bitmap', bitmap],
    ['msdf', msdf],
    ['slug', slug],
  ] as const;
  const columnWidth = width / formats.length;

  return (
    <>
      {formats.map(([label, font], index) => {
        const x = -width / 2 + columnWidth * (index + 0.5);
        return (
          <group key={label} position={[x, 0, 0]}>
            <Text
              font={msdf}
              style={{ fontSize: 12, color: PAPER_DIM, letterSpacing: 1 }}
              layout={{ align: 'center', wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: columnWidth } }}
              position={[-columnWidth / 2, height / 2 - 24, 0]}
            >
              {label.toUpperCase()}
            </Text>
            <group
              ref={(node) => {
                columns.current[index] = node;
              }}
            >
              <Text
                font={font}
                style={{ fontSize: SIZE, color: PAPER, lineHeight: 1 }}
                layout={{ align: 'center', wrap: 'none' }}
                constraints={{ width: { mode: 'exact', size: 400 } }}
                position={[-200, SIZE / 2, 0]}
              >
                Zoom
              </Text>
            </group>
          </group>
        );
      })}
      <Text
        font={msdf}
        style={{ fontSize: 12, color: PAPER_DIM, letterSpacing: 1 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: width } }}
        position={[-width / 2, -height / 2 + 36, 0]}
      >
        {`${SIZE} px raster at ${magnification.toFixed(2)}x`}
      </Text>
    </>
  );
}
