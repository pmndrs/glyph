import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';

import { INTER } from '../../../../examples/src/fonts';
import { PAPER, PAPER_DIM } from '../../../../examples/src/theme';
import type { GlyphSceneProps } from '../../explainer/page';
import { ExampleStage } from './stage';

/**
 * What a proxy shows when it names a scene the catalog does not have yet:
 * the name, and that it is planned. Honest, and it keeps a page's markup
 * ahead of its examples without pretending.
 */
export function Planned({ scene, onReady }: GlyphSceneProps) {
  const inter = useMsdf(INTER);
  return (
    <ExampleStage options={{}} onReady={onReady}>
      <Text
        font={inter}
        style={{ fontSize: 0.7, color: PAPER, letterSpacing: 0.01 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 10 } }}
        position={[-5, 0.55, 0]}
      >
        {scene}
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.32, color: PAPER_DIM, letterSpacing: 0.04 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 10 } }}
        position={[-5, -0.35, 0]}
      >
        example planned
      </Text>
    </ExampleStage>
  );
}
