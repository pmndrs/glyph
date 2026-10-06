// Shader sources for the outline-stream spike, in WGSL and GLSL ES 3.00.
//
// Everything except the curve fetch is one text per language, shared by variants A and B: the vertex program and
// dilation, the band walk with the sorted early exit, the root code, the stable quadratic solver with its linear
// path, and Lengyel's weighted coverage. The math follows packages/glyph/src/shaders/typegpu/slug/core/*.ts (itself
// adapted from three-flatland Slug, MIT), which follows Eric Lengyel's reference SlugPixelShader.hlsl and
// SlugVertexShader.hlsl (MIT, see ../reference/).
//
// Variant A reads two RGBA16F texels per curve in em units. Variant B reads three i16 points per curve in font units
// and applies the implied-on-curve rule; its sample coordinate is scaled by unitsPerEm once in the vertex shader
// (uniform `coordScale`), so no per-curve scaling exists in the fragment shader.

/**
 * `diagnostic` variants are rendered and compared but not timed. B-f16 is B rebuilt the way the encoder builds A:
 * diagonal lines bowed by 1/8 font unit (slug-core::line_to_quadratic, as V0) and every point rounded through f16
 * em units. If A matches B-f16, the whole A-B pixel difference is the f16 encoding (plus V0's line bow).
 * @typedef {{ id: string, fetch: 'A' | 'B', line?: 'mid' | 'dup', quantize?: boolean, diagnostic?: boolean,
 *   label: string }} Variant
 */

/** @type {Variant[]} */
export const VARIANTS = [
  { id: 'A', fetch: 'A', label: 'A: RGBA16F curve texels, em' },
  { id: 'B-mid', fetch: 'B', line: 'mid', label: 'B: i16 points, lines {p1, mid, p2}' },
  { id: 'B-dup', fetch: 'B', line: 'dup', label: 'B: i16 points, lines {p1, p2, p2}' },
  { id: 'B-f16', fetch: 'B', line: 'mid', quantize: true, diagnostic: true, label: 'B-f16 (diagnostic, not timed)' },
];

export const TEXTURE_WIDTH = 4096;
export const TEXTURE_WIDTH_LOG2 = 12;
export const MAX_BAND_CURVES = 512;

// ---------------------------------------------------------------------------------------------------------------
// WGSL

const WGSL_COMMON = /* wgsl */ `
struct Uniforms {
  row0: vec4f,
  row1: vec4f,
  row3: vec4f,
  viewport: vec2f,
  coordScale: f32,
  pad: f32,
};

struct Curve { p0: vec2f, p1: vec2f, p2: vec2f };

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> bandHeaders: array<u32>;
@group(0) @binding(2) var<storage, read> bandRefs: array<u32>;
`;

