import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';

import { INTER } from '../../fonts';
import { PAPER_DIM } from '../../theme';

/** A small dim line, centred in a box `width` wide whose left edge is at `x`. */
export function Caption({
  x,
  y,
  width = 5,
  size = 0.24,
  children,
}: {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly size?: number;
  readonly children: string;
}) {
  const inter = useMsdf(INTER);
  return (
    <Text
      font={inter}
      style={{ fontSize: size, color: PAPER_DIM, letterSpacing: 0.02 }}
      layout={{ align: 'center', wrap: 'none' }}
      constraints={{ width: { mode: 'exact', size: width } }}
      position={[x, y, 0]}
    >
      {children}
    </Text>
  );
}
