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
} from '@pmndrs/glyph/typegpu/bitmap';
import { msdfAtlasSizeAccessor, msdfFragment, msdfPixelRangeAccessor, msdfSampleSlot } from '@pmndrs/glyph/typegpu';

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
