import { TextStyle } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * Every `TextStyle` property, one row each, over one base style. `create`
 * takes named rules and returns them validated and frozen; a rule may be a
 * property list, so `emphasis` composes `base` without restating it. The last
 * row animates opacity to show that opacity is inherited on its own.
 */
const styles = TextStyle.create({
  base: { fontSize: 0.36, color: PAPER, lineHeight: 1.1 },
  caption: { fontSize: 0.14, color: PAPER_DIM, letterSpacing: 0.02 },
});

const ROWS = [
  ['fontSize', { fontSize: 0.52 }],
  ['lineHeight', { lineHeight: 0.8 }],
  ['letterSpacing', { letterSpacing: 0.06 }],
  ['wordSpacing', { wordSpacing: 0.25 }],
  ['color', { color: ACCENT }],
  ['outline', { outline: { color: ACCENT, width: 0.02 }, color: '#0a0c12' }],
  ['shadow', { shadow: { color: [1, 0.82, 0.4, 0.85], offset: [0.04, -0.04] } }],
  ['decoration', { decoration: { underline: true, color: ACCENT } }],
  ['features', { features: [{ tag: 'smcp' }, { tag: 'tnum' }] }],
  ['language', { language: 'tr', features: [{ tag: 'locl' }] }],
] as const;

export default function Styling() {
  const inter = useMsdf(INTER);
  const [opacity, setOpacity] = useState(1);

  useFrame(({ elapsed }) => {
    setOpacity(0.55 + 0.45 * Math.sin(elapsed * 1.4));
  });

  const rows = [...ROWS, ['opacity', { opacity }] as const];

  return (
    <>
      {rows.map(([name, override], index) => (
        <group key={name} position={[0, 2.4 - index * 0.47, 0]}>
          <Text
            font={inter}
            style={styles.caption}
            layout={{ wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 2 } }}
            position={[-5.2, 0.08, 0]}
          >
            {name}
          </Text>
          <Text
            font={inter}
            style={[styles.base, override]}
            layout={{ wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 7 } }}
            position={[-3.2, 0.18, 0]}
          >
            Sphinx of black quartz 1234
          </Text>
        </group>
      ))}
    </>
  );
}
