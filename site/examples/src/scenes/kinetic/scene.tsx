import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import type { Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import type { slug } from '@pmndrs/glyph/three/slug';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useRef, useState } from 'react';
import { Matrix4, type Group } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../stage';
import { placeOnKnot, torusKnot } from './knot';
import { knotInk, wave, waveTime } from './materials';

/**
 * Kinetic typography, the Codrops way, with real type. The piece is a lit
 * torus knot with three rows of text flowing over its surface: each glyph is
 * a committed Slug glyph copied out with `breakApart()` and placed on the
 * knot by matrix every frame, so the letters are crisp at any size; the ink
 * depth-tests against the tube, so the far side is hidden, and dims with
 * depth. Beside it a passage types itself in word by word on a waving
 * surface, its measure breathing, so the text underneath the motion is
 * being shaped live; the word being typed is spotlit flat above.
 */
export const PASSAGES = [
  // Emily Dickinson, 1861
  'Hope is the thing with feathers that perches in the soul, and sings the tune without the words, and never stops at all.',
  // Walt Whitman, 1855
  'I celebrate myself, and sing myself, and what I assume you shall assume, for every atom belonging to me as good belongs to you.',
] as const;
export const BAND = 'ENDLESS  KINETIC  LIVE SHAPED TYPE  ';
export const ROWS = 3;
/** Same parametrisation as three's `TorusKnotGeometry(RADIUS, TUBE, …, 2, 3)`, so the tube and the path agree. */
export const RADIUS = 2.3;
export const TUBE = 0.6;
export const KNOT = torusKnot(2, 3, RADIUS, RADIUS / 2);
const INK_HEIGHT = TUBE + 0.12; // the baseline rides just above the surface; descenders still clear it
const FLOW = 0.9; // world units per second along the knot

const TYPE_RATE = 14;
const ERASE_RATE = 60;
const HOLD = 2.4;

