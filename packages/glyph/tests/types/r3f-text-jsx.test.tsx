import { glyph } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/react';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import type { Text as ThreeText } from '@pmndrs/glyph/three';

const inter = glyph.fontFace('/fonts/Inter.font.glb', { format: msdf });

const text = (
  <Text
    font={inter.msdf}
    ref={(value) => {
      value satisfies ThreeText<typeof msdf> | null;
    }}
  >
    Typed <Text font={inter.msdf}>nested FontFace selection</Text>
  </Text>
);

void text;