const WGSL_CORE = /* wgsl */ `
struct VertexInput {
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) rect: vec4f,
  @location(1) em: vec4f,
  @location(2) band: vec4f,
  @location(3) inverseScale: f32,
  @location(4) glyph: vec4u,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) renderCoord: vec2f,
  @location(1) @interpolate(flat) band: vec4f,
  @location(2) @interpolate(flat) glyph: vec4u,
};

fn slugDilate(position: vec2f, outwardNormal: vec2f, texCoord: vec2f, inverseScale: f32) -> vec4f {
  let normal = normalize(outwardNormal);
  let homogeneousW = dot(u.row3.xy, position) + u.row3.w;
  let wGradient = dot(u.row3.xy, normal);
  let projectedX = (homogeneousW * dot(u.row0.xy, normal) - wGradient * (dot(u.row0.xy, position) + u.row0.w)) * u.viewport.x;
  let projectedY = (homogeneousW * dot(u.row1.xy, normal) - wGradient * (dot(u.row1.xy, position) + u.row1.w)) * u.viewport.y;
  let squaredW = homogeneousW * homogeneousW;
  let lengthSquared = projectedX * projectedX + projectedY * projectedY;
  let denominator = lengthSquared - squaredW * wGradient * wGradient;
  let distance = (squaredW * (homogeneousW * wGradient + sqrt(lengthSquared))) / denominator;
  let offset = distance * normal;
  return vec4f(position + offset, texCoord + inverseScale * offset);
}

@vertex
fn vs(input: VertexInput) -> VertexOutput {
  let local = vec2f(f32(input.vertexIndex & 1u), f32(input.vertexIndex >> 1u));
  let position = vec2f(input.rect.x + local.x * input.rect.z, -(input.rect.y + local.y * input.rect.w));
  let outwardNormal = vec2f((local.x - 0.5) * input.rect.z, -(local.y - 0.5) * input.rect.w);
  let emCoord = vec2f(input.em.x + local.x * input.em.z, input.em.y - local.y * input.em.w);
  let dilated = slugDilate(position, outwardNormal, emCoord, input.inverseScale);
  var output: VertexOutput;
  output.position = vec4f(
    dot(u.row0.xy, dilated.xy) + u.row0.w,
    dot(u.row1.xy, dilated.xy) + u.row1.w,
    0.0,
    dot(u.row3.xy, dilated.xy) + u.row3.w,
  );
  output.renderCoord = dilated.zw * u.coordScale;
  output.band = vec4f(input.band.xy / u.coordScale, input.band.zw);
  output.glyph = input.glyph;
  return output;
}

fn bandRef(index: u32) -> u32 {
  return (bandRefs[index >> 1u] >> ((index & 1u) * 16u)) & 0xffffu;
}

fn calcRootCode(y1: f32, y2: f32, y3: f32) -> u32 {
  let shift = select(0u, 1u, y1 < 0.0) | (select(0u, 1u, y2 < 0.0) << 1u) | (select(0u, 1u, y3 < 0.0) << 2u);
  return (0x2e74u >> shift) & 0x0101u;
}

fn stableRoots(a: f32, b: f32, c: f32) -> vec2f {
  let discriminant = b * b - a * c;
  var t1 = 0.0;
  var t2 = 0.0;
  if (abs(a) < 1.0 / 65536.0) {
    let linearRoot = c / (b * 2.0);
    t1 = linearRoot;
    t2 = linearRoot;
  } else if (discriminant <= 0.0) {
    let extremum = b / a;
    t1 = extremum;
    t2 = extremum;
  } else {
    let distance = sqrt(discriminant);
    let positive = b >= 0.0;
    let q = b + select(-1.0, 1.0, positive) * distance;
    let rootA = q / a;
    let rootB = c / q;
    t1 = select(rootA, rootB, positive);
    t2 = select(rootB, rootA, positive);
  }
  return vec2f(t1, t2);
}

fn solveHorizontal(p0: vec2f, p1: vec2f, p2: vec2f) -> vec2f {
  let roots = stableRoots(p0.y - p1.y * 2.0 + p2.y, p0.y - p1.y, p0.y);
  let a = p0.x - p1.x * 2.0 + p2.x;
  let b = p0.x - p1.x;
  return vec2f((a * roots.x - b * 2.0) * roots.x + p0.x, (a * roots.y - b * 2.0) * roots.y + p0.x);
}

// One curve's contribution in the ray frame (+x ray through y = 0): (coverage delta, weight, max ray-axis pixels).
fn curveContribution(p0: vec2f, p1: vec2f, p2: vec2f, pixelsPerUnit: f32) -> vec3f {
  let maximum = max(max(p0.x, p1.x), p2.x) * pixelsPerUnit;
  if (maximum < -0.5) {
    return vec3f(0.0, 0.0, maximum);
  }
  let code = calcRootCode(p0.y, p1.y, p2.y);
  var coverage = 0.0;
  var weight = 0.0;
  if (code > 0u) {
    let roots = solveHorizontal(p0, p1, p2) * pixelsPerUnit;
    let hasFirst = (code & 1u) > 0u;
    let hasSecond = (code & 0x100u) > 0u;
    coverage = select(0.0, saturate(roots.x + 0.5), hasFirst) - select(0.0, saturate(roots.y + 0.5), hasSecond);
    weight = max(
      select(0.0, saturate(1.0 - abs(roots.x) * 2.0), hasFirst),
      select(0.0, saturate(1.0 - abs(roots.y) * 2.0), hasSecond),
    );
  }
  return vec3f(coverage, weight, maximum);
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {
  let rc = input.renderCoord;
  let unitsPerPixel = fwidth(rc);
  let pixelsPerUnitX = 1.0 / max(unitsPerPixel.x, 1.0 / 65536.0);
  let pixelsPerUnitY = 1.0 / max(unitsPerPixel.y, 1.0 / 65536.0);
  let hCount = input.glyph.w & 0xffffu;
  let vCount = input.glyph.w >> 16u;
  let bandBase = input.glyph.z;

  var xCoverage = 0.0;
  var xWeight = 0.0;
  let hIndex = u32(clamp(rc.y * input.band.y + input.band.w, 0.0, f32(hCount) - 1.0));
  let hHeader = bandHeaders[bandBase + hIndex];
  let hCurves = min(hHeader >> 16u, ${MAX_BAND_CURVES}u);
  let hRefs = bandBase + (hHeader & 0xffffu);
  for (var k = 0u; k < hCurves; k++) {
    let curve = fetchCurve(bandRef(hRefs + k), input.glyph);
    let c = curveContribution(curve.p0 - rc, curve.p1 - rc, curve.p2 - rc, pixelsPerUnitX);
    if (c.z < -0.5) {
      break;
    }
    xCoverage += c.x;
    xWeight = max(xWeight, c.y);
  }

  var yCoverage = 0.0;
  var yWeight = 0.0;
  let vIndex = u32(clamp(rc.x * input.band.x + input.band.z, 0.0, f32(vCount) - 1.0));
  let vHeader = bandHeaders[bandBase + hCount + vIndex];
  let vCurves = min(vHeader >> 16u, ${MAX_BAND_CURVES}u);
  let vRefs = bandBase + (vHeader & 0xffffu);
  for (var k = 0u; k < vCurves; k++) {
    let curve = fetchCurve(bandRef(vRefs + k), input.glyph);
    let c = curveContribution((curve.p0 - rc).yx, (curve.p1 - rc).yx, (curve.p2 - rc).yx, pixelsPerUnitY);
    if (c.z < -0.5) {
      break;
    }
    yCoverage -= c.x;
    yWeight = max(yWeight, c.y);
  }

  let weighted = abs(xCoverage * xWeight + yCoverage * yWeight) / max(xWeight + yWeight, 1.0 / 65536.0);
  let coverage = saturate(max(weighted, min(abs(xCoverage), abs(yCoverage))));
  return vec4f(coverage, coverage, coverage, coverage);
}
`;

