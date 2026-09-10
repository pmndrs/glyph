import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { ReactNode } from 'react';

import { INTER } from '../../fonts';
import { PAPER_DIM } from '../../theme';

/** One row of a property ladder: a dim label in the margin, and the row's content beside it. */
export function LabeledRow({
  index,
  name,
  top = 2.2,
  step = 0.5,
  children,
}: {
  readonly index: number;
  readonly name: string;
  readonly top?: number;
  readonly step?: number;
  readonly children: ReactNode;
}) {
  const inter = useMsdf(INTER);
  return (
    <group position={[0, top - index * step, 0]}>
      <Text
        font={inter}
        style={{ fontSize: 0.14, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 2 } }}
        position={[-5.2, 0.08, 0]}
      >
        {name}
      </Text>
      <group position={[-3.2, 0.18, 0]}>{children}</group>
    </group>
  );
}
