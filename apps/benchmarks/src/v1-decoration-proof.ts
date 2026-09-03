import * as THREE from 'three/webgpu';

export const V1_DECORATION_COLOR = '#7dd3fc';

export interface V1RasterPixelCounts {
  readonly decorationPixels: number;
  readonly litPixels: number;
}

/** Count visible output and the cyan decoration paint used by every target-v1 raster proof. */
export function countV1RasterPixels(pixels: ArrayLike<number>): V1RasterPixelCounts {
  let decorationPixels = 0;
  let litPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset]! > 8 || pixels[offset + 1]! > 8 || pixels[offset + 2]! > 8) litPixels += 1;
    if (pixels[offset + 2]! > pixels[offset]! + 32 && pixels[offset + 1]! > pixels[offset]!) {
      decorationPixels += 1;
    }
  }
  return { decorationPixels, litPixels };
}

/** Count analytical decoration instances without depending on their position in the ordered draw list. */
export function countV1DecorationRecords(draws: readonly THREE.Mesh[]): number {
  return draws
    .filter((draw) => draw.userData.pmndrsGlyphPrimitiveKind === 'decoration')
    .reduce((count, draw) => {
      if (!(draw.geometry instanceof THREE.InstancedBufferGeometry)) {
        throw new TypeError('decoration proof draw must use instanced geometry');
      }
      return count + draw.geometry.instanceCount;
    }, 0);
}

/** Select the glyph draw when paint ordering places an under-decoration first. */
export function v1GlyphDraw(draws: readonly THREE.Mesh[]): THREE.Mesh | undefined {
  return draws.find((draw) => draw.userData.pmndrsGlyphPrimitiveKind === 'glyph');
}
