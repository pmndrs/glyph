import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';

import { INTER } from '../../fonts';
import { PAPER } from '../../stage';

/** One font, one Text, one line. Everything else on this site is a variation of this. */
export default function Hello() {
  const inter = useMsdf(INTER);
  return (
    <Text
      font={inter}
      style={{ fontSize: 0.8, color: PAPER }}
      layout={{ align: 'center', wrap: 'none' }}
      constraints={{ width: { mode: 'exact', size: 8 } }}
      position={[-4, 0.4, 0]}
    >
      Hello world
    </Text>
  );
}
