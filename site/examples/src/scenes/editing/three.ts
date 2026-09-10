import { glyph, txt } from '@pmndrs/glyph';
import { ThreeConfig, span } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { FONT_SIZE } from './config';

/**
 * The imperative twin. A keystroke assigns the whole string; the text diffs
 * it against the previous one by common prefix and suffix, aligned to
 * Unicode scalars, and sends the engine that one replace. A styled line is
 * restated as a document: there is no offset to patch, so no offset can be
 * wrong.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:editing', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const text = three.createText({
    font: inter,
    text: 'Status: online',
    style: { fontSize: FONT_SIZE, color: '#e7ecf6' },
    layout: { wrap: 'none' },
  });
  text.position.set(-4.7, 0.55, 0);
  scene.add(text);

  // A keystroke: assign the string. The encoder derives the smallest scalar-aligned replace.
  let value = 'Status: online';
  value += ',';
  text.text = value; // the same call as text.set({ text: value })

  // A styled document is restated as a document, never as offsets.
  const state = span({ color: '#4ade80' });
  const number = span({ color: '#ffd166' });
  text.text = txt`Status: ${state`online`}, ${number`3`} nodes, ${number`0`} errors`;

  glyph.shape();
  const commit = text.commitState(); // 'pending' until the renderer accepts the frame, then { status: 'committed', revision }
  void commit;

  return () => {
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