const WGSL_FETCH_A = /* wgsl */ `
@group(0) @binding(3) var curveTexture: texture_2d<f32>;

fn curveTexel(index: u32) -> vec4f {
  return textureLoad(curveTexture, vec2i(i32(index & ${TEXTURE_WIDTH - 1}u), i32(index >> ${TEXTURE_WIDTH_LOG2}u)), 0);
}

// Variant A: two RGBA16F texels, (p0, p1) and (p2, next p1), em units.
fn fetchCurve(reference: u32, glyph: vec4u) -> Curve {
  let index = glyph.x + reference;
  let first = curveTexel(index);
  let second = curveTexel(index + 1u);
  return Curve(first.xy, first.zw, second.xy);
}
`;

function wgslFetchB({ line, quantize }) {
  const lineControl = line === 'dup' ? 'next.xy' : '(current.xy + next.xy) * 0.5';
  const q = quantize ? (v) => `unpack2x16float(pack2x16float(${v} / u.coordScale)) * u.coordScale` : (v) => v;
  return /* wgsl */ `
@group(0) @binding(3) var<storage, read> points: array<u32>;
${
  quantize
    ? `
// slug-core::line_to_quadratic in font units: axis-aligned lines keep the midpoint, others bow by 1/8 unit.
fn bowedLineControl(a: vec2f, b: vec2f) -> vec2f {
  let d = b - a;
  let middle = (a + b) * 0.5;
  if (abs(d.x) < 1e-6 || abs(d.y) < 1e-6) {
    return middle;
  }
  return middle + vec2f(-d.y, d.x) * (0.125 / length(d));
}
`
    : ''
}
// One point word: i16 (x << 1) | offCurve in the low half, i16 y in the high half. Returns (x, y, offCurve).
fn outlinePoint(index: u32) -> vec3f {
  let word = points[index];
  return vec3f(f32(bitcast<i32>(word << 16u) >> 17u), f32(bitcast<i32>(word) >> 16u), f32(word & 1u));
}

// Variant B: three point loads and the implied-on-curve rule, font units. The reference names an off-curve point
// (a quadratic with that control) or the first on-curve point of a line.
fn fetchCurve(reference: u32, glyph: vec4u) -> Curve {
  let index = glyph.y + reference;
  let previous = outlinePoint(max(index, 1u) - 1u);
  let current = outlinePoint(index);
  let next = outlinePoint(index + 1u);
  let quadratic = current.z != 0.0;
  let start = select(previous.xy, (previous.xy + current.xy) * 0.5, previous.z != 0.0);
  let end = select(next.xy, (current.xy + next.xy) * 0.5, next.z != 0.0);
  let lineControl = ${quantize ? 'bowedLineControl(current.xy, next.xy)' : lineControl};
  let p0 = select(current.xy, start, quadratic);
  let p1 = select(lineControl, current.xy, quadratic);
  return Curve(${q('p0')}, ${q('p1')}, ${q('end')});
}
`;
}

