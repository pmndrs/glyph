import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { LONG_PROSE } from '../layout-kit/prose';
import { COLUMNS, WIDTH } from './scene';

/**
 * The imperative twin. Columns need an exact width, which fixes the column
 * measure, and a stated height, which is where one column ends and the next
 * begins.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-columns', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const text = three.createText({
    font: inter,
    text: LONG_PROSE,
    style: { fontSize: 0.21, lineHeight: 1.35, color: '#e7ecf6' },
    layout: { columns: COLUMNS },
    constraints: { width: { mode: 'exact', size: WIDTH }, height: { mode: 'exact', size: 2.4 } },
  });
  text.position.set(-WIDTH / 2, 2.2, 0);
  scene.add(text);
  const { overflowed } = text.measure(); // true when the last column could not hold the rest
  void overflowed;
  glyph.shape();

  return () => {
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
