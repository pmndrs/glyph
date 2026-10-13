import { type Font, slug } from '@pmndrs/glyph';
import { defineTextMaterial, type ThreeRoot } from '@pmndrs/glyph/three';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { compiledSlugData } from './workloads/font-assets/compiled-data';
import {
  SLUG_RECTANGLE,
  SLUG_NONLINEAR_FONT_SIZE,
  SLUG_NONLINEAR_WIDTH,
  SLUG_NONLINEAR_QUAD_LEFT,
  SLUG_NONLINEAR_Y_SCALE,
  SLUG_NONLINEAR_QUADRATIC,
  SLUG_NONLINEAR_EDGE_PIXEL,
  SLUG_NONLINEAR_EXPECTED_BYTE,
  SLUG_NONLINEAR_BYTE_BOUND,
} from './slug-nonlinear-fixture';

const material = defineTextMaterial((context) => {
  const result = context.createDefaultMaterial();
  if (context.kind === 'glyph' && context.format === slug.id) {
    const coordinate = context.shader.renderCoordinate;
    const width = SLUG_RECTANGLE.right - SLUG_RECTANGLE.left;
    // Pixel centers are exact; using them isolates coverageAt's nonlinear derivative contract from varying precision.
    const source = TSL.screenCoordinate.x.sub(SLUG_NONLINEAR_QUAD_LEFT).div(SLUG_NONLINEAR_WIDTH);
    result.opacityNode = context.shader.coverageAt(
      TSL.vec2(
        source.add(source.mul(source).mul(SLUG_NONLINEAR_QUADRATIC)).mul(width).add(SLUG_RECTANGLE.left),
        coordinate.y,
      ),
    );
  }
  return result;
});

/** Render a nonlinear inverse map through the real material context; the independent oracle is rectangular pixel area. */
export async function renderSlugNonlinearProof(
  root: ThreeRoot,
  renderer: THREE.WebGPURenderer,
  target: THREE.RenderTarget,
  scene: THREE.Scene,
  camera: THREE.Camera,
  font: Font<typeof slug>,
): Promise<{ samples: number; maxByteDelta: number; byteBound: number }> {
  assertRectangle(font);
  const text = root.createText({
    font,
    text: 'I',
    style: { fontSize: SLUG_NONLINEAR_FONT_SIZE, color: '#ffffff' },
    material,
  });
  try {
    const layout = text.glyphs();
    if (layout.glyphIds.length !== 1 || layout.glyphIds[0] !== SLUG_RECTANGLE.glyph)
      throw new Error('nonlinear Slug probe must shape the authenticated rectangular Inter I');
    // Match the actual planeRect, not only its contour. Half-pixel dilation keeps every vertex on a 1/16-pixel grid.
    // The whole carrier fits inside the target, and sampled rows remain far from both horizontal contours.
    text.scale.y = SLUG_NONLINEAR_Y_SCALE;
    text.position.set(
      SLUG_NONLINEAR_QUAD_LEFT - 128 - layout.x[0]! - SLUG_RECTANGLE.left * SLUG_NONLINEAR_FONT_SIZE,
      (layout.y[0]! - (SLUG_RECTANGLE.top * SLUG_NONLINEAR_FONT_SIZE) / 2) * SLUG_NONLINEAR_Y_SCALE,
      0,
    );
    scene.add(text);
    await renderer.renderAsync(scene, camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
    let maxByteDelta = 0;
    let samples = 0;
    const column = Math.floor(SLUG_NONLINEAR_EDGE_PIXEL);
    for (let row = 60; row < 68; row += 1) {
      // The pixel occupies [96,97]; its intersection with the destination rectangle is exactly .25.
      for (let channel = 0; channel < 3; channel += 1) {
        maxByteDelta = Math.max(
          maxByteDelta,
          Math.abs(pixels[(row * 256 + column) * 4 + channel]! - SLUG_NONLINEAR_EXPECTED_BYTE),
        );
        samples += 1;
      }
      if (pixels[(row * 256 + column - 1) * 4]! !== 255 || pixels[(row * 256 + column + 1) * 4]! !== 0)
        throw new Error('nonlinear Slug edge phase did not establish adjacent filled and empty pixels');
    }
    return { samples, maxByteDelta, byteBound: SLUG_NONLINEAR_BYTE_BOUND };
  } finally {
    text.removeFromParent();
    text.dispose();
  }
}

function assertRectangle(font: Font<typeof slug>): void {
  const data = compiledSlugData(font);
  const glyph = SLUG_RECTANGLE.glyph;
  if (
    data.glyphs.planeLeft[glyph]! / data.planeUnitsPerEm !== SLUG_RECTANGLE.left ||
    data.glyphs.planeRight[glyph]! / data.planeUnitsPerEm !== SLUG_RECTANGLE.right ||
    data.glyphs.planeBottom[glyph] !== 0 ||
    data.glyphs.planeTop[glyph]! / data.planeUnitsPerEm !== SLUG_RECTANGLE.top
  )
    throw new Error('authenticated Inter I planeRect does not match the oracle carrier');
  const page = data.pages[data.glyphs.page[glyph]!];
  if (page === undefined) throw new Error('nonlinear Slug rectangle page is missing');
  const header = new DataView(page.headerBytes.buffer, page.headerBytes.byteOffset, page.headerBytes.byteLength);
  const reference = new DataView(
    page.referenceBytes.buffer,
    page.referenceBytes.byteOffset,
    page.referenceBytes.byteLength,
  );
  const curve = new DataView(page.curveBytes.buffer, page.curveBytes.byteOffset, page.curveBytes.byteLength);
  const references = new Set<number>();
  for (const [base, count] of [
    [data.glyphs.horizontalHeaderBase[glyph]!, data.glyphs.horizontalBands[glyph]!],
    [data.glyphs.verticalHeaderBase[glyph]!, data.glyphs.verticalBands[glyph]!],
  ] as const) {
    for (let band = 0; band < count; band += 1) {
      const word = header.getUint32((base + band) * 4, true);
      for (let index = 0; index < word >>> 16; index += 1)
        references.add(reference.getUint16((data.glyphs.referenceBase[glyph]! + (word & 0xffff) + index) * 2, true));
    }
  }
  const { left, right, top } = SLUG_RECTANGLE;
  const expected = [
    [right, top, right, top / 2, right, 0],
    [right, 0, (left + right) / 2, 0, left, 0],
    [left, 0, left, top / 2, left, top],
    [left, top, (left + right) / 2, top, right, top],
  ];
  const actual = [...references]
    .sort((a, b) => a - b)
    .map((offset) =>
      Array.from({ length: 6 }, (_, index) =>
        THREE.DataUtils.fromHalfFloat(curve.getUint16((data.glyphs.curveBase[glyph]! + offset) * 8 + index * 2, true)),
      ),
    );
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('authenticated Inter I is not the oracle rectangle');
}
