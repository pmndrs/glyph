import { Text, useMsdf, useSlug } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { JAPANESE, MIXED } from './config';

/**
 * Line breaking without spaces. Japanese has no word spaces, so `wrap:
 * 'word'` follows the Unicode line-breaking rules (UAX #14) instead: a line
 * may end after almost any ideograph or kana, but a closing full stop or
 * comma never starts a line. The middle column mixes scripts — the Latin
 * words stay whole — and the last column shows `wrap: 'character'`, which
 * breaks anywhere, inside Latin words too. The boxes breathe so the breaks
 * move.
 */
export const MPLUS = new URL('../../../../docs/assets/fonts/styling/mplus1p-cjk.font.glb', import.meta.url).href;

export const COLUMNS = [
  { caption: "Japanese, wrap: 'word'", text: JAPANESE, wrap: 'word' },
  { caption: "mixed scripts, wrap: 'word'", text: MIXED, wrap: 'word' },
  { caption: "mixed scripts, wrap: 'character'", text: MIXED, wrap: 'character' },
] as const;

export default function CjkLineBreaking() {
  const inter = useMsdf(INTER);
  const mplus = useSlug(MPLUS);
  const [width, setWidth] = useState(3);

  useFrame(({ elapsed }) => {
    setWidth(2.6 + Math.sin(elapsed * 0.6) * 0.6);
  });

  return (
    <>
      {COLUMNS.map((column, index) => (
        <group key={column.caption} position={[-5.2 + index * 3.55, 2.1, 0]}>
          <Text
            font={inter}
            style={{ fontSize: 0.17, color: PAPER_DIM, letterSpacing: 0.02 }}
            layout={{ wrap: 'none' }}
            position={[0, 0.36, 0]}
          >
            {column.caption}
          </Text>
          <mesh position={[width / 2, -1.9, -0.01]}>
            <planeGeometry args={[width, 3.8]} />
            <meshBasicNodeMaterial color="#0f1218" />
          </mesh>
          <Text
            font={mplus}
            style={{ fontSize: 0.34, color: index === 0 ? PAPER : ACCENT, lineHeight: 1.6, language: 'ja' }}
            layout={{ wrap: column.wrap }}
            constraints={{ width: { mode: 'exact', size: width } }}
          >
            {column.text}
          </Text>
        </group>
      ))}
    </>
  );
}
