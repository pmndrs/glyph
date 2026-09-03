import { glyph } from '@pmndrs/glyph';
import { GlyphProvider, Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { ThreeConfig, type Glyphs, type Text as ThreeText } from '@pmndrs/glyph/three';
import type { slug } from '@pmndrs/glyph/three/slug';
import { createPortal, useFrame } from '@react-three/fiber/webgpu';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import {
  LinearMipmapLinearFilter,
  Matrix4,
  OrthographicCamera,
  RenderTarget,
  Renderer,
  Scene,
  type Group,
} from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER_DIM } from '../../stage';
import { circle, placeOnPath, torusKnot } from './knot';
import { groundMaterial, pathInk, surfaceMaterial, surfaceScroll } from './materials';

/**
 * Kinetic typography, the Codrops way, with the engine where the bitmap font
 * used to be. A second scene holds one word in Slug — the word being typed —
 * and is rendered to a render target every frame; the knot's material tiles
 * that texture fourteen times along the tube and three times around it with
 * the Codrops `fract(uv * repeat - time)`, so the knot wears the passage word
 * by word as it is written. One ring of Slug glyphs orbits on a path outside
 * it, copied out with `breakApart()` and placed by matrix, depth-tested so
 * the knot hides it as it passes behind. The passage itself runs as a quiet
 * line along the bottom.
 */
export const PASSAGES = [
  // Emily Dickinson, 1861
  'Hope is the thing with feathers that perches in the soul, and sings the tune without the words, and never stops at all.',
  // Walt Whitman, 1855
  'I celebrate myself, and sing myself, and what I assume you shall assume, for every atom belonging to me as good belongs to you.',
] as const;
export const RING_TEXT = 'LIVE SHAPED TYPE  ·  KINETIC  ·  ENDLESS  ·  ';

/** Same parametrisation as three's `TorusKnotGeometry(RADIUS, TUBE, …, 2, 3)`, so the tube and the path agree. */
export const RADIUS = 2.5;
export const TUBE = 0.74;
export const KNOT = torusKnot(2, 3, RADIUS, RADIUS / 2);
/**
 * The knot's skin is a grid of tiles: `ROWS` around the tube, and along it as
 * many as fit at `TILE_ALONG` world units each. A tile on the tube is
 * TILE_ALONG wide and a third of the circumference tall, and the render
 * target has that exact aspect, so a word lands on the surface undistorted.
 */
export const ROWS = 3;
export const TILE_ALONG = 3.4;
export const REPEAT = { x: Math.round(KNOT.length / TILE_ALONG), y: ROWS } as const;
export const TILE = { width: 4, height: (4 * ((Math.PI * 2 * TUBE) / ROWS)) / TILE_ALONG, pixelsPerUnit: 256 } as const;
export const RING = { radius: 4.3, tilt: [1.15, 0.1, 0.35] as const, speed: 0.3, size: 0.32 } as const;

const TYPE_RATE = 12;
const ERASE_RATE = 60;
const HOLD = 3;

const handleReady = glyph.init().then(() => glyph.handle('examples:kinetic', ThreeConfig));

