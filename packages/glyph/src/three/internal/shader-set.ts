import type { Node } from 'three/webgpu';

import type { bitmapShader, decorationShader, msdfShader, slugShader } from '../../shaders/tsl/index.js';

export interface ThreeShaderSet {
  readonly bitmapShader: typeof bitmapShader;
  readonly decorationShader: typeof decorationShader;
  readonly msdfShader: typeof msdfShader;
  readonly slugShader: typeof slugShader;
  /** The model-view-projection rounded onto whole physical pixels, the rule a snapped Bitmap glyph quad follows. */
  readonly pixelSnappedClipPosition: () => Node<'vec4'>;
}
