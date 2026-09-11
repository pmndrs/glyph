import type { Text } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

export type RasterFormatName = 'bitmap' | 'msdf' | 'slug';

export const RASTER_FORMATS: readonly RasterFormatName[] = ['bitmap', 'msdf', 'slug'];
export const COLORS: Readonly<Record<RasterFormatName, string>> = {
  bitmap: '#f59e0b',
  msdf: '#fb7185',
  slug: '#ff4dc4',
};
/** Font Awesome "globe" (U+F0AC); the checked icon GLB bakes only a few globe variants. */
export const WORLD_ICON = '\uf0ac';

interface PlaygroundState {
  scene: Scene | undefined;
  hello: () => Text<import('@pmndrs/glyph').RasterFormatMetadata> | undefined;
  format: () => RasterFormatName;
}

/** Live state the browser probe reads. */
export const playground: PlaygroundState = {
  scene: undefined,
  hello: () => undefined,
  format: () => 'msdf',
};
