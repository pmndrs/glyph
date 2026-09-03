import { glyph } from '@pmndrs/glyph';
import { GlyphProvider, Text } from '@pmndrs/glyph/react';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { ThreeConfig, type Glyphs, type Text as ThreeText } from '@pmndrs/glyph/three';
import type { slug } from '@pmndrs/glyph/three/slug';
import { createPortal, useFrame } from '@react-three/fiber/webgpu';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { Matrix4, OrthographicCamera, RenderTarget, Renderer, Scene, type Group } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT } from '../../stage';
import { circle, placeOnPath, torusKnot } from './knot';
import { pathInk, surfaceMaterial, surfaceScroll } from './materials';

/**
 * Kinetic typography, the Codrops way, with the engine where the bitmap font
 * used to be. A second scene holds one line of Slug text — the passage,
 * typing itself in — and is rendered to a render target every frame; the
 * knot's material wraps that texture around the tube with the Codrops
 * `fract(uv * repeat - time)`, so what flows over the surface is text being
 * shaped live. Around the knot, two rings of Slug glyphs orbit on paths:
 * committed glyphs copied out with `breakApart()` and placed by matrix every
 * frame, depth-tested so the knot hides them as they pass behind. The word
 * being typed is spotlit flat above.
 */
export const PASSAGES = [
  // Emily Dickinson, 1861
  'Hope is the thing with feathers that perches in the soul, and sings the tune without the words, and never stops at all.',
  // Walt Whitman, 1855
  'I celebrate myself, and sing myself, and what I assume you shall assume, for every atom belonging to me as good belongs to you.',
] as const;
export const RING_TEXT = 'LIVE SHAPED  ·  KINETIC  ·  ENDLESS  ·  ';

/** Same parametrisation as three's `TorusKnotGeometry(RADIUS, TUBE, …, 2, 3)`, so the tube and the path agree. */
export const RADIUS = 2.3;
export const TUBE = 0.62;
export const KNOT = torusKnot(2, 3, RADIUS, RADIUS / 2);
/** The render target: a wide strip of world units, one line of type tall. */
export const SURFACE = { width: 64, height: 4, pixelsPerUnit: 32 } as const;
/** The strip repeats once per its own width along the knot, and twice around the tube. */
export const REPEAT = { x: KNOT.length / SURFACE.width, y: 2 } as const;
export const RINGS = [
  { radius: 3.6, tilt: [0.55, 0, 0.2] as const, speed: 0.55, size: 0.4 },
  { radius: 2.9, tilt: [-0.7, 0.4, 0] as const, speed: -0.8, size: 0.34 },
] as const;
const WINDOW = 46; // characters of the passage the strip shows at once

const TYPE_RATE = 14;
const ERASE_RATE = 60;
const HOLD = 2.4;

const handleReady = glyph.init().then(() => glyph.handle('examples:kinetic', ThreeConfig));

