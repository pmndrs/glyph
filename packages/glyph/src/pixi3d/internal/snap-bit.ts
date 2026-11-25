import type { ShaderBit } from '@pixi/3d';

import { snapGlsl, snapWgsl } from '../generated/shaders.js';

/**
 * Rounds the projected position onto whole physical pixels after PixiJS 3D's own transform: the rule Three's snapped
 * Bitmap quads follow, through the same generated `snapClipAxis`. A pixel-snapped text appends it to its Bitmap and
 * decoration bits; an unsnapped text never compiles it. PixiJS 3D 0.1.0 exposes the physical pass viewport only through
 * the light grid (`16 / width`, `±9 / height`), as Slug's dilation reads it; the reciprocal is rounded back to the
 * whole pixel count it came from.
 */
export const glyphPixelSnapBit: ShaderBit = {
  name: 'pmndrsGlyphPixelSnap',
  gpu: {
    header: snapWgsl,
    vertex: {
      afterTransform: `
  let glyphSnapViewport = round(vec2<f32>(16.0, 9.0) / abs(camera.uLightTileTransform.xy));
  clipPosition = vec4<f32>(
    glyphSnapClipAxis(clipPosition.x, clipPosition.w, glyphSnapViewport.x),
    glyphSnapClipAxis(clipPosition.y, clipPosition.w, glyphSnapViewport.y),
    clipPosition.z,
    clipPosition.w
  );
`,
    },
  },
  gl: {
    header: snapGlsl,
    vertex: {
      afterTransform: `
  vec2 glyphSnapViewport = round(vec2(16.0, 9.0) / abs(uLightTileTransform.xy));
  gl_Position = vec4(
    glyphSnapClipAxis(gl_Position.x, gl_Position.w, glyphSnapViewport.x),
    glyphSnapClipAxis(gl_Position.y, gl_Position.w, glyphSnapViewport.y),
    gl_Position.z,
    gl_Position.w
  );
`,
    },
  },
};
