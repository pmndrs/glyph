import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import type { Scene } from 'three/webgpu';

import { CHORUS_MSDF } from '../../fonts';
import { rowAt, urlFor } from './config';

/**
 * The imperative twin. A hook is a face declared on the handle plus a wait
 * for its load: `preload` is `face.load()` started early, and a component
 * that renders before the load resolves is a `createText` on a face that is
 * not loaded, which throws FONT_FACE_FORMAT_NOT_LOADED instead of suspending.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:hooks', ThreeConfig);
  const row = rowAt(0);

  // Cold: declare, then wait for the load where the text is needed.
  const cold = glyph.fontFace(urlFor(row, 'cold', 0), { format: msdf(CHORUS_MSDF) });
  await cold.load();
  const a = three.createText({
    font: cold,
    text: row.word,
    style: { fontSize: 1.1, color: '#e7ecf6' },
    layout: { wrap: 'none' },
  });
  a.position.set(-5.2, 0.9, 0);

  // Warm: the load was started earlier, so the await here resolves at once.
  const warm = glyph.fontFace(urlFor(row, 'warm', 0), { format: msdf(CHORUS_MSDF) });
  const warming = warm.load();
  // ... later, where the text is created:
  await warming;
  const b = three.createText({
    font: warm,
    text: row.word,
    style: { fontSize: 1.1, color: '#e7ecf6' },
    layout: { wrap: 'none' },
  });
  b.position.set(0.4, 0.9, 0);

  scene.add(a, b);
  glyph.shape();

  return () => {
    a.dispose();
    b.dispose();
    cold.dispose(); // the hook's clear(): release the declaration
    warm.dispose();
    three.dispose();
  };
}