export default function Kinetic() {
  const handle = use(handleReady);
  const inter = useSlug(INTER);
  const knot = useRef<Group>(null);
  const spot = useRef<Group>(null);
  const ringSources = useRef<(ThreeText<typeof slug> | null)[]>([]);
  const rings = useRef<{ glyphs: Glyphs; width: number }[]>([]);
  const [frame, setFrame] = useState({ passage: 0, shown: 0 });
  const wordStarted = useRef(0);
  const lastWord = useRef(-1);

  // The surface: its own scene, camera, and target; the knot wears the target's texture.
  const [surface] = useState(() => new Scene());
  const [camera] = useState(() => {
    const view = new OrthographicCamera(
      -SURFACE.width / 2,
      SURFACE.width / 2,
      SURFACE.height / 2,
      -SURFACE.height / 2,
      -10,
      10,
    );
    view.position.z = 5;
    return view;
  });
  const [target] = useState(
    () => new RenderTarget(SURFACE.width * SURFACE.pixelsPerUnit, SURFACE.height * SURFACE.pixelsPerUnit),
  );
  const tube = useMemo(() => surfaceMaterial(target.texture, REPEAT), [target]);
  useEffect(
    () => () => {
      for (const ring of rings.current) ring.glyphs.dispose();
      rings.current = [];
      tube.dispose();
      target.dispose();
    },
    [target, tube],
  );

  useFrame(({ renderer, elapsed }) => {
    surfaceScroll.value = elapsed * 0.04;
    if (knot.current !== null) knot.current.rotation.set(0.9, elapsed * 0.12, 0.15);

    // Copy each ring's band out once; from then on the copies are placed by matrix.
    if (rings.current.length < RINGS.length) {
      const ready =
        ringSources.current.length === RINGS.length &&
        ringSources.current.every((source) => source?.commitState().status === 'committed');
      if (ready) {
        rings.current = ringSources.current.map((source) => {
          const text = source as ThreeText<typeof slug>;
          const [glyphs] = text.breakApart();
          text.parent?.add(glyphs);
          text.visible = false;
          return { glyphs, width: text.measure().contentWidth };
        });
      }
    }
    const m = new Matrix4();
    for (const [index, ring] of rings.current.entries()) {
      const spec = RINGS[index];
      if (spec === undefined) continue;
      const path = circle(spec.radius);
      const offset = elapsed * spec.speed;
      for (let i = 0; i < ring.glyphs.count; i += 1) {
        const rest = ring.glyphs.measurements[i];
        if (rest === undefined) continue;
        const s = (rest.originalMatrix.elements[12] ?? 0) * (path.length / ring.width) + offset;
        ring.glyphs.setMatrixAt(i, placeOnPath(path, s, 0, 0, rest.originalMatrix, m));
      }
    }

    const next = passageFrame(elapsed);
    if (next.passage !== frame.passage || next.shown !== frame.shown) setFrame(next);
    const word = wordIndexAt(passageAt(next.passage), next.shown);
    if (word !== lastWord.current) {
      lastWord.current = word;
      wordStarted.current = elapsed;
    }
    spot.current?.scale.setScalar(1 + 0.35 * Math.exp(-7 * (elapsed - wordStarted.current)));

    // The surface renders first; the main scene is drawn after this callback.
    if (!(renderer instanceof Renderer)) return; // the WebGPU entry always is; the type is a union
    renderer.setRenderTarget(target);
    renderer.render(surface, camera);
    renderer.setRenderTarget(null);
  });

  const passage = passageAt(frame.passage);
  const typed = passage.slice(0, frame.shown);
  const strip = typed.slice(-WINDOW);
  const { before, current } = splitCurrentWord(strip);

  return (
    <>
      {createPortal(
        <GlyphProvider handle={handle('surface')}>
          <Text
            font={inter}
            style={{ fontSize: 2.6, color: '#ffffff', letterSpacing: 0.02 }}
            layout={{ wrap: 'none', align: 'end' }}
            constraints={{ width: { mode: 'exact', size: SURFACE.width - 2 } }}
            position={[-SURFACE.width / 2 + 1, 1.3, 0]}
          >
            {before}
            <Text style={{ color: ACCENT }}>{current}</Text>
          </Text>
        </GlyphProvider>,
        surface,
      )}

      <group ref={knot} position={[1.6, 0.2, -1.2]}>
        <mesh material={tube}>
          <torusKnotGeometry args={[RADIUS, TUBE, 320, 32, 2, 3]} />
        </mesh>
      </group>

      {RINGS.map((ring, index) => (
        <group key={ring.radius} position={[1.6, 0.2, -1.2]} rotation={[...ring.tilt]}>
          <Text
            ref={(node) => {
              ringSources.current[index] = node;
            }}
            font={inter}
            material={pathInk}
            style={{ fontSize: ring.size, color: '#c9d3e8', letterSpacing: 0.06 }}
            layout={{ wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 40 } }}
          >
            {RING_TEXT}
          </Text>
        </group>
      ))}

      <group ref={spot} position={[-3.1, 2.05, 0.6]}>
        <Text
          font={inter}
          style={{ fontSize: 0.9, color: ACCENT, letterSpacing: -0.02 }}
          layout={{ align: 'center', wrap: 'none' }}
          constraints={{ width: { mode: 'exact', size: 6 } }}
          position={[-3, 0.45, 0]}
        >
          {splitCurrentWord(typed).current}
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
