import tgpu from 'typegpu';
import * as d from 'typegpu/data';

import {
  bitmapFragment,
  bitmapCoverageSlot,
  bitmapVertex,
  bitmapVertexSnapped,
  type TypeGpuBitmapFragmentInput,
  type TypeGpuBitmapFragmentOutput,
  type TypeGpuBitmapInstance,
  type TypeGpuBitmapVertexInput,
  type TypeGpuBitmapVertexOutput,
} from '@pmndrs/glyph/shaders/typegpu/bitmap';
import {
  msdfAtlasSizeAccessor,
  msdfFragment,
  msdfPixelRangeAccessor,
  msdfSampleSlot,
} from '@pmndrs/glyph/shaders/typegpu';

// The technique-specific TypeGPU subpath is importable without any renderer, so a
// WebGPU host pays only for the realization it selects.
declare const vertexInput: TypeGpuBitmapVertexInput;
const vertexOut: TypeGpuBitmapVertexOutput = bitmapVertex(vertexInput);
const snappedOut: TypeGpuBitmapVertexOutput = bitmapVertexSnapped(vertexInput);
void vertexOut.position;
void snappedOut.clipPosition;

declare const fragmentInput: TypeGpuBitmapFragmentInput;
const fragmentOut: TypeGpuBitmapFragmentOutput = bitmapFragment(fragmentInput);
void fragmentOut.coverage;
void fragmentOut.opacity;

// The stages are exact typed functions: their schemas are inspectable GPU data and the
// functions resolve to WGSL through TypeGPU, so a host can bind and compose them.
const instanceSchema: d.WgslStruct = null as unknown as typeof TypeGpuBitmapInstance;
void instanceSchema;

const vertexStage: typeof bitmapVertex = bitmapVertex;
void vertexStage;

// Resource ownership is supplied by the consumer: functions go through slots, while
// literal/uniform/buffer/function values go through schema-aware accessors.
const bitmapCoverage = tgpu.fn([d.vec2f, d.u32], d.f32)`(coordinate, layer) { return coordinate.x + f32(layer); }`;
bitmapFragment.with(bitmapCoverageSlot, bitmapCoverage);

const msdfSample = tgpu.fn([d.vec2f, d.u32], d.vec4f)`(coordinate, layer) {
  return vec4f(coordinate, f32(layer), 1.0);
}`;
msdfFragment
  .with(msdfSampleSlot, msdfSample)
  .with(msdfAtlasSizeAccessor, d.vec2f(1024, 1024))
  .with(msdfPixelRangeAccessor, d.f32(4));

import { glyph, type BorrowedGlyph } from '@pmndrs/glyph';
import { defineTypeGpuConfig, type TypeGpuHandle } from '@pmndrs/glyph/typegpu';
import type { TgpuRoot, TgpuRenderPass } from 'typegpu';
declare const root: TgpuRoot;
declare const pass: TgpuRenderPass;
const handle: TypeGpuHandle = glyph.handle('typegpu:typed', defineTypeGpuConfig({ root, format: 'rgba8unorm' }));
const font = glyph.fontFace('/inter.font.glb');
const text = handle.createText({ font, text: 'Hello', style: { fontSize: 32 }, position: [12, 24] });
text.update({ constraints: { width: { mode: 'at-most', size: 640 } } });
text.measure();
text.glyphs();
const borrowedCluster: number = text.withGlyphs((layout) => {
  layout satisfies import('@pmndrs/glyph/typegpu').BorrowedGlyphLayout;
  layout.glyphAt(0) satisfies BorrowedGlyph;
  return layout.glyphAt(0).cluster;
});
void borrowedCluster;
handle.draw(pass, { width: 640, height: 320 });
handle('overlay').draw(pass, { width: 640, height: 320 });
// @ts-expect-error Decoration lines are not part of the TypeGPU integration yet.
text.update({ style: { decoration: { underline: true } } });
// @ts-expect-error A shader function cannot be imported from the application integration.
import { bitmapVertex as applicationShader } from '@pmndrs/glyph/typegpu';
void applicationShader;

const modelViewProjection = root.createUniform(d.mat4x4f);
const tint = root.createUniform(d.vec3f, [1, 0, 1]);
defineTypeGpuConfig({
  root,
  format: 'rgba8unorm',
  depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  transformPosition: (position, viewport) => {
    'use gpu';
    return modelViewProjection.$.mul(d.vec4f(position.div(d.vec3f(viewport, 1)), 1));
  },
  transformColor: (color, fragmentPosition) => {
    'use gpu';
    return d.vec4f(color.rgb.mul(tint.$), color.a * fragmentPosition.w);
  },
});
defineTypeGpuConfig({
  root,
  format: 'rgba8unorm',
  // @ts-expect-error Position callbacks must preserve homogeneous clip coordinates.
  transformPosition: (position) => position,
});
defineTypeGpuConfig({
  root,
  format: 'rgba8unorm',
  // @ts-expect-error Color callbacks must return RGBA, including coverage.
  transformColor: (color) => color.rgb,
});

const cameraLayout = tgpu.bindGroupLayout({ matrix: { uniform: d.mat4x4f } });
const paintLayout = tgpu.bindGroupLayout({ tint: { uniform: d.vec3f } });
const cameraGroup = root.createBindGroup(cameraLayout, { matrix: modelViewProjection });
const paintGroup = root.createBindGroup(paintLayout, { tint });
const bound: import('@pmndrs/glyph/typegpu').TypeGpuDraw = handle.with(cameraGroup).with(paintGroup);
bound.draw(pass, { width: 640, height: 320 });
handle('overlay').with(cameraGroup).draw(pass, { width: 640, height: 320 });
// @ts-expect-error with() accepts a TypeGPU bind group, not its layout.
handle.with(cameraLayout);
// @ts-expect-error A bound draw view does not create or own text.
bound.createText({ font, text: 'Hello' });
