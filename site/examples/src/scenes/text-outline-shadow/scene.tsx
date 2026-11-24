import { Text, useMsdf } from '@pmndrs/glyph/react';

import { Caption } from '../../components/text';
import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';

/**
 * Outline and shadow on an MSDF font. Both are read from the distance field
 * the glyph is already drawn from, so neither adds a draw: the outline is a
 * band `width` outside the glyph edge, the shadow is the same glyph sampled
 * at an offset and shown where the glyph itself is not. Widths and offsets
 * are in the units `fontSize` is in. The panel behind the words is there so
 * the dark shadow has something to fall on.
 */
export const SIZE = 0.95;
export const SAMPLES = [
  {
    word: 'Outline',
    caption: "outline: { color: '#ffd166', width: 0.03 }",
    style: { color: '#10131a', outline: { color: ACCENT, width: 0.03 } },
  },
  {
    word: 'Shadow',
    caption: "shadow: { color: '#000000cc', offset: [0.04, 0.04] }",
    style: { color: PAPER, shadow: { color: '#000000cc', offset: [0.04, 0.04] } },
  },
  {
    word: 'Both',
    caption: 'outline and shadow together',
    style: {
      color: PAPER,
      outline: { color: '#ff4dc4', width: 0.025 },
      shadow: { color: [0, 0, 0, 0.8], offset: [0.04, 0.04] },
    },
  },
] as const;

export default function OutlineShadow() {
  const inter = useMsdf(INTER);
  return (
    <>
      <mesh position={[0, 0.1, -0.01]}>
        <planeGeometry args={[10.2, 5.2]} />
        <meshBasicNodeMaterial color="#2a3142" />
      </mesh>
      {SAMPLES.map((sample, index) => {
        const y = 2.2 - index * 1.62;
        return (
          <group key={sample.word}>
            <Text
              font={inter}
              style={[{ fontSize: SIZE }, sample.style]}
              layout={{ align: 'center', wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: 9 } }}
              position={[-4.5, y, 0]}
            >
              {sample.word}
            </Text>
            <Caption x={-4.5} y={y - 1.12} width={9} size={0.17}>
              {sample.caption}
            </Caption>
          </group>
        );
      })}
    </>
  );
}
