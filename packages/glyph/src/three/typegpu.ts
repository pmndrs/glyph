export * from '../three.js';
import { createThreeConfig } from './internal/define-config.js';
import type { ThreeConfigOptions, ThreeGlyphConfig } from './handle.js';
import { bitmapShader } from './typegpu/internal/bitmap-shader.js';
export * from './typegpu/internal/bitmap-shader.js';
import { decorationShader } from './typegpu/internal/decoration-shader.js';
export * from './typegpu/internal/decoration-shader.js';
import { msdfShader } from './typegpu/internal/msdf-shader.js';
export * from './typegpu/internal/msdf-shader.js';
import { slugShader } from './typegpu/internal/slug-shader.js';
export * from './typegpu/internal/slug-shader.js';

/** Creates an experimental Three config backed by the shared TypeGPU shaders. */
export function defineThreeConfig(options: ThreeConfigOptions = {}): ThreeGlyphConfig {
  return createThreeConfig(options, { bitmapShader, decorationShader, msdfShader, slugShader });
}

export const ThreeConfig: ThreeGlyphConfig = defineThreeConfig();