/** @param {Variant} variant */
export function wgslSource(variant) {
  return WGSL_COMMON + (variant.fetch === 'A' ? WGSL_FETCH_A : wgslFetchB(variant)) + WGSL_CORE;
}

// ---------------------------------------------------------------------------------------------------------------
// GLSL ES 3.00

export const GLSL_VERTEX = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec4 uRow0;
uniform vec4 uRow1;
uniform vec4 uRow3;
uniform vec2 uViewport;
uniform float uCoordScale;

layout(location = 0) in vec4 iRect;
layout(location = 1) in vec4 iEm;
layout(location = 2) in vec4 iBand;
layout(location = 3) in float iInverseScale;
layout(location = 4) in uvec4 iGlyph;

out vec2 vRenderCoord;
flat out vec4 vBand;
flat out uvec4 vGlyph;

vec4 slugDilate(vec2 position, vec2 outwardNormal, vec2 texCoord, float inverseScale) {
  vec2 normal = normalize(outwardNormal);
  float homogeneousW = dot(uRow3.xy, position) + uRow3.w;
  float wGradient = dot(uRow3.xy, normal);
  float projectedX = (homogeneousW * dot(uRow0.xy, normal) - wGradient * (dot(uRow0.xy, position) + uRow0.w)) * uViewport.x;
  float projectedY = (homogeneousW * dot(uRow1.xy, normal) - wGradient * (dot(uRow1.xy, position) + uRow1.w)) * uViewport.y;
  float squaredW = homogeneousW * homogeneousW;
  float lengthSquared = projectedX * projectedX + projectedY * projectedY;
  float denominator = lengthSquared - squaredW * wGradient * wGradient;
  float distance = (squaredW * (homogeneousW * wGradient + sqrt(lengthSquared))) / denominator;
  vec2 offset = distance * normal;
  return vec4(position + offset, texCoord + inverseScale * offset);
}

void main() {
  vec2 local = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 position = vec2(iRect.x + local.x * iRect.z, -(iRect.y + local.y * iRect.w));
  vec2 outwardNormal = vec2((local.x - 0.5) * iRect.z, -(local.y - 0.5) * iRect.w);
  vec2 emCoord = vec2(iEm.x + local.x * iEm.z, iEm.y - local.y * iEm.w);
  vec4 dilated = slugDilate(position, outwardNormal, emCoord, iInverseScale);
  gl_Position = vec4(
    dot(uRow0.xy, dilated.xy) + uRow0.w,
    dot(uRow1.xy, dilated.xy) + uRow1.w,
    0.0,
    dot(uRow3.xy, dilated.xy) + uRow3.w
  );
  vRenderCoord = dilated.zw * uCoordScale;
  vBand = vec4(iBand.xy / uCoordScale, iBand.zw);
  vGlyph = iGlyph;
}
`;

const GLSL_FRAGMENT_HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp isampler2D;

uniform highp usampler2D uBandHeaders;
uniform highp usampler2D uBandRefs;

in vec2 vRenderCoord;
flat in vec4 vBand;
flat in uvec4 vGlyph;
out vec4 outColor;

struct Curve { vec2 p0; vec2 p1; vec2 p2; };

ivec2 texelLocation(uint index) {
  return ivec2(int(index & ${TEXTURE_WIDTH - 1}u), int(index >> ${TEXTURE_WIDTH_LOG2}u));
}
`;

