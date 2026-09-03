import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { Decorations, Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import type { msdf } from '@pmndrs/glyph/three/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';

import { INTER } from '../../fonts';
import { PAPER } from '../../theme';

/**
 * Text on a circle. The paragraph is laid out on one straight line; once it
 * commits, `breakApart()` gives one matrix per glyph and each glyph's advance
 * along the line becomes an angle. The radius comes from `measure().contentWidth`
 * — the advance extent of the line, not the box the constraint resolved — so the
 * ring closes on itself whatever the text.
 */
const TEXT = 'one matrix per glyph * breakApart() * one matrix per glyph * breakApart() * ';
const TILT = 0.32;

export default function Arc() {
  const inter = useMsdf(INTER);
  const text = useRef<ThreeText<typeof msdf>>(null);
  const ring = useRef<{ glyphs: Glyphs; decorations: Decorations | undefined; radius: number } | undefined>(undefined);

  useEffect(
    () => () => {
      ring.current?.glyphs.dispose();
      ring.current?.decorations?.dispose();
      ring.current = undefined;
    },
    [],
  );

  useFrame(({ elapsed }) => {
    const source = text.current;
    if (source === null) return;

    if (ring.current === undefined) {
      if (source.commitState().status !== 'committed') return;
      const radius = source.measure().contentWidth / (Math.PI * 2);
      const [glyphs, decorations] = source.breakApart();
      source.parent?.add(glyphs);
      if (decorations !== undefined) source.parent?.add(decorations);
      source.visible = false;
      glyphs.rotation.x = TILT;
      ring.current = { glyphs, decorations, radius };
    }

    const { glyphs, radius } = ring.current;
    glyphs.rotation.y = -elapsed * 0.35;
    const m = new Matrix4();
    const home = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    const turn = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < glyphs.count; i += 1) {
      const rest = glyphs.measurements[i];
      if (rest === undefined) continue;
      rest.originalMatrix.decompose(home, q, s);
      // Distance along the line is arc length; the glyph faces outward from the centre.
      const angle = home.x / radius;
      turn.setFromAxisAngle(up, angle);
      m.compose(new Vector3(Math.sin(angle) * radius, home.y, Math.cos(angle) * radius), turn.multiply(q), s);
      glyphs.setMatrixAt(i, m);
    }
  });

  return (
    <Text
      ref={text}
      font={inter}
      style={{ fontSize: 0.46, color: PAPER, letterSpacing: 0.01 }}
      layout={{ align: 'start', wrap: 'none' }}
      constraints={{ width: { mode: 'exact', size: 30 } }}
      position={[0, 0.15, 0]}
    >
      {TEXT}
    </Text>
  );
}
