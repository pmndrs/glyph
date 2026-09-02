import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../stage';

/**
 * One paragraph, three flow policies, and a box that breathes. `layout` is
 * the rule and `constraints` is the box; the text reflows every frame the box
 * changes and the rule never has to be restated.
 */
const PROSE =
  'Text goes through five stages, each owned by the layer best placed to do it exactly once. JavaScript owns Unicode analysis and the render loop. Rust owns shaping, layout, and the plan.';

const COLUMNS = [
  ['wrap: word · align: start', { wrap: 'word', align: 'start' }],
  ['align: justify · lastLine: auto', { wrap: 'word', align: 'justify', lastLine: 'auto' }],
  ['maxLines: 4 · overflow: ellipsis', { wrap: 'word', align: 'start', maxLines: 4, overflow: 'ellipsis' }],
] as const;

export default function ParagraphLayout() {
  const inter = useMsdf(INTER);
  const elapsed = useRef(0);
  const [width, setWidth] = useState(3);

  useFrame((_state, delta) => {
    elapsed.current += delta;
    setWidth(2.6 + Math.sin(elapsed.current * 0.6) * 0.7);
  });

  return (
    <>
      {COLUMNS.map(([caption, layout], index) => {
        const x = -5.4 + index * 3.7;
        return (
          <group key={caption} position={[x, 2.2, 0]}>
            <Text
              font={inter}
              style={{ fontSize: 0.13, color: PAPER_DIM, letterSpacing: 0.02 }}
              layout={{ wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: 3.4 } }}
              position={[0, 0.3, 0]}
            >
              {caption}
            </Text>
            {/* The box, drawn so the reflow reads against something. */}
            <mesh position={[width / 2, -1.5, -0.01]}>
              <planeGeometry args={[width, 3.2]} />
              <meshBasicNodeMaterial color="#0f1218" />
            </mesh>
            <Text
              font={inter}
              style={{ fontSize: 0.2, color: index === 1 ? ACCENT : PAPER, lineHeight: 1.3 }}
              layout={layout}
              constraints={{ width: { mode: 'exact', size: width }, height: { mode: 'at-most', size: 3.2 } }}
            >
              {PROSE}
            </Text>
          </group>
        );
      })}
    </>
  );
}
