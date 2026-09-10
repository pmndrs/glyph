/* @jsxImportSource vue */
import type { Font } from '@pmndrs/glyph';
import { Text, TextGroup, useFont } from '@pmndrs/glyph/vue';
import { useBitmap } from '@pmndrs/glyph/vue/bitmap';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import type { Text as ThreeText } from '@pmndrs/glyph/three';

declare const bitmapFont: Font<typeof bitmap>;

function TsxTypeAssertions() {
  const selected = useFont('/fonts/Inter.font.glb', { format: msdf });
  const loaded = selected.font.value;
  useBitmap('/fonts/Inter.font.glb', { strikes: [16] }).font.value satisfies Font<typeof bitmap> | undefined;
  return (
    <TextGroup renderOrder={1}>
      <Text font={bitmapFont} style={{ fontSize: 16 }} position={[0, 0, 0]}>
        Typed <Text style={{ color: 'red' }}>TSX</Text>
      </Text>
      {loaded === undefined ? null : (
        <Text
          font={loaded}
          ref={(value: unknown) => {
            void value;
          }}
        >
          Loaded
        </Text>
      )}
    </TextGroup>
  );
}

declare const typedInstance: InstanceType<typeof Text<Font<typeof msdf>>>;
typedInstance.instance satisfies ThreeText<typeof msdf> | undefined;

void TsxTypeAssertions;
