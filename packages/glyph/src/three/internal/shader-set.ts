import type { bitmapShader, decorationShader, msdfShader, slugShader } from '../../shaders/tsl/index.js';
import type { pixelSnappedDecorationClipPosition } from '../../shaders/tsl/bitmap-shader.js';

export interface ThreeShaderSet {
  readonly bitmapShader: typeof bitmapShader;
  readonly decorationShader: typeof decorationShader;
  readonly msdfShader: typeof msdfShader;
  readonly slugShader: typeof slugShader;
  /** A snapped text's decoration corner, placed from its line's snapped baseline. */
  readonly pixelSnappedDecorationClipPosition: typeof pixelSnappedDecorationClipPosition;
}
