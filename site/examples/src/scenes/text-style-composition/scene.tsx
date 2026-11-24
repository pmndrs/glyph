import { TextStyle } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * Named rules and property lists. `TextStyle.create` validates and freezes
 * each rule once; `style` then takes one rule, a list of rules, or a list
 * with a condition in it — `false` entries are skipped, later entries win.
 *
 * The paragraph at the bottom shows what a span inherits: the paragraph sets
 * `opacity`, one span sets only `color` and stays dim, another sets only
 * `opacity` and keeps the paragraph's color.
 */
export const styles = TextStyle.create({
  body: { fontSize: 0.34, color: PAPER },
  emphasis: { color: ACCENT, letterSpacing: 0.04 },
  caption: { fontSize: 0.15, color: PAPER_DIM, letterSpacing: 0.02 },
});

const SAMPLE = 'Reuse a rule';
const TOP = 2.7;
const STEP = 0.78;

export default function StyleComposition() {
  const inter = useMsdf(INTER);
  const [active, setActive] = useState(false);

  useFrame(({ elapsed }) => {
    const next = Math.floor(elapsed / 1.2) % 2 === 1;
    if (next !== active) setActive(next);
  });

  const rows = [
    ['style={styles.body}', styles.body],
    ['style={[styles.body, styles.emphasis]}', [styles.body, styles.emphasis]],
    [
      `style={[styles.body, active && styles.emphasis]}   active = ${String(active)}`,
      [styles.body, active && styles.emphasis],
    ],
    ['style={[styles.body, styles.emphasis, { opacity: 0.4 }]}', [styles.body, styles.emphasis, { opacity: 0.4 }]],
  ] as const;

  return (
    <>
      {rows.map(([caption, style], index) => (
        <group key={index} position={[-4.6, TOP - index * STEP, 0]}>
          <Text font={inter} style={styles.caption} layout={{ wrap: 'none' }}>
            {caption}
          </Text>
          <Text font={inter} style={style} layout={{ wrap: 'none' }} position={[0, -0.24, 0]}>
            {SAMPLE}
          </Text>
        </group>
      ))}
      <group position={[-4.6, TOP - rows.length * STEP - 0.25, 0]}>
        <Text font={inter} style={styles.caption} layout={{ wrap: 'none' }}>
          {'paragraph { opacity: 0.4 }   span { color }   span { opacity: 1 }'}
        </Text>
        <Text
          font={inter}
          style={[styles.body, { fontSize: 0.3, lineHeight: 1.4, opacity: 0.4 }]}
          layout={{ wrap: 'word' }}
          constraints={{ width: { mode: 'exact', size: 9.2 } }}
          position={[0, -0.24, 0]}
        >
          The paragraph is dim, <Text style={{ color: ACCENT }}>a colored span stays dim</Text>,{' '}
          <Text style={{ opacity: 1 }}>an opaque span keeps the color</Text>.
        </Text>
      </group>
    </>
  );
}
