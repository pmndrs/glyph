import * as d from 'typegpu/data';

import {
  bitmapFragment,
  bitmapVertex,
  bitmapVertexSnapped,
  type TypeGpuBitmapFragmentInput,
  type TypeGpuBitmapFragmentOutput,
  type TypeGpuBitmapInstance,
  type TypeGpuBitmapVertexInput,
  type TypeGpuBitmapVertexOutput,
} from '@pmndrs/glyph/typegpu/bitmap';

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
