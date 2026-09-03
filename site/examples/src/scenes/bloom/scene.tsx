import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';

import { INTER } from '../../fonts';
import { Glow } from './components/Glow';

/**
 * Post-processing sees text as pixels in the scene pass, nothing more. Bloom
 * thresholds on brightness, so the dim words stay put while the bright one
 * blooms; its strength is a uniform, animated without rebuilding the pipeline.
 */
const DIM = '#4b5568';
const BRIGHT = '#fff3c4';

export default function Bloom() {
  const inter = useMsdf(INTER);

  return (
    <>
      <Glow />
      <Text
        font={inter}
        style={{ fontSize: 1.1, color: DIM }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 10 } }}
        position={[-5, 0.75, 0]}
      >
        words that <Text style={{ color: BRIGHT }}>shine</Text>
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.26, color: DIM, letterSpacing: 0.02 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 10 } }}
        position={[-5, -0.7, 0]}
      >
        bloom threshold 0.55
      </Text>
    </>
  );
}
