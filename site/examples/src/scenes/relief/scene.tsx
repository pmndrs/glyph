import { glyph } from '@pmndrs/glyph';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { use, useMemo, useRef, useState } from 'react';
import { type PointLight } from 'three/webgpu';

import { INTER } from '../../fonts';
import { HeightTile, useHeightTile } from './components/HeightTile';
import { DEPTH, HOLD, TILE, WORDS } from './config';
import { slabMaterial } from './materials';

/**
 * Relief type. A word is rendered as coverage into a mipmapped tile on a
 * second root; a slab of stone reads that tile as height, rising where the
 * ink is, and bump-lit from the same texture, so a light circling above it
 * shows the letters as carved. The word changes; the slab follows.
 */
const handleReady = glyph.init().then(() => glyph.handle('examples:relief', ThreeConfig));

export default function Relief() {
  const handle = use(handleReady);
  const inter = useMsdf(INTER);
  const tile = useHeightTile();
  const [word, setWord] = useState<string>(WORDS[0]);
  const light = useRef<PointLight>(null);
  const material = useMemo(() => slabMaterial(tile.texture, DEPTH), [tile.texture]);

  useFrame(({ elapsed }) => {
    const next = WORDS[Math.floor(elapsed / HOLD) % WORDS.length] ?? WORDS[0];
    if (next !== word) setWord(next);
    const a = elapsed * 0.7;
    light.current?.position.set(Math.cos(a) * 4.5, 2.2 + Math.sin(a * 0.5) * 0.6, 2.6 + Math.sin(a) * 1.6);
  });

  return (
    <>
      <HeightTile tile={tile} root={handle('tile')} font={inter} word={word} />
      <pointLight ref={light} color="#fff1dc" intensity={12} distance={14} decay={2} />
      <mesh rotation={[-0.35, 0, 0]} material={material}>
        <planeGeometry args={[TILE.width * 0.9, TILE.height * 0.9, 300, 100]} />
      </mesh>
    </>
  );
}
