import type { TextFlow, TextFlowPoint } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Label, Outline, Ring } from '../layout-kit/kit';
import { FLOW_PROSE } from '../layout-kit/prose';

/**
 * One paragraph through three regions: a rectangle whose height breathes, a
 * polygon, and a second rectangle. The regions fill in array order. When the
 * first one shrinks, its lines move into the second, and the second's into
 * the third.
 */
export const WEDGE = [
  [3.4, 0.2],
  [6.5, 0.2],
  [5.9, 3.9],
  [4.0, 3.9],
] as const satisfies readonly TextFlowPoint[];
export const TAIL = [7.0, 0.7, 9.9, 4.5] as const;

export function flowFor(ledeHeight: number): TextFlow {
  return {
    regions: [
      { key: 'lede', shape: { kind: 'rectangle', bounds: [0, 0, 2.9, ledeHeight] } },
      { key: 'wedge', shape: { kind: 'polygon', vertices: WEDGE } },
      { key: 'tail', shape: { kind: 'rectangle', bounds: TAIL } },
    ],
  };
}

export default function LayoutFlowRegions() {
  const inter = useMsdf(INTER);
  const [ledeHeight, setLedeHeight] = useState(2.4);

  useFrame(({ elapsed }) => {
    setLedeHeight(2.4 + Math.sin(elapsed * 0.45) * 0.9);
  });

  return (
    <group position={[-4.95, 2.4, 0]}>
      <Label at={[0, -0.34]}>{"1  key: 'lede'  rectangle"}</Label>
      <Label at={[3.4, -0.14]}>{"2  key: 'wedge'  polygon"}</Label>
      <Label at={[7.0, 0.36]}>{"3  key: 'tail'  rectangle"}</Label>
      <Outline box={[0, 0, 2.9, ledeHeight]} color={ACCENT} />
      <Ring points={WEDGE} />
      <Outline box={[TAIL[0], TAIL[1], TAIL[2] - TAIL[0], TAIL[3] - TAIL[1]]} />
      <Text font={inter} style={{ fontSize: 0.2, lineHeight: 1.35, color: PAPER }} flow={flowFor(ledeHeight)}>
        {FLOW_PROSE}
      </Text>
    </group>
  );
}
