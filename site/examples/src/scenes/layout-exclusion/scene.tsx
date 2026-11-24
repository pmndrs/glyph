import type { TextFlow, TextFlowPoint } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Dot, Outline, Ring } from '../layout-kit/kit';
import { FLOW_PROSE } from '../layout-kit/prose';

/**
 * A polygon exclusion drifting through one region. Every line the shape
 * crosses is cut, and with the default `wrapSide: 'both'` the words continue
 * on each side of it. `marginInline` keeps the text off the outline.
 */
export const REGION = [0, 0, 8.2, 3.7] as const;
export const RADIUS = 0.85;

/** A sixteen-sided ring: a circle, to the precision this text needs. */
export function disc(cx: number, cy: number, radius: number): readonly TextFlowPoint[] {
  return Array.from({ length: 16 }, (_, index): TextFlowPoint => {
    const angle = (index / 16) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });
}

export function flowAround(vertices: readonly TextFlowPoint[]): TextFlow {
  return {
    regions: [
      {
        key: 'page',
        shape: { kind: 'rectangle', bounds: REGION },
        exclusions: [{ key: 'disc', shape: { kind: 'polygon', vertices }, marginInline: 0.14 }],
      },
    ],
  };
}

export default function LayoutExclusion() {
  const inter = useMsdf(INTER);
  const [center, setCenter] = useState<readonly [number, number]>([4.1, 1.6]);

  useFrame(({ elapsed }) => {
    setCenter([4.1 + Math.sin(elapsed * 0.4) * 2.6, 1.6 + Math.sin(elapsed * 0.67) * 0.7]);
  });
  const vertices = disc(center[0], center[1], RADIUS);

  return (
    <group position={[-4.1, 1.85, 0]}>
      <Outline box={[REGION[0], REGION[1], REGION[2], REGION[3]]} />
      <Dot at={center} color="#2c2718" radius={RADIUS} />
      <Ring points={vertices} color={ACCENT} z={0.03} />
      <Text font={inter} style={{ fontSize: 0.2, lineHeight: 1.35, color: PAPER }} flow={flowAround(vertices)}>
        {FLOW_PROSE}
      </Text>
    </group>
  );
}
