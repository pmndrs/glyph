import type { ShaderBit } from '@pixi/3d';

import { slugGlsl, slugWgsl } from './generated/shaders.js';
import { SLUG_BAND_CURVE_TEXELS, type Pixi3DSlugResource } from './resource.js';

export interface GlyphSlugBits {
  /** Declares Slug resources and initializes the mutable coverage coordinate for following material bits. */
  readonly setup: ShaderBit;
  /** Evaluates the final coverage coordinate exactly once after following material bits have changed it. */
  readonly coverage: ShaderBit;
}

const cachedBits = new Map<string, GlyphSlugBits>();

/**
 * Pixi-owned texture access around Glyph's build-time generated TypeGPU Slug shader.
 *
 * Put custom coordinate-warp bits between `setup` and `coverage`. Their `material` slot may update
 * `glyphSlugCoordinate`; their `lighting` slot runs after coverage and can change `finalColor` or `alpha`.
 */
export function createGlyphSlugBits(page: Pick<Pixi3DSlugResource, 'headerSize' | 'bandCurveSize'>): GlyphSlugBits {
  const key = `${page.headerSize.join('x')}:${page.bandCurveSize.join('x')}`;
  const cached = cachedBits.get(key);
  if (cached !== undefined) return cached;
  const [headerWidth, headerHeight] = page.headerSize;
  const [curveWidth, curveHeight] = page.bandCurveSize;
  const wgslLoads = `
const GLYPH_SLUG_HEADER_WIDTH: u32 = ${headerWidth}u;
fn glyphSlugWord(texel: vec4<f32>) -> u32 {
  let bytes = vec4<u32>(floor(texel * 255.0 + vec4<f32>(0.5)));
  return bytes.x | (bytes.y << 8u) | (bytes.z << 16u) | (bytes.w << 24u);
}
fn glyphSlugLoadHeader(coords: vec2<i32>) -> vec4<u32> {
  let uv = (vec2<f32>(coords) + vec2<f32>(0.5)) / vec2<f32>(${headerWidth}.0, ${headerHeight}.0);
  return vec4<u32>(glyphSlugWord(sampleGlyphSlugHeadersDirect(uv)), 0u, 0u, 0u);
}
fn glyphSlugBandCurveWord(column: i32, row: i32) -> u32 {
  let uv = (vec2<f32>(f32(column), f32(row)) + vec2<f32>(0.5)) / vec2<f32>(${curveWidth}.0, ${curveHeight}.0);
  return glyphSlugWord(sampleGlyphSlugBandCurvesDirect(uv));
}
fn glyphSlugLoadBandCurve(coords: vec2<i32>) -> vec4<u32> {
  let column = coords.x * ${SLUG_BAND_CURVE_TEXELS};
  return vec4<u32>(
    glyphSlugBandCurveWord(column, coords.y),
    glyphSlugBandCurveWord(column + 1, coords.y),
    glyphSlugBandCurveWord(column + 2, coords.y),
    0u
  );
}
`;
  const glslLoads = `
const uint GLYPH_SLUG_HEADER_WIDTH = ${headerWidth}u;
vec4 sampleGlyphSlugHeadersDirect(vec2 uv);
vec4 sampleGlyphSlugBandCurvesDirect(vec2 uv);
uint glyphSlugWord(vec4 texel) {
  uvec4 bytes = uvec4(floor(texel * 255.0 + vec4(0.5)));
  return bytes.x | (bytes.y << 8u) | (bytes.z << 16u) | (bytes.w << 24u);
}
uvec4 glyphSlugLoadHeader(ivec2 coords) {
  vec2 uv = (vec2(coords) + vec2(0.5)) / vec2(${headerWidth}.0, ${headerHeight}.0);
  return uvec4(glyphSlugWord(sampleGlyphSlugHeadersDirect(uv)), 0u, 0u, 0u);
}
uint glyphSlugBandCurveWord(int column, int row) {
  vec2 uv = (vec2(float(column), float(row)) + vec2(0.5)) / vec2(${curveWidth}.0, ${curveHeight}.0);
  return glyphSlugWord(sampleGlyphSlugBandCurvesDirect(uv));
}
uvec4 glyphSlugLoadBandCurve(ivec2 coords) {
  int column = coords.x * ${SLUG_BAND_CURVE_TEXELS};
  return uvec4(
    glyphSlugBandCurveWord(column, coords.y),
    glyphSlugBandCurveWord(column + 1, coords.y),
    glyphSlugBandCurveWord(column + 2, coords.y),
    0u
  );
}
`;
  // PixiJS 3D 0.1.0's CameraData derives its fixed 16×9 light grid from the live physical pass viewport.
  // Recover that viewport here, keeping dilation per camera/pass without mutable material uniforms.
  const setup: ShaderBit = {
    name: `pmndrsGlyphSlugTypeGpu:setup:${key}`,
    attributes: {
      aGlyphRect: 'float32x4',
      aGlyphPlaneRect: 'float32x4',
      aGlyphBandTransform: 'float32x4',
      aGlyphColor: 'float32x4',
      aGlyphTableStarts: 'uint32x4',
      aGlyphBandCounts: 'uint32x4',
    },
    interStage: {
      vGlyphRenderCoordinate: 'vec2<f32>',
      vGlyphColor: 'vec4<f32>',
      vGlyphBandTransform: 'vec4<f32>',
      vGlyphTableStarts: 'vec4<u32>',
      vGlyphBandCounts: 'vec4<u32>',
    },
    textures: ['glyphSlugHeaders', 'glyphSlugBandCurves'],
    gpu: {
      header: `${wgslLoads}
${slugWgsl}
fn glyphSlugCoverageAt(
  renderCoordinate: vec2<f32>,
  tableStarts: vec4<u32>,
  bandCounts: vec4<u32>,
  bandTransform: vec4<f32>
) -> f32 {
  return glyphSlugRender(tableStarts, bandCounts.xy, bandTransform, renderCoordinate);
}}`,
      vertex: {
        beforeTransform: `
  position = vec4<f32>(input.aGlyphRect.x + input.aPosition.x * input.aGlyphRect.z, -(input.aGlyphRect.y + input.aPosition.y * input.aGlyphRect.w), 0.0, 1.0);
  let glyphCoordinate = vec2<f32>(input.aGlyphPlaneRect.x + input.aUV.x * input.aGlyphPlaneRect.z, input.aGlyphPlaneRect.y - input.aUV.y * input.aGlyphPlaneRect.w);
  let glyphViewport = vec2<f32>(16.0, 9.0) / abs(camera.uLightTileTransform.xy);
  let glyphDilated = glyphSlugDilate(position.xy, vec2<f32>(input.aPosition.x - 0.5, 0.5 - input.aPosition.y), glyphCoordinate, (input.aGlyphPlaneRect.z + input.aGlyphPlaneRect.w) / max(input.aGlyphRect.z + input.aGlyphRect.w, 1e-30), camera.uViewProjectionMatrix * modelMatrix, glyphViewport);
  position = vec4<f32>(glyphDilated.xy, 0.0, 1.0);
`,
        end: `
  output.vGlyphRenderCoordinate = glyphDilated.zw;
  output.vGlyphColor = input.aGlyphColor;
  output.vGlyphBandTransform = input.aGlyphBandTransform;
  output.vGlyphTableStarts = input.aGlyphTableStarts;
  output.vGlyphBandCounts = input.aGlyphBandCounts;
`,
      },
      fragment: {
        material: `
  var glyphSlugCoordinate = input.vGlyphRenderCoordinate;
  albedo = input.vGlyphColor.rgb;
`,
      },
    },
    gl: {
      header: `${glslLoads}
${slugGlsl}
float glyphSlugCoverageAt(
  vec2 renderCoordinate,
  uvec4 tableStarts,
  uvec4 bandCounts,
  vec4 bandTransform
) {
  return glyphSlugRender(tableStarts, bandCounts.xy, bandTransform, renderCoordinate);
}}`,
      vertex: {
        beforeTransform: `
  position = vec4(aGlyphRect.x + aPosition.x * aGlyphRect.z, -(aGlyphRect.y + aPosition.y * aGlyphRect.w), 0.0, 1.0);
  vec2 glyphCoordinate = vec2(aGlyphPlaneRect.x + aUV.x * aGlyphPlaneRect.z, aGlyphPlaneRect.y - aUV.y * aGlyphPlaneRect.w);
  vec2 glyphViewport = vec2(16.0, 9.0) / abs(uLightTileTransform.xy);
  vec4 glyphDilated = glyphSlugDilate(position.xy, vec2(aPosition.x - 0.5, 0.5 - aPosition.y), glyphCoordinate, (aGlyphPlaneRect.z + aGlyphPlaneRect.w) / max(aGlyphRect.z + aGlyphRect.w, 1e-30), uViewProjectionMatrix * modelMatrix, glyphViewport);
  position = vec4(glyphDilated.xy, 0.0, 1.0);
`,
        end: `
  vGlyphRenderCoordinate = glyphDilated.zw;
  vGlyphColor = aGlyphColor;
  vGlyphBandTransform = aGlyphBandTransform;
  vGlyphTableStarts = aGlyphTableStarts;
  vGlyphBandCounts = aGlyphBandCounts;
`,
      },
      fragment: {
        material: `
  vec2 glyphSlugCoordinate = vGlyphRenderCoordinate;
  albedo = vGlyphColor.rgb;
`,
      },
    },
  };

  const coverage: ShaderBit = {
    name: 'pmndrsGlyphSlugTypeGpu:coverage',
    gpu: {
      fragment: {
        material: `
  let glyphCoverage = glyphSlugCoverageAt(
    glyphSlugCoordinate,
    input.vGlyphTableStarts,
    input.vGlyphBandCounts,
    input.vGlyphBandTransform
  );
  alpha = input.vGlyphColor.a * glyphCoverage;
`,
      },
    },
    gl: {
      fragment: {
        material: `
  float glyphCoverage = glyphSlugCoverageAt(
    glyphSlugCoordinate,
    vGlyphTableStarts,
    vGlyphBandCounts,
    vGlyphBandTransform
  );
  alpha = vGlyphColor.a * glyphCoverage;
`,
      },
    },
  };

  const bits = Object.freeze({ setup, coverage });
  cachedBits.set(key, bits);
  return bits;
}

/** Create the canonical single-bit Slug material for direct Pixi3D composition. */
export function createGlyphSlugBit(page: Pick<Pixi3DSlugResource, 'headerSize' | 'bandCurveSize'>): ShaderBit {
  const { setup, coverage } = createGlyphSlugBits(page);
  return {
    ...setup,
    name: `pmndrsGlyphSlugTypeGpu:${page.headerSize.join('x')}:${page.bandCurveSize.join('x')}`,
    gpu: {
      ...setup.gpu,
      fragment: {
        material: `${setup.gpu?.fragment?.material ?? ''}${coverage.gpu?.fragment?.material ?? ''}`,
      },
    },
    gl: {
      ...setup.gl,
      fragment: {
        material: `${setup.gl?.fragment?.material ?? ''}${coverage.gl?.fragment?.material ?? ''}`,
      },
    },
  };
}
