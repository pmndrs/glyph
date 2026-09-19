import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { glyph, slug } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { solidOf, type Solid } from './outline';

it('builds every title collider from its shaped glyph and keeps the p counter open', async () => {
  await glyph.init();
  const bytes = await readFile(new URL('../../../assets/geist-black.font.glb', import.meta.url));
  const face = glyph.fontFace(new Blob([bytes]), { format: slug });
  const handle = glyph.handle('hero-outline-test', ThreeConfig);

  try {
    await face.load();
    const text = handle.createText({ font: face.slug, text: 'Glyph', style: { fontSize: 4.4 } });
    const layout = text.glyphs();
    const font = 'fonts' in text.font ? text.font.fonts[0] : text.font;
    const solids = [...layout.glyphIds].map((id) => solidOf(font, id, 4.4, 0.8));
    expect(solids).toHaveLength(5);

    for (const solid of solids) {
      expect(solid.prisms.length).toBeGreaterThan(0);
      expect(solid.prisms.every((prism) => prism.every(Number.isFinite))).toBe(true);
      expect(solid.prisms.every((prism) => prism[2] === -0.4 && prism[11] === 0.4)).toBe(true);
    }

    expect(contains(solids[3]!, 0, 0.3)).toBe(false);
    expect(contains(solids[3]!, -0.8, 0)).toBe(true);
  } finally {
    handle.dispose();
    face.dispose();
  }
});

function contains(solid: Solid, x: number, y: number): boolean {
  return solid.prisms.some((prism) => {
    const sides = [0, 3, 6].map((offset) => {
      const next = (offset + 3) % 9;

      return (
        (prism[next]! - prism[offset]!) * (y - prism[offset + 1]!) -
        (prism[next + 1]! - prism[offset + 1]!) * (x - prism[offset]!)
      );
    });

    return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
  });
}
