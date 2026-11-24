import { bitmap, glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

const VT323 = new URL('../../../../docs/assets/fonts/vt323-bitmap.font.glb', import.meta.url).href;

/**
 * The imperative twin, for an orthographic camera whose units are CSS pixels.
 * The strike tuple names the baked raster; `rasterPixelRatio` is the device
 * pixel ratio the text is drawn at, so strike selection sees physical pixels;
 * `pixelSnapping` on the group keeps every vertex on the pixel grid.
 */
export async function mount(scene: Scene, devicePixelRatio = 1): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:fonts-bitmap-strikes', ThreeConfig);
  const Pixel = glyph.fontFace(VT323, { format: bitmap({ strikes: [16, 24, 32] }) });
  await Pixel.load();

  const snapped = three.createTextGroup({ pixelSnapping: true });
  const rows = [16, 20, 24, 28, 32, 48].map((fontSize, index) => {
    const row = three.createText({
      font: Pixel.bitmap,
      text: `fontSize ${fontSize}`,
      style: { fontSize, color: '#e7ecf6', lineHeight: 1 },
      layout: { wrap: 'none' },
      rasterPixelRatio: devicePixelRatio,
    });
    row.position.set(-300, 160 - index * 56, 0);
    snapped.add(row);
    return row;
  });
  scene.add(snapped);
  glyph.shape();

  return () => {
    for (const row of rows) row.dispose();
    snapped.dispose();
    Pixel.dispose();
    three.dispose();
  };
}
