import type { Font } from '@pmndrs/glyph';
import { glyph } from '@pmndrs/glyph';
import { useSlug } from '@pmndrs/glyph/react/slug';
import type { slug } from '@pmndrs/glyph/raster/slug';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import type { Group } from 'three/webgpu';

import { LiveTextOnPath } from '../../components/text';
import { INTER } from '../../fonts';
import { circle } from '../../lib/paths';
import { passageAt, passageFrame, splitCurrentWord } from '../../lib/typewriter';
import { Ground } from './components/Ground';
import { Knot } from './components/Knot';
import { PassageLine } from './components/PassageLine';
import { StripTile, useStripTile } from './components/StripTile';
import { KNOT_POSITION, RINGS, RING_LETTER_SPACING } from './config';
import { pathInk } from './materials';

/**
 * After "Kinetic Typography with Three.js" by Mario Carrillo for Codrops
 * (2020, https://tympanus.net/codrops/2020/06/02/kinetic-typography-with-three-js/): the
 * same idea, with the engine where the bitmap font used to be. A second scene holds the passage as it is typed — one Slug
 * line, end-aligned — with two lanes of small type either side, and is
 * rendered to a strip every frame; the knot's material wraps that strip once
 * around the tube, turned so the passage rides the front, so the words being
 * written run along the knot the moment they exist, the current one in the
 * accent. Two rings of Slug glyphs orbit the knot: ring buffers of words,
 * each word written at a moving head the moment the typist completes it,
 * shaped once, copied out with `breakApart()` and placed by matrix, and
 * dropped when the head laps it; each ring tumbles slowly like a gyroscope
 * and is depth-tested so the knot hides it as it passes behind; they cast
 * shadows onto the knot, and because the ring material masks the shadow pass
 * with Slug's analytic coverage, the shadows are the letters themselves. The
 * passage itself runs as a quiet line along the bottom.
 */
const handleReady = glyph.init().then(() => glyph.handle('examples:kinetic', ThreeConfig));

export default function Kinetic() {
  const handle = use(handleReady);
  const inter = useSlug(INTER);
  const tile = useStripTile();
  const [frame, setFrame] = useState({ passage: 0, shown: 0 });
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    gl.shadowMap.enabled = true; // the shared renderer; the rings throw shadows onto the knot
  }, [gl]);

  useFrame(({ elapsed }) => {
    const next = passageFrame(elapsed);
    if (next.passage !== frame.passage || next.shown !== frame.shown) setFrame(next);
  });

  const passage = passageAt(frame.passage);
  const typed = passage.slice(0, frame.shown);
  const { before, current } = splitCurrentWord(typed);

  return (
    <>
      <StripTile tile={tile} root={handle('tile')} font={inter} before={before} current={current} />
      <Ground />
      <ambientLight color="#dfe6f5" intensity={0.55} />
      <directionalLight
        castShadow
        color="#f4f7ff"
        intensity={2.4}
        position={[1.5, 3.5, 12]}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.0005}
      />
      <Knot skin={tile.texture} />
      {RINGS.map((ring, index) => (
        <Ring key={index} ring={ring} font={inter} text={typed.toUpperCase()} />
      ))}
      <PassageLine typed={typed} done={frame.shown >= passage.length} />
    </>
  );
}

/** One orbital ring, its axis wandering slowly: a gyroscope that never settles, written word by word. */
function Ring({
  ring,
  font,
  text,
}: {
  readonly ring: (typeof RINGS)[number];
  readonly font: Font<typeof slug>;
  readonly text: string;
}) {
  const group = useRef<Group>(null);
  const path = useMemo(() => circle(ring.radius), [ring.radius]);
  useFrame(({ elapsed }) => {
    const g = group.current;
    if (g === null) return;
    const [wobble, turn] = ring.spin;
    g.rotation.set(
      0.9 + Math.sin(elapsed * wobble + ring.phase) * 0.7,
      elapsed * turn,
      Math.cos(elapsed * wobble * 0.7 + ring.phase) * 0.5,
    );
  });
  return (
    <group ref={group} position={[...KNOT_POSITION]}>
      <LiveTextOnPath
        font={font}
        path={path}
        text={text}
        speed={ring.speed}
        size={ring.size}
        color="#d3dbea"
        letterSpacing={RING_LETTER_SPACING}
        material={pathInk}
        castShadow
      />
    </group>
  );
}
