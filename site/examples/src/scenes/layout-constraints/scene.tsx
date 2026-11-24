import type { AxisConstraint } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Label, Outline, Segment } from '../layout-kit/kit';

/**
 * One sentence under the three width modes while the stated size breathes.
 * The grey line is the size the constraint states; the gold box is what
 * `measure()` reports. `unconstrained` never wraps, `at-most` wraps at the
 * size and then shrinks to the widest line, `exact` wraps and keeps the size.
 */
export const SENTENCE = 'The measured box follows the width mode.';

const MODES = ['unconstrained', 'at-most', 'exact'] as const;

function widthConstraint(mode: (typeof MODES)[number], size: number): AxisConstraint {
  return mode === 'unconstrained' ? { mode } : { mode, size };
}

export default function LayoutConstraints() {
  const inter = useMsdf(INTER);
  const [size, setSize] = useState(5);
  const [boxes, setBoxes] = useState<readonly (readonly [number, number])[]>([
    [0, 0],
    [0, 0],
    [0, 0],
  ]);

  useFrame(({ elapsed }) => {
    setSize(5 + Math.sin(elapsed * 0.5) * 2.4);
  });

  return (
    <>
      {MODES.map((mode, row) => {
        const [width, height] = boxes[row]!;
        return (
          <group key={mode} position={[-2.7, 2.55 - row * 1.8, 0]}>
            <Label at={[-2.5, 0.02]} size={0.2}>{`width: ${mode}`}</Label>
            <Label at={[-2.5, 0.36]} size={0.16}>
              {mode === 'unconstrained' ? 'no size' : `size ${size.toFixed(2)}`}
            </Label>
            <Label at={[-2.5, 0.62]} size={0.16} color={ACCENT}>{`measured ${width.toFixed(2)}`}</Label>
            {mode !== 'unconstrained' && <Segment from={[size, -0.12]} to={[size, 1.35]} thickness={0.02} />}
            <Outline box={[0, 0, width, height]} color={ACCENT} />
            <Text
              font={inter}
              style={{ fontSize: 0.3, lineHeight: 1.3, color: PAPER }}
              constraints={{ width: widthConstraint(mode, size) }}
              onLayout={(_text, layout) => {
                // Several texts report in one frame, so each update starts from the latest state.
                setBoxes((current) =>
                  current.map((box, index) => (index === row ? [layout.width, layout.height] : box)),
                );
              }}
            >
              {SENTENCE}
            </Text>
          </group>
        );
      })}
    </>
  );
}
