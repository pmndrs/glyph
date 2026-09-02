import { TextStyle } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import type { ReactNode } from 'react';
import { color, mix, positionLocal, uniform } from 'three/tsl';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../stage';

/**
 * Every decoration line, its color, thickness, and offset, then one custom
 * decoration material. A decoration is planned as its own ordered draw with
 * its own material branch — `context.kind === 'decoration'` — so the last row
 * paints its underline with a gradient the glyphs never see. `style` is typed
 * for double, dotted, dashed, and wavy, but the runtime accepts only `solid`
 * today and throws for the rest.
 */
const styles = TextStyle.create({
  base: { fontSize: 0.34, color: PAPER, lineHeight: 1.1 },
  caption: { fontSize: 0.14, color: PAPER_DIM, letterSpacing: 0.02 },
});

export const ROWS = [
  ['underline', { underline: true }],
  ['overline', { overline: true }],
  ['lineThrough', { lineThrough: true }],
  ['all three', { underline: true, overline: true, lineThrough: true }],
  ['color', { underline: true, color: ACCENT }],
  ['thickness', { underline: true, thickness: 0.05 }],
  ['offset', { underline: true, offset: 0.1, color: '#70d6ff' }],
] as const;

const WIDTH = { width: { mode: 'exact', size: 7 } } as const;
const phase = uniform(0);

/** The glyph branch keeps the default; only the decoration branch is painted. */
const gradientLine = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind === 'decoration') {
    const t = positionLocal.x.mul(0.25).add(phase).fract();
    material.colorNode = mix(color('#ff4dc4'), color('#70d6ff'), t).mul(context.shader.opacity);
  }
  return material;
});

export default function Decorations() {
  const inter = useMsdf(INTER);
  useFrame(({ elapsed }) => {
    phase.value = elapsed * 0.3;
  });

  return (
    <>
      {ROWS.map(([name, decoration], index) => (
        <Row key={name} index={index} name={name}>
          <Text font={inter} style={[styles.base, { decoration }]} layout={{ wrap: 'none' }} constraints={WIDTH}>
            Sphinx of black quartz
          </Text>
        </Row>
      ))}
      <Row index={ROWS.length} name="material">
        <Text
          font={inter}
          material={gradientLine}
          style={[styles.base, { decoration: { underline: true, thickness: 0.06 } }]}
          layout={{ wrap: 'none' }}
          constraints={WIDTH}
        >
          Sphinx of black quartz
        </Text>
      </Row>
    </>
  );
}

function Row({
  index,
  name,
  children,
}: {
  readonly index: number;
  readonly name: string;
  readonly children: ReactNode;
}) {
  const inter = useMsdf(INTER);
  return (
    <group position={[0, 2.2 - index * 0.5, 0]}>
      <Text
        font={inter}
        style={styles.caption}
        layout={{ wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 2 } }}
        position={[-5.2, 0.08, 0]}
      >
        {name}
      </Text>
      <group position={[-3.2, 0.18, 0]}>{children}</group>
    </group>
  );
}
