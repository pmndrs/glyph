import { glyph } from '@pmndrs/glyph';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { use, useState } from 'react';

import { TextOnPath } from '../../components/text';
import { INTER } from '../../fonts';
import { circle } from '../../lib/paths';
import { lastWord, passageAt, passageFrame, splitCurrentWord } from '../../lib/typewriter';
import { Ground } from './components/Ground';
import { Knot } from './components/Knot';
import { PassageLine } from './components/PassageLine';
import { WordTile, useWordTile } from './components/WordTile';
import { KNOT_POSITION, RING, RING_TEXT } from './config';
import { pathInk } from './materials';

/**
 * Kinetic typography, the Codrops way, with the engine where the bitmap font
 * used to be. A second scene holds one word in Slug — the word being typed —
 * and is rendered to a render target every frame; the knot's material tiles
 * that texture around the tube with the Codrops `fract(uv * repeat - time)`,
 * so the knot wears the passage word by word as it is written. One ring of
 * Slug glyphs orbits on a path outside it, copied out with `breakApart()`
 * and placed by matrix, depth-tested so the knot hides it as it passes
 * behind. The passage itself runs as a quiet line along the bottom.
 */
const handleReady = glyph.init().then(() => glyph.handle('examples:kinetic', ThreeConfig));

export default function Kinetic() {
  const handle = use(handleReady);
  const inter = useSlug(INTER);
  const tile = useWordTile();
  const [frame, setFrame] = useState({ passage: 0, shown: 0 });

  useFrame(({ elapsed }) => {
    const next = passageFrame(elapsed);
    if (next.passage !== frame.passage || next.shown !== frame.shown) setFrame(next);
  });

  const passage = passageAt(frame.passage);
  const typed = passage.slice(0, frame.shown);
  const { before, current } = splitCurrentWord(typed);
  const word = (current || lastWord(before)).replace(/[^A-Za-z]/g, '').toUpperCase();

  return (
    <>
      <WordTile tile={tile} root={handle('tile')} font={inter} word={word} />
      <Ground />
      <Knot skin={tile.texture} />
      <group position={[...KNOT_POSITION]} rotation={[...RING.tilt]}>
        <TextOnPath
          font={inter}
          path={circle(RING.radius)}
          speed={RING.speed}
          size={RING.size}
          color="#b6c0d6"
          letterSpacing={0.08}
          material={pathInk}
        >
          {RING_TEXT}
        </TextOnPath>
      </group>
      <PassageLine typed={typed} done={frame.shown >= passage.length} />
    </>
  );
}
