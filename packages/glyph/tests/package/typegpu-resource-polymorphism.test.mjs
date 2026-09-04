import assert from 'node:assert/strict';
import test from 'node:test';

import tgpu from 'typegpu';
import * as d from 'typegpu/data';

import {
  bitmapCoverageSlot,
  bitmapFragment,
  msdfAtlasSizeAccessor,
  msdfFragment,
  msdfPixelRangeAccessor,
  msdfSampleSlot,
  slugCurveTexelSlot,
  slugCurveWidthAccessor,
  slugHeaderTexelSlot,
  slugHeaderWidthAccessor,
  slugReferenceTexelSlot,
  slugReferenceWidthAccessor,
  slugRenderWithOptions,
  SlugShaderGlyph,
} from '../../dist/typegpu.js';

test('Bitmap coverage can come from a consumer function without a texture binding', () => {
  const coverage = tgpu.fn([d.vec2f, d.u32], d.f32)`(coordinate, layer) {
    return coordinate.x + f32(layer);
  }`;
  const source = tgpu.resolve([bitmapFragment.with(bitmapCoverageSlot, coverage)]);
  assert.match(source, /fn item\(/);
  assert.doesNotMatch(source, /texture_2d|textureLoad/);
});

test('MTSDF resources can be supplied through slots and accessors', () => {
  const sample = tgpu.fn([d.vec2f, d.u32], d.vec4f)`(coordinate, layer) {
    return vec4f(coordinate, f32(layer), 1.0);
  }`;
  const configured = msdfFragment
    .with(msdfSampleSlot, sample)
    .with(msdfAtlasSizeAccessor, d.vec2f(64, 32))
    .with(msdfPixelRangeAccessor, d.f32(4));
  const source = tgpu.resolve([configured]);
  assert.match(source, /fn item\(/);
  assert.doesNotMatch(source, /texture_2d|textureSample/);
});

test('Slug page data can come from consumer functions with accessor-provided widths', () => {
  const curve = tgpu.fn([d.vec2i], d.vec4f)`(coordinate) { return vec4f(vec2f(coordinate), 0.0, 0.0); }`;
  const integer = tgpu.fn([d.vec2i], d.vec4u)`(coordinate) { return vec4u(vec2u(coordinate), 0u, 0u); }`;
  const configured = tgpu
    .fn(slugRenderWithOptions)
    .with(slugCurveTexelSlot, curve)
    .with(slugHeaderTexelSlot, integer)
    .with(slugReferenceTexelSlot, integer)
    .with(slugCurveWidthAccessor, d.u32(64))
    .with(slugHeaderWidthAccessor, d.u32(32))
    .with(slugReferenceWidthAccessor, d.u32(16));
  const shader = tgpu.fn([SlugShaderGlyph, d.vec2f, d.bool, d.bool, d.f32, d.f32], d.f32)(configured);
  const source = tgpu.resolve([shader]);
  assert.match(source, /fn slugRenderWithOptions\(/);
  assert.doesNotMatch(source, /texture_2d|textureLoad/);
});
