import type { bitmapShader, decorationShader, msdfShader, slugShader } from '../../shaders/tsl/index.js';

export interface ThreeShaderSet {
  readonly bitmapShader: typeof bitmapShader;
  readonly decorationShader: typeof decorationShader;
  readonly msdfShader: typeof msdfShader;
  readonly slugShader: typeof slugShader;
}
