import { glyph } from '@pmndrs/glyph';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { use, useState } from 'react';

import { INTER } from '../../fonts';
import { passageAt, passageFrame, splitCurrentWord } from '../../lib/typewriter';
import { Ground } from './components/Ground';
import { Knot } from './components/Knot';
import { PassageLine } from './components/PassageLine';
import { StripTile, useStripTile } from './components/StripTile';

/**
 * After "Kinetic Typography with Three.js" by Mario Carrillo for Codrops
 * (2020, https://tympanus.net/codrops/2020/06/02/kinetic-typography-with-three-js/): the
 * same idea, with the engine where the bitmap font used to be. A second scene holds the passage as it is typed — one Slug
 * line, end-aligned — with two lanes of small type either side, and is
 * rendered to a strip every frame; the knot's material wraps that strip once
 * around the tube, turned so the passage rides the front, so the words being
 * written run along the knot the moment they exist, the current one in the
 * accent. The passage itself runs as a quiet line along the bottom.
 */
const handleReady = glyph.init().then(() => glyph.handle('examples:kinetic', ThreeConfig));

export default function Kinetic() {
  const handle = use(handleReady);
  const inter = useSlug(INTER);
  const tile = useStripTile();
  const [frame, setFrame] = useState({ passage: 0, shown: 0 });

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
      <Knot skin={tile.texture} />
      <PassageLine typed={typed} done={frame.shown >= passage.length} />
    </>
  );
}
