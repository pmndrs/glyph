import type { Font } from '@pmndrs/glyph';
import { Text, useFont } from '@pmndrs/glyph/react';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import type { Text as ThreeText } from '@pmndrs/glyph/three';

function HookTypeAssertions() {
  const selected = useFont('/fonts/Inter.font.glb', { format: msdf });
  selected satisfies Font<typeof msdf>;
  useBitmap('/fonts/Inter.font.glb', { strikes: [16] }) satisfies Font<typeof bitmap>;
  useMsdf('/fonts/Inter.font.glb') satisfies Font<typeof msdf>;
  useSlug('/fonts/Inter.font.glb') satisfies Font<typeof slug>;

  return (
    <Text
      font={selected}
      ref={(value) => {
        value satisfies ThreeText<typeof msdf> | null;
      }}
    >
      Typed JSX
    </Text>
  );
}

void HookTypeAssertions;
