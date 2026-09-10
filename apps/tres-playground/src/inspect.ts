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
  /** The retained Three paragraph currently showing the greeting, if its fonts have loaded. */
  hello: () => Text<import('@pmndrs/glyph').RasterFormatMetadata> | undefined;
  format: () => RasterFormatName;
}

/** Live state the browser probe reads; the scene publishes it, nothing else depends on it. */
export const playground: PlaygroundState = {
  scene: undefined,
  hello: () => undefined,
  format: () => 'msdf',
};