export default function Kinetic() {
  const inter = useSlug(INTER);
  const interMsdf = useMsdf(INTER);
  const sources = useRef<(ThreeText<typeof slug> | null)[]>([]);
  const rows = useRef<{ glyphs: Glyphs; width: number }[]>([]);
  const knot = useRef<Group>(null);
  const spot = useRef<Group>(null);
  const [frame, setFrame] = useState({ passage: 0, shown: 0, width: 7 });
  const wordStarted = useRef(0);
  const lastWord = useRef(-1);

  useEffect(
    () => () => {
      for (const row of rows.current) row.glyphs.dispose();
      rows.current = [];
    },
    [],
  );

  useFrame(({ elapsed }) => {
    waveTime.value = elapsed;
    if (knot.current !== null) knot.current.rotation.set(0.9, elapsed * 0.12, 0.15);

    // Copy each committed band out once; from then on the copies are placed by matrix.
    if (rows.current.length < ROWS) {
      const ready = sources.current.every((source) => source?.commitState().status === 'committed');
      if (!ready || sources.current.length < ROWS) return;
      rows.current = sources.current.map((source) => {
        const text = source as ThreeText<typeof slug>;
        const [glyphs] = text.breakApart();
        text.parent?.add(glyphs);
        text.visible = false;
        return { glyphs, width: text.measure().contentWidth };
      });
    }
    const m = new Matrix4();
    for (const [row, { glyphs, width }] of rows.current.entries()) {
      const angle = (row / ROWS) * Math.PI * 2;
      const offset = elapsed * FLOW + row * (KNOT.length / ROWS) * 0.37;
      for (let i = 0; i < glyphs.count; i += 1) {
        const rest = glyphs.measurements[i];
        if (rest === undefined) continue;
        // Advance along the band becomes arc length; the band tiles the knot exactly once.
        const s = ((rest.originalMatrix.elements[12] ?? 0) * (KNOT.length / width) + offset) % KNOT.length;
        glyphs.setMatrixAt(i, placeOnKnot(KNOT, s, angle, INK_HEIGHT, rest.originalMatrix, m));
      }
    }

    const next = passageFrame(elapsed);
    const width = 5 + Math.sin(elapsed * 0.6) * 0.6;
    if (next.passage !== frame.passage || next.shown !== frame.shown || Math.abs(width - frame.width) > 0.04) {
      setFrame({ ...next, width });
    }
    const word = wordIndexAt(passageAt(next.passage), next.shown);
    if (word !== lastWord.current) {
      lastWord.current = word;
      wordStarted.current = elapsed;
    }
    spot.current?.scale.setScalar(1 + 0.35 * Math.exp(-7 * (elapsed - wordStarted.current)));
  });

  const passage = passageAt(frame.passage);
  const { before, current } = splitCurrentWord(passage.slice(0, frame.shown));

  return (
    <>
      <group ref={knot} position={[2.3, 0.4, -1.4]}>
        <mesh>
          <torusKnotGeometry args={[RADIUS, TUBE, 320, 32, 2, 3]} />
          <meshStandardNodeMaterial color="#141a26" metalness={0.25} roughness={0.5} />
        </mesh>
        {Array.from({ length: ROWS }, (_, row) => (
          <Text
            key={row}
            ref={(node) => {
              sources.current[row] = node;
            }}
            font={inter}
            material={knotInk}
            style={{ fontSize: 0.42, color: '#dfe6f5', letterSpacing: 0.04 }}
            layout={{ wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 60 } }}
          >
            {BAND + BAND}
          </Text>
        ))}
      </group>

      <group ref={spot} position={[-3, 2.05, 0.6]}>
        <Text
          font={inter}
          style={{ fontSize: 0.9, color: ACCENT, letterSpacing: -0.02 }}
          layout={{ align: 'center', wrap: 'none' }}
          constraints={{ width: { mode: 'exact', size: 6 } }}
          position={[-3, 0.45, 0]}
        >
          {current}
        </Text>
      </group>

      <group position={[-5.3, -0.7, 0.3]} rotation={[0, 0.1, 0]}>
        <Text
          font={interMsdf}
          material={wave}
          style={{ fontSize: 0.34, color: PAPER, lineHeight: 1.3 }}
          layout={{ wrap: 'word', align: 'start' }}
          constraints={{ width: { mode: 'exact', size: frame.width } }}
        >
          {before}
          <Text style={{ color: ACCENT }}>{current}</Text>
          <Text style={{ color: PAPER_DIM }}>{frame.shown < passage.length ? '|' : ''}</Text>
        </Text>
      </group>
    </>
  );
}

/** A passage by index; the index always comes from `passageFrame`, which stays in range. */
export function passageAt(index: number): string {
  return PASSAGES[index] ?? PASSAGES[0];
}

/** Where the typewriter is at a moment: which passage, how many characters, forward or back. */
export function passageFrame(elapsed: number): { passage: number; shown: number } {
  let t = elapsed;
  for (let cycle = 0; ; cycle += 1) {
    const index = cycle % PASSAGES.length;
    const passage = passageAt(index);
    const typing = passage.length / TYPE_RATE;
    const erasing = passage.length / ERASE_RATE;
    const total = typing + HOLD + erasing + 0.6;
    if (t < total) {
      if (t < typing) return { passage: index, shown: Math.floor(t * TYPE_RATE) };
      if (t < typing + HOLD) return { passage: index, shown: passage.length };
      if (t < typing + HOLD + erasing)
        return { passage: index, shown: passage.length - Math.floor((t - typing - HOLD) * ERASE_RATE) };
      return { passage: index, shown: 0 };
    }
    t -= total;
  }
}

/** The index of the word that character `shown` falls in, so a new word can be noticed. */
export function wordIndexAt(passage: string, shown: number): number {
  return passage.slice(0, shown).split(' ').length - 1;
}

/** Split typed text into everything before the current word and the word itself. */
export function splitCurrentWord(typed: string): { before: string; current: string } {
  const at = typed.lastIndexOf(' ') + 1;
  return { before: typed.slice(0, at), current: typed.slice(at) };
}