const GLSL_FRAGMENT_CORE = /* glsl */ `
uint bandHeader(uint index) { return texelFetch(uBandHeaders, texelLocation(index), 0).r; }
uint bandRef(uint index) { return texelFetch(uBandRefs, texelLocation(index), 0).r; }

uint calcRootCode(float y1, float y2, float y3) {
  uint shift = (y1 < 0.0 ? 1u : 0u) | ((y2 < 0.0 ? 1u : 0u) << 1u) | ((y3 < 0.0 ? 1u : 0u) << 2u);
  return (0x2e74u >> shift) & 0x0101u;
}

vec2 stableRoots(float a, float b, float c) {
  float discriminant = b * b - a * c;
  float t1 = 0.0;
  float t2 = 0.0;
  if (abs(a) < 1.0 / 65536.0) {
    float linearRoot = c / (b * 2.0);
    t1 = linearRoot;
    t2 = linearRoot;
  } else if (discriminant <= 0.0) {
    float extremum = b / a;
    t1 = extremum;
    t2 = extremum;
  } else {
    float distance = sqrt(discriminant);
    bool positive = b >= 0.0;
    float q = b + (positive ? 1.0 : -1.0) * distance;
    float rootA = q / a;
    float rootB = c / q;
    t1 = positive ? rootB : rootA;
    t2 = positive ? rootA : rootB;
  }
  return vec2(t1, t2);
}

vec2 solveHorizontal(vec2 p0, vec2 p1, vec2 p2) {
  vec2 roots = stableRoots(p0.y - p1.y * 2.0 + p2.y, p0.y - p1.y, p0.y);
  float a = p0.x - p1.x * 2.0 + p2.x;
  float b = p0.x - p1.x;
  return vec2((a * roots.x - b * 2.0) * roots.x + p0.x, (a * roots.y - b * 2.0) * roots.y + p0.x);
}

// One curve's contribution in the ray frame (+x ray through y = 0): (coverage delta, weight, max ray-axis pixels).
vec3 curveContribution(vec2 p0, vec2 p1, vec2 p2, float pixelsPerUnit) {
  float maximum = max(max(p0.x, p1.x), p2.x) * pixelsPerUnit;
  if (maximum < -0.5) return vec3(0.0, 0.0, maximum);
  uint code = calcRootCode(p0.y, p1.y, p2.y);
  float coverage = 0.0;
  float weight = 0.0;
  if (code > 0u) {
    vec2 roots = solveHorizontal(p0, p1, p2) * pixelsPerUnit;
    bool hasFirst = (code & 1u) > 0u;
    bool hasSecond = (code & 0x100u) > 0u;
    coverage = (hasFirst ? clamp(roots.x + 0.5, 0.0, 1.0) : 0.0) - (hasSecond ? clamp(roots.y + 0.5, 0.0, 1.0) : 0.0);
    weight = max(
      hasFirst ? clamp(1.0 - abs(roots.x) * 2.0, 0.0, 1.0) : 0.0,
      hasSecond ? clamp(1.0 - abs(roots.y) * 2.0, 0.0, 1.0) : 0.0
    );
  }
  return vec3(coverage, weight, maximum);
}

void main() {
  vec2 rc = vRenderCoord;
  vec2 unitsPerPixel = fwidth(rc);
  float pixelsPerUnitX = 1.0 / max(unitsPerPixel.x, 1.0 / 65536.0);
  float pixelsPerUnitY = 1.0 / max(unitsPerPixel.y, 1.0 / 65536.0);
  uint hCount = vGlyph.w & 0xffffu;
  uint vCount = vGlyph.w >> 16u;
  uint bandBase = vGlyph.z;

  float xCoverage = 0.0;
  float xWeight = 0.0;
  uint hIndex = uint(clamp(rc.y * vBand.y + vBand.w, 0.0, float(hCount) - 1.0));
  uint hHeader = bandHeader(bandBase + hIndex);
  uint hCurves = min(hHeader >> 16u, ${MAX_BAND_CURVES}u);
  uint hRefs = bandBase + (hHeader & 0xffffu);
  for (uint k = 0u; k < hCurves; k++) {
    Curve curve = fetchCurve(bandRef(hRefs + k), vGlyph);
    vec3 c = curveContribution(curve.p0 - rc, curve.p1 - rc, curve.p2 - rc, pixelsPerUnitX);
    if (c.z < -0.5) break;
    xCoverage += c.x;
    xWeight = max(xWeight, c.y);
  }

  float yCoverage = 0.0;
  float yWeight = 0.0;
  uint vIndex = uint(clamp(rc.x * vBand.x + vBand.z, 0.0, float(vCount) - 1.0));
  uint vHeader = bandHeader(bandBase + hCount + vIndex);
  uint vCurves = min(vHeader >> 16u, ${MAX_BAND_CURVES}u);
  uint vRefs = bandBase + (vHeader & 0xffffu);
  for (uint k = 0u; k < vCurves; k++) {
    Curve curve = fetchCurve(bandRef(vRefs + k), vGlyph);
    vec3 c = curveContribution((curve.p0 - rc).yx, (curve.p1 - rc).yx, (curve.p2 - rc).yx, pixelsPerUnitY);
    if (c.z < -0.5) break;
    yCoverage -= c.x;
    yWeight = max(yWeight, c.y);
  }

  float weighted = abs(xCoverage * xWeight + yCoverage * yWeight) / max(xWeight + yWeight, 1.0 / 65536.0);
  float coverage = clamp(max(weighted, min(abs(xCoverage), abs(yCoverage))), 0.0, 1.0);
  outColor = vec4(coverage);
}
`;

