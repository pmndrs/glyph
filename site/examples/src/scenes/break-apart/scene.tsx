import { Text } from '@pmndrs/glyph/react';
import { useSlug } from '@pmndrs/glyph/react/slug';
import type { Decorations, Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import type { slug } from '@pmndrs/glyph/three/slug';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';

import { PLAYWRITE } from '../../fonts';
import { PAPER } from '../../stage';

/**
 * Explode, tumble, settle, repeat. Once the word is committed, `breakApart()`
 * copies its glyphs into a `Glyphs` object with one matrix per glyph; the
 * source stays live and hidden, and the copy is animated back to each glyph's
 * `originalMatrix`, which `measurements` remembers.
 */
const CYCLE = 4;

export default function BreakApart() {
  const script = useSlug(PLAYWRITE);
  const text = useRef<ThreeText<typeof slug>>(null);
  const scene = useThree((state) => state.scene);
  const detached = useRef<{ glyphs: Glyphs; decorations: Decorations | undefined } | undefined>(undefined);
  const seeds = useRef<Vector3[]>([]);

  useEffect(
    () => () => {
      detached.current?.glyphs.dispose();
      detached.current?.decorations?.dispose();
      detached.current = undefined;
    },
    [],
  );

  useFrame(({ elapsed }) => {
    const source = text.current;
    if (source === null) return;

    // Break apart once the renderer has committed the paragraph.
    if (detached.current === undefined) {
      if (source.commitState().status !== 'committed') return;
      const [glyphs, decorations] = source.breakApart();
      source.parent?.add(glyphs); // a sibling overlays the source exactly
      if (decorations !== undefined) source.parent?.add(decorations);
      source.visible = false;
      detached.current = { glyphs, decorations };
      // Each glyph flies out from where it sits, so the burst stays around the word.
      const home = new Vector3();
      const q = new Quaternion();
      const s = new Vector3();
      seeds.current = Array.from({ length: glyphs.count }, (_, i) => {
        const a = (i / glyphs.count) * Math.PI * 2 + 0.7;
        glyphs.measurements[i]?.originalMatrix.decompose(home, q, s);
        return new Vector3(home.x + Math.cos(a) * 1.6, home.y + Math.sin(a) * 1.2 + 0.4, (i % 3) * 0.4 - 0.4);
      });
      return;
    }

    // 0 → 1 explodes, 1 → 2 holds, 2 → 3 returns, 3 → 4 rests.
    const phase = elapsed % CYCLE;
    const out = phase < 1 ? ease(phase) : phase < 2 ? 1 : phase < 3 ? 1 - ease(phase - 2) : 0;

    const { glyphs } = detached.current;
    const m = new Matrix4();
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    const home = new Vector3();
    const spin = new Quaternion();
    for (let i = 0; i < glyphs.count; i += 1) {
      const rest = glyphs.measurements[i];
      const seed = seeds.current[i];
      if (rest === undefined || seed === undefined) continue;
      rest.originalMatrix.decompose(home, q, s);
      p.copy(home).lerp(seed, out);
      // Mostly about Z: a flat glyph spun about Y is a line when seen edge-on.
      spin.setFromAxisAngle(new Vector3(0.15, 0.25, 1).normalize(), out * Math.PI * 2 * (0.5 + (i % 4) * 0.25));
      m.compose(p, q.multiply(spin), s);
      glyphs.setMatrixAt(i, m);
    }
    void scene;
  });

  return (
    <Text
      ref={text}
      font={script}
      style={{ fontSize: 1.6, color: PAPER }}
      layout={{ align: 'center', wrap: 'none' }}
      constraints={{ width: { mode: 'exact', size: 9 } }}
      position={[-4.5, 0.8, 0]}
    >
      glyph
    </Text>
  );
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
