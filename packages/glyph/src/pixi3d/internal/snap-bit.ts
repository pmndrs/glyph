import type { ShaderBit } from '@pixi/3d';

import { snapGlsl, snapWgsl } from '../generated/shaders.js';

/**
 * Rounds the projected position onto whole physical pixels after PixiJS 3D's own transform: the rule Three's snapped
 * Bitmap quads follow, through the same generated `snapClipAxis`. A pixel-snapped text appends it to its Bitmap bits;
 * an unsnapped text never compiles it. PixiJS 3D 0.1.0 exposes the physical pass viewport only through the light grid
 * (`16 / width`, `±9 / height`), as Slug's dilation reads it; the reciprocal is rounded back to the whole pixel count
 * it came from.
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

/**
 * A pixel-snapped text's decoration corner: inline as a snapped glyph corner, block from its line's snapped baseline
 * plus the rectangle's offset and thickness each rounded (the generated `snapDecorationClipAxis`), so the decoration
 * keeps one whole-pixel distance from the text's snapped glyphs. `aGlyphDecorationSnap` holds the rectangle's top,
 * bottom and baseline in paragraph space (+Y down) and 1 for a bottom corner.
 */
export const glyphDecorationPixelSnapBit: ShaderBit = {
  name: 'pmndrsGlyphDecorationPixelSnap',
  attributes: { aGlyphDecorationSnap: 'float32x4' },
  gpu: {
    header: snapWgsl,
    vertex: {
      afterTransform: `
  let glyphSnapViewport = round(vec2<f32>(16.0, 9.0) / abs(camera.uLightTileTransform.xy));
  let glyphSnapProjection = camera.uViewProjectionMatrix * modelMatrix;
  let glyphSnapTop = glyphSnapProjection * vec4<f32>(position.x, -input.aGlyphDecorationSnap.x, 0.0, 1.0);
  let glyphSnapBottom = glyphSnapProjection * vec4<f32>(position.x, -input.aGlyphDecorationSnap.y, 0.0, 1.0);
  let glyphSnapBaseline = glyphSnapProjection * vec4<f32>(position.x, -input.aGlyphDecorationSnap.z, 0.0, 1.0);
  clipPosition = vec4<f32>(
    glyphSnapClipAxis(clipPosition.x, clipPosition.w, glyphSnapViewport.x),
    glyphSnapDecorationClipAxis(glyphSnapTop.yw, glyphSnapBottom.yw, glyphSnapBaseline.yw, input.aGlyphDecorationSnap.w, clipPosition.w, glyphSnapViewport.y),
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
  mat4 glyphSnapProjection = uViewProjectionMatrix * modelMatrix;
  vec4 glyphSnapTop = glyphSnapProjection * vec4(position.x, -aGlyphDecorationSnap.x, 0.0, 1.0);
  vec4 glyphSnapBottom = glyphSnapProjection * vec4(position.x, -aGlyphDecorationSnap.y, 0.0, 1.0);
  vec4 glyphSnapBaseline = glyphSnapProjection * vec4(position.x, -aGlyphDecorationSnap.z, 0.0, 1.0);
  gl_Position = vec4(
    glyphSnapClipAxis(gl_Position.x, gl_Position.w, glyphSnapViewport.x),
    glyphSnapDecorationClipAxis(glyphSnapTop.yw, glyphSnapBottom.yw, glyphSnapBaseline.yw, aGlyphDecorationSnap.w, gl_Position.w, glyphSnapViewport.y),
    gl_Position.z,
    gl_Position.w
  );
`,
    },
  },
};