const GLSL_FETCH_A = /* glsl */ `
uniform highp sampler2D uCurves;

// Variant A: two RGBA16F texels, (p0, p1) and (p2, next p1), em units.
Curve fetchCurve(uint reference, uvec4 glyph) {
  uint index = glyph.x + reference;
  vec4 first = texelFetch(uCurves, texelLocation(index), 0);
  vec4 second = texelFetch(uCurves, texelLocation(index + 1u), 0);
  return Curve(first.xy, first.zw, second.xy);
}
`;

function glslFetchB({ line, quantize }) {
  const lineControl = line === 'dup' ? 'next.xy' : '(current.xy + next.xy) * 0.5';
  const q = quantize ? (v) => `unpackHalf2x16(packHalf2x16(${v} / uCoordScale)) * uCoordScale` : (v) => v;
  return /* glsl */ `
uniform highp isampler2D uPoints;
${
  quantize
    ? `uniform highp float uCoordScale;

// slug-core::line_to_quadratic in font units: axis-aligned lines keep the midpoint, others bow by 1/8 unit.
vec2 bowedLineControl(vec2 a, vec2 b) {
  vec2 d = b - a;
  vec2 middle = (a + b) * 0.5;
  if (abs(d.x) < 1e-6 || abs(d.y) < 1e-6) return middle;
  return middle + vec2(-d.y, d.x) * (0.125 / length(d));
}`
    : ''
}

// One RG16I point: x' = (x << 1) | offCurve, y. Returns (x, y, offCurve).
vec3 outlinePoint(uint index) {
  ivec2 word = texelFetch(uPoints, texelLocation(index), 0).xy;
  return vec3(float(word.x >> 1), float(word.y), float(word.x & 1));
}

// Variant B: three point loads and the implied-on-curve rule, font units. The reference names an off-curve point
// (a quadratic with that control) or the first on-curve point of a line.
Curve fetchCurve(uint reference, uvec4 glyph) {
  uint index = glyph.y + reference;
  vec3 previous = outlinePoint(max(index, 1u) - 1u);
  vec3 current = outlinePoint(index);
  vec3 next = outlinePoint(index + 1u);
  bool quadratic = current.z != 0.0;
  vec2 start = previous.z != 0.0 ? (previous.xy + current.xy) * 0.5 : previous.xy;
  vec2 end = next.z != 0.0 ? (current.xy + next.xy) * 0.5 : next.xy;
  vec2 lineControl = ${quantize ? 'bowedLineControl(current.xy, next.xy)' : lineControl};
  vec2 p0 = quadratic ? start : current.xy;
  vec2 p1 = quadratic ? current.xy : lineControl;
  return Curve(${q('p0')}, ${q('p1')}, ${q('end')});
}
`;
}

/** @param {Variant} variant */
export function glslFragmentSource(variant) {
  return GLSL_FRAGMENT_HEAD + (variant.fetch === 'A' ? GLSL_FETCH_A : glslFetchB(variant)) + GLSL_FRAGMENT_CORE;
}
