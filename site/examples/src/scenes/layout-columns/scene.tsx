import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Fill, Label, Outline } from '../layout-kit/kit';
import { LONG_PROSE } from '../layout-kit/prose';

/**
 * One paragraph in three columns while the exact height breathes. Text fills
 * the first column to the bottom before it starts the next, so a tall box
 * leaves the last column short or empty. A short box reports `overflowed`:
 * under the default `overflow: 'visible'` the last column keeps the one line
 * that crosses its foot, and the lines after it are not laid out.
 */
export const WIDTH = 9.9;
export const COLUMNS = { count: 3, gap: 0.45 } as const;

const columnWidth = (WIDTH - COLUMNS.gap * (COLUMNS.count - 1)) / COLUMNS.count;

export default function LayoutColumns() {
  const inter = useMsdf(INTER);
  const [height, setHeight] = useState(2.4);
  const [overflowed, setOverflowed] = useState(false);

  useFrame(({ elapsed }) => {
    setHeight(2.45 + Math.sin(elapsed * 0.45) * 1.25);
  });

  return (
    <group position={[-WIDTH / 2, 2.2, 0]}>
      <Label at={[0, -0.4]} size={0.19}>{`columns: { count: 3, gap: 0.45 }   height: ${height.toFixed(2)}`}</Label>
      <Label at={[WIDTH, -0.4]} size={0.19} color={ACCENT} anchor={{ x: 'right' }}>
        {`overflowed: ${String(overflowed)}`}
      </Label>
      {Array.from({ length: COLUMNS.count }, (_, index) => {
        const x = index * (columnWidth + COLUMNS.gap);
        return (
          <group key={index}>
            <Fill box={[x, 0, columnWidth, height]} />
            <Outline box={[x, 0, columnWidth, height]} />
          </group>
        );
      })}
      <Outline box={[0, 0, WIDTH, height]} color={ACCENT} />
      <Text
        font={inter}
        style={{ fontSize: 0.21, lineHeight: 1.35, color: PAPER }}
        layout={{ columns: COLUMNS }}
        constraints={{ width: { mode: 'exact', size: WIDTH }, height: { mode: 'exact', size: height } }}
        onLayout={(_text, layout) => setOverflowed(layout.overflowed)}
      >
        {LONG_PROSE}
      </Text>
    </group>
  );
}
