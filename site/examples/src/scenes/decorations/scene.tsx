import { TextStyle } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { color, mix, positionLocal, uniform } from 'three/tsl';

import { LabeledRow } from '../../components/text';
import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';

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
        <LabeledRow key={name} index={index} name={name}>
          <Text font={inter} style={[styles.base, { decoration }]} layout={{ wrap: 'none' }} constraints={WIDTH}>
            Sphinx of black quartz
          </Text>
        </LabeledRow>
      ))}
      <LabeledRow index={ROWS.length} name="material">
        <Text
          font={inter}
          material={gradientLine}
          style={[styles.base, { decoration: { underline: true, thickness: 0.06 } }]}
          layout={{ wrap: 'none' }}
          constraints={WIDTH}
        >
          Sphinx of black quartz
        </Text>
      </LabeledRow>
    </>
  );
}
