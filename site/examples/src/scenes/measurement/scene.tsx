import { Text } from '@pmndrs/glyph/react';
import { useSlug } from '@pmndrs/glyph/react/slug';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import type { slug } from '@pmndrs/glyph/raster/slug';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import { PLAYWRITE } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';

/**
 * The advance box versus the ink box, live. A script face overhangs what
 * layout reserved for it: the grey rectangle is `contentWidth × contentHeight`,
 * the gold one is `inkBounds`. Centre on ink; stack on advance.
 */
interface Boxes {
  readonly advance: readonly [x: number, y: number, w: number, h: number];
  readonly ink: readonly [x: number, y: number, w: number, h: number] | undefined;
  readonly baseline: number;
}

export default function Measurement() {
  const script = useSlug(PLAYWRITE);
  const ref = useRef<ThreeText<typeof slug>>(null);
  const [boxes, setBoxes] = useState<Boxes | undefined>(undefined);

  useFrame(() => {
    const text = ref.current;
    if (text === null) return;
    // Cheap: an unchanged paragraph returns the retained summary without a Wasm crossing.
    const m = text.measure();
    const ink = m.inkBounds;
    const next: Boxes = {
      advance: [0, 0, m.contentWidth, m.contentHeight],
      ink: ink === undefined ? undefined : [ink.x, ink.y, ink.width, ink.height],
      baseline: m.firstBaseline,
    };
    if (JSON.stringify(next) !== JSON.stringify(boxes)) setBoxes(next);
  });

  return (
    <group position={[-3.4, 1, 0]}>
      <Text ref={ref} font={script} style={{ fontSize: 1.2, color: PAPER }} layout={{ wrap: 'none' }}>
        glyph
      </Text>
      {boxes !== undefined && (
        <>
          <Outline box={boxes.advance} color="#454d5d" />
          {boxes.ink !== undefined && <Outline box={boxes.ink} color={ACCENT} />}
          {/* Paragraph space is y-down; the scene is y-up, so the baseline sits at -firstBaseline. */}
          <mesh position={[boxes.advance[2] / 2, -boxes.baseline, 0.01]}>
            <planeGeometry args={[boxes.advance[2], 0.01]} />
            <meshBasicNodeMaterial color="#97a1b4" />
          </mesh>
        </>
      )}
    </group>
  );
}

function Outline({
  box: [x, y, w, h],
  color,
}: {
  readonly box: readonly [number, number, number, number];
  readonly color: string;
}) {
  const t = 0.012;
  return (
    <group position={[x + w / 2, -(y + h / 2), 0.005]}>
      <mesh position={[0, h / 2, 0]}>
        <planeGeometry args={[w, t]} />
        <meshBasicNodeMaterial color={color} />
      </mesh>
      <mesh position={[0, -h / 2, 0]}>
        <planeGeometry args={[w, t]} />
        <meshBasicNodeMaterial color={color} />
      </mesh>
      <mesh position={[-w / 2, 0, 0]}>
        <planeGeometry args={[t, h]} />
        <meshBasicNodeMaterial color={color} />
      </mesh>
      <mesh position={[w / 2, 0, 0]}>
        <planeGeometry args={[t, h]} />
        <meshBasicNodeMaterial color={color} />
      </mesh>
    </group>
  );
}