export default function Kinetic() {
  const handle = use(handleReady);
  const inter = useSlug(INTER);
  const interMsdf = useMsdf(INTER);
  const knot = useRef<Group>(null);
  const ringSource = useRef<ThreeText<typeof slug>>(null);
  const ring = useRef<{ glyphs: Glyphs; width: number } | undefined>(undefined);
  const [frame, setFrame] = useState({ passage: 0, shown: 0 });

  // The tile: its own scene, camera, and target; the knot wears the target's texture.
  const [tile] = useState(() => new Scene());
  const [camera] = useState(() => {
    const view = new OrthographicCamera(-TILE.width / 2, TILE.width / 2, TILE.height / 2, -TILE.height / 2, -10, 10);
    view.position.z = 5;
    return view;
  });
  const [target] = useState(() => {
    const created = new RenderTarget(TILE.width * TILE.pixelsPerUnit, TILE.height * TILE.pixelsPerUnit);
    created.texture.generateMipmaps = true; // the far side of the tube minifies the tile
    created.texture.minFilter = LinearMipmapLinearFilter;
    return created;
  });
  const skin = useMemo(() => surfaceMaterial(target.texture, REPEAT), [target]);
  const ground = useMemo(() => groundMaterial(), []);
  useEffect(
    () => () => {
      ring.current?.glyphs.dispose();
      ring.current = undefined;
      skin.dispose();
      ground.dispose();
      target.dispose();
    },
    [ground, skin, target],
  );

  useFrame(({ renderer, elapsed }) => {
    surfaceScroll.value = elapsed * 0.06;
    if (knot.current !== null) knot.current.rotation.set(0.85 + Math.sin(elapsed * 0.17) * 0.2, elapsed * 0.11, 0.2);

    // Copy the ring's band out once; from then on the copy is placed by matrix.
    const source = ringSource.current;
    if (ring.current === undefined && source !== null && source.commitState().status === 'committed') {
      const [glyphs] = source.breakApart();
      source.parent?.add(glyphs);
      source.visible = false;
      ring.current = { glyphs, width: source.measure().contentWidth };
    }
    if (ring.current !== undefined) {
      const path = circle(RING.radius);
      const m = new Matrix4();
      for (let i = 0; i < ring.current.glyphs.count; i += 1) {
        const rest = ring.current.glyphs.measurements[i];
        if (rest === undefined) continue;
        const s = (rest.originalMatrix.elements[12] ?? 0) * (path.length / ring.current.width) + elapsed * RING.speed;
        ring.current.glyphs.setMatrixAt(i, placeOnPath(path, s, 0, 0, rest.originalMatrix, m));
      }
    }

    const next = passageFrame(elapsed);
    if (next.passage !== frame.passage || next.shown !== frame.shown) setFrame(next);

    // The tile renders first; the main scene is drawn after this callback.
    if (!(renderer instanceof Renderer)) return; // the WebGPU entry always is; the type is a union
    renderer.setRenderTarget(target);
    renderer.render(tile, camera);
    renderer.setRenderTarget(null);
  });

  const passage = passageAt(frame.passage);
  const typed = passage.slice(0, frame.shown);
  const { before, current } = splitCurrentWord(typed);
  const word = (current || lastWord(before)).replace(/[^A-Za-z]/g, '').toUpperCase();

  return (
    <>
      {createPortal(
        <GlyphProvider handle={handle('tile')}>
          <Text
            font={inter}
            style={{ fontSize: 0.92, color: '#ffffff', letterSpacing: 0.02 }}
            layout={{ wrap: 'none', align: 'center' }}
            constraints={{ width: { mode: 'exact', size: TILE.width } }}
            position={[-TILE.width / 2, 0.44, 0]}
          >
            {word}
          </Text>
        </GlyphProvider>,
        tile,
      )}

      <mesh material={ground} position={[0, 0, -9]}>
        <planeGeometry args={[60, 34]} />
      </mesh>

      <group ref={knot} position={[0.3, 0.25, -1.4]}>
        <mesh material={skin}>
          <torusKnotGeometry args={[RADIUS, TUBE, 400, 40, 2, 3]} />
        </mesh>
      </group>

      <group position={[0.3, 0.25, -1.4]} rotation={[...RING.tilt]}>
        <Text
          ref={ringSource}
          font={inter}
          material={pathInk}
          style={{ fontSize: RING.size, color: '#b6c0d6', letterSpacing: 0.08 }}
          layout={{ wrap: 'none' }}
          constraints={{ width: { mode: 'exact', size: 40 } }}
        >
          {RING_TEXT}
        </Text>
      </group>

      <Text
        font={interMsdf}
        style={{ fontSize: 0.26, color: PAPER_DIM, lineHeight: 1.3 }}
        layout={{ wrap: 'word', align: 'start' }}
        constraints={{ width: { mode: 'exact', size: 7.5 } }}
        position={[-5.2, -2.25, 0.5]}
      >
        {before}
        <Text style={{ color: ACCENT }}>{current}</Text>
        <Text style={{ color: PAPER_DIM }}>{frame.shown < passage.length ? '|' : ''}</Text>
      </Text>
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

/** Split typed text into everything before the current word and the word itself. */
export function splitCurrentWord(typed: string): { before: string; current: string } {
  const at = typed.lastIndexOf(' ') + 1;
  return { before: typed.slice(0, at), current: typed.slice(at) };
}

/** The last complete word of a string, so the tile keeps a word while a space is being typed. */
export function lastWord(text: string): string {
  const words = text.trim().split(' ');
  return words[words.length - 1] ?? '';
}
