import type { Font, msdf } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useMemo, useRef, useState } from 'react';
import { BufferAttribute, BufferGeometry } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { FONT_SIZE, INTER_OUTLINES, OUTLINE_MSDF, STEPS, WORD } from './config';
import { outlineGeometry, type OutlineGeometry } from './outline';

const CONTROL = '#6f8fd8';

interface Outlines extends OutlineGeometry {
  readonly width: number;
  readonly height: number;
}

/**
 * The contours `glyphs().outlineAt(index)` returns, drawn over the text they came from. The font was baked
 * with outlines; each contour is a closed run of quadratic curves and lines. Gold is the outline, the white
 * squares are where curves meet, the blue ones are control points.
 */
export default function InspectOutlines() {
  // Both fonts load before the first commit.
  const inter = useMsdf(INTER);
  const outlined = useMsdf(INTER_OUTLINES, OUTLINE_MSDF);
  const ref = useRef<ThreeText<typeof msdf>>(null);
  const [outlines, setOutlines] = useState<Outlines | undefined>(undefined);

  useFrame(() => {
    const text = ref.current;
    if (text === null || outlines !== undefined) return;
    const layout = text.glyphs();
    setOutlines({ ...outlineGeometry(layout, STEPS), width: layout.width, height: layout.height });
  });

  const geometry = useMemo(() => {
    if (outlines === undefined) return undefined;
    return new BufferGeometry().setAttribute('position', new BufferAttribute(outlines.segments, 3));
  }, [outlines]);

  return (
    <group position={outlines === undefined ? [-3.5, 2.6, 0] : [-outlines.width / 2, 2.6, 0]}>
      <Text
        ref={ref}
        font={outlined}
        style={{ fontSize: FONT_SIZE, color: PAPER, opacity: 0.16 }}
        layout={{ wrap: 'none' }}
      >
        {WORD}
      </Text>
      {geometry !== undefined && (
        <lineSegments geometry={geometry} position={[0, 0, 0.01]}>
          <lineBasicNodeMaterial color={ACCENT} />
        </lineSegments>
      )}
      {outlines?.controls.map(([x, y], index) => (
        <mesh key={`c${index}`} position={[x, y, 0.02]}>
          <planeGeometry args={[0.045, 0.045]} />
          <meshBasicNodeMaterial color={CONTROL} />
        </mesh>
      ))}
      {outlines?.onCurve.map(([x, y], index) => (
        <mesh key={`p${index}`} position={[x, y, 0.03]}>
          <planeGeometry args={[0.05, 0.05]} />
          <meshBasicNodeMaterial color={PAPER} />
        </mesh>
      ))}
      {outlines !== undefined && (
        <>
          <Note font={inter} y={-outlines.height - 0.15} color={ACCENT}>
            {`gold: outlineAt(0) to outlineAt(${WORD.length - 1}), ${outlines.contourCount} contours, ${outlines.curveCount} curves`}
          </Note>
          <Note font={inter} y={-outlines.height - 0.5} color={PAPER_DIM}>
            white: where curves meet; blue: control points of the quadratic curves
          </Note>
        </>
      )}
    </group>
  );
}

function Note({
  font,
  y,
  color,
  children,
}: {
  readonly font: Font<typeof msdf>;
  readonly y: number;
  readonly color: string;
  readonly children: string;
}) {
  return (
    <Text
      font={font}
      style={{ fontSize: 0.22, color, letterSpacing: 0.02 }}
      layout={{ wrap: 'none' }}
      position={[0, y, 0]}
    >
      {children}
    </Text>
  );
}
