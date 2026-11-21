import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  bitmapGlsl,
  bitmapWgsl,
  createGlyphSlugBit,
  createGlyphSlugBits,
  glyphBitmapBit,
  glyphMsdfBit,
  msdfGlsl,
  msdfWgsl,
  slugGlsl,
  slugWgsl,
} from '../dist/index.js';

test('generated Bitmap helpers cover both Pixi3D backends', () => {
  assert.match(bitmapWgsl, /fn glyphBitmapQuadPosition\(/);
  assert.match(bitmapWgsl, /fn glyphBitmapAtlasUv\(/);
  assert.match(bitmapWgsl, /fn glyphBitmapPaintCoverageOpacity\(/);
  assert.match(bitmapGlsl, /vec3 glyphBitmapQuadPosition\(/);
  assert.match(bitmapGlsl, /vec2 glyphBitmapAtlasUv\(/);
  assert.match(bitmapGlsl, /vec2 glyphBitmapPaintCoverageOpacity\(/);
  assert.equal(glyphBitmapBit.gpu?.header, bitmapWgsl);
  assert.equal(glyphBitmapBit.gl?.header, bitmapGlsl);
});

test('generated MTSDF helpers cover both Pixi3D backends', () => {
  assert.match(msdfWgsl, /fn glyphMsdfPosition\(/);
  assert.match(msdfWgsl, /fn glyphMsdfClampedCoordinates\(/);
  assert.match(msdfWgsl, /fn glyphMsdfRender\(/);
  assert.match(msdfGlsl, /vec3 glyphMsdfPosition\(/);
  assert.match(msdfGlsl, /vec4 glyphMsdfClampedCoordinates\(/);
  assert.match(msdfGlsl, /vec4 glyphMsdfRender\(/);
  assert.equal(glyphMsdfBit.gpu?.header, msdfWgsl);
  assert.equal(glyphMsdfBit.gl?.header, msdfGlsl);
});

test('the Slug bit publishes stable coverageAt helpers for composed material bits', () => {
  const bit = createTestSlugBit();
  assert.match(bit.gpu?.header ?? '', /fn glyphSlugCoverageAt\(/);
  assert.match(bit.gl?.header ?? '', /float glyphSlugCoverageAt\(/);
  assert.match(bit.gpu?.fragment?.material ?? '', /glyphSlugCoverageAt\(/);
  assert.match(bit.gl?.fragment?.material ?? '', /glyphSlugCoverageAt\(/);
});

test('split Slug bits evaluate a material-warped coordinate exactly once', () => {
  const { setup, coverage } = createTestSlugBits();
  assert.match(setup.gpu?.fragment?.material ?? '', /var glyphSlugCoordinate/);
  assert.doesNotMatch(setup.gpu?.fragment?.material ?? '', /glyphSlugCoverageAt\(/);
  assert.match(coverage.gpu?.fragment?.material ?? '', /glyphSlugCoverageAt\(\s*glyphSlugCoordinate/);
  assert.equal((coverage.gpu?.fragment?.material ?? '').match(/glyphSlugCoverageAt\(/gu)?.length, 1);
  assert.match(setup.gl?.fragment?.material ?? '', /vec2 glyphSlugCoordinate/);
  assert.doesNotMatch(setup.gl?.fragment?.material ?? '', /glyphSlugCoverageAt\(/);
  assert.match(coverage.gl?.fragment?.material ?? '', /glyphSlugCoverageAt\(\s*glyphSlugCoordinate/);
  assert.equal((coverage.gl?.fragment?.material ?? '').match(/glyphSlugCoverageAt\(/gu)?.length, 1);
});

test('generated Slug helpers read their u32 words through the bit-supplied byte loaders', () => {
  for (const source of [slugWgsl, slugGlsl]) {
    assert.match(source, /glyphSlugLoadHeader\(_coords\)/);
    assert.match(source, /glyphSlugLoadBandCurve\(_coords\)/);
    assert.match(source, /GLYPH_SLUG_HEADER_WIDTH/);
    // Half floats are decoded arithmetically on both backends; WebGL2 has no unpack2x16float spelling.
    assert.doesNotMatch(source, /(?<![A-Za-z_])unpack2x16float\(/);
  }
  assert.match(
    slugWgsl,
    /fn glyphSlugRender\(starts: vec4u, counts: vec2u, bandTransform: vec4f, renderCoordinate: vec2f\) -> f32/,
  );
  assert.match(
    slugGlsl,
    /float glyphSlugRender\(uvec4 starts, uvec2 counts, vec4 bandTransform, vec2 renderCoordinate\)/,
  );
  const bit = createTestSlugBit();
  assert.match(bit.gpu?.header ?? '', /const GLYPH_SLUG_HEADER_WIDTH: u32 = 8u;/);
  assert.match(bit.gl?.header ?? '', /const uint GLYPH_SLUG_HEADER_WIDTH = 8u;/);
  assert.match(bit.gpu?.header ?? '', /bytes\.x \| \(bytes\.y << 8u\) \| \(bytes\.z << 16u\) \| \(bytes\.w << 24u\)/);
  assert.match(bit.gl?.header ?? '', /bytes\.x \| \(bytes\.y << 8u\) \| \(bytes\.z << 16u\) \| \(bytes\.w << 24u\)/);
});

function createTestSlugBit() {
  return createGlyphSlugBit(testSlugPage());
}

function createTestSlugBits() {
  return createGlyphSlugBits(testSlugPage());
}

function testSlugPage() {
  return {
    headerSize: [8, 4],
    bandCurveSize: [3072, 1],
  };
}

test('the shipped entry has no TypeGPU runtime import', async () => {
  const source = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  const bit = await readFile(new URL('../dist/bitmap-bit.js', import.meta.url), 'utf8');
  const msdfBit = await readFile(new URL('../dist/msdf-bit.js', import.meta.url), 'utf8');
  const slugBit = await readFile(new URL('../dist/slug-bit.js', import.meta.url), 'utf8');
  const generated = await readFile(new URL('../dist/generated/shaders.js', import.meta.url), 'utf8');
  const shipped = `${source}\n${bit}\n${msdfBit}\n${slugBit}\n${generated}`;
  assert.doesNotMatch(shipped, /from\s+["'](?:typegpu|@typegpu\/)/);
  assert.doesNotMatch(shipped, /__TYPEGPU_META__|use gpu/);
});
