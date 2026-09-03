import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { TextGroup as ThreeTextGroup } from '@pmndrs/glyph/three';
import type { Ref } from 'react';

import { INTER } from '../../../fonts';
import { ACCENT, PAPER } from '../../../theme';

export const COUNT = 48;
const LABELS = Array.from({ length: COUNT }, (_, index) => `label ${String(index + 1).padStart(2, '0')}`);

/** Forty-eight labels around a circle, in one TextGroup: one font, one material, one draw. */
export function Ring({ ref }: { readonly ref: Ref<ThreeTextGroup> }) {
  const inter = useMsdf(INTER);
  return (
    <TextGroup ref={ref} renderOrder={1}>
      {LABELS.map((label, index) => {
        const angle = (index / COUNT) * Math.PI * 2;
        const radius = 2.05;
        return (
          <Text
            key={label}
            font={inter}
            style={{ fontSize: 0.16, color: index % 6 === 0 ? ACCENT : PAPER }}
            layout={{ align: 'center', wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 1.2 } }}
            position={[Math.cos(angle) * radius, Math.sin(angle) * radius + 0.08, 0]}
            rotation={[0, 0, angle]}
          >
            {label}
          </Text>
        );
      })}
    </TextGroup>
  );
}
