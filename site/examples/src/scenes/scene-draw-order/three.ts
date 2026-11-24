import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: inside a `TextGroup`, a child's `renderOrder` is its
 * paragraph's rank in the shared batch; the group's own `renderOrder` is the
 * three.js order of that batch among everything else in the scene.
 */
const WORDS = [
  ['one', '#ffd166'],
  ['two', '#70d6ff'],
  ['three', '#ff6b9d'],
] as const;

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:scene-draw-order', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const stack = three.createTextGroup({ renderOrder: 1 });
  const words = WORDS.map(([text, color], index) => {
    const word = three.createText({ font: inter, text, style: { fontSize: 1.5, color, opacity: 0.82 } });
    word.position.set(index * 0.42, -index * 0.62, 0);
    word.renderOrder = index; // the last word is on top
    stack.add(word);
    return word;
  });
  scene.add(stack);
  glyph.shape();

  // Bring the first word to the top: one rank changes, nothing is reshaped.
  words[0]!.renderOrder = WORDS.length;

  return () => {
    for (const word of words) word.dispose();
    stack.dispose();
    inter.dispose();
    three.dispose();
  };
}
