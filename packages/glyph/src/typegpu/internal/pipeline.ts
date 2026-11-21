import tgpu, {
  d,
  std,
  type TgpuRoot,
  type TgpuUniform,
  type TgpuRenderPass,
  type TgpuBindGroup,
  type TgpuRenderPipeline,
  type TgpuSlot,
  type WithBinding,
} from 'typegpu';
import type { CodecBufferId } from '../../index.js';
import type { TypeGpuConfigOptions, TypeGpuPositionTransform, TypeGpuColorTransform } from '../config.js';

export interface Draw {
  draw(pass: TgpuRenderPass | GPURenderPassEncoder, bindGroups: readonly TgpuBindGroup[]): void;
  /**
   * Called when a frame commits, after the renderer's retained bytes hold it. `written` names the lanes the frame
   * changed; a draw that derives state from lane contents (the MSDF effect variant) re-reads them here.
   */
  refresh?(written: ReadonlySet<Uint8Array>): void;
}
export interface TypeGpuResource {
  /**
   * `bytes` holds the renderer's retained copy of each lane. It is current only from the frame's commit onwards:
   * read it in `Draw.refresh`, never here.
   */
  prepare(
    buffers: ReadonlyMap<CodecBufferId, GPUBuffer>,
    placementTable: GPUBuffer,
    viewport: TgpuUniform<d.Vec2f>,
    position: TgpuUniform<d.Vec2f>,
    start: number,
    count: number,
    bytes: ReadonlyMap<CodecBufferId, Uint8Array>,
  ): Draw;
  dispose(): void;
}
export type PipelineOptions = TypeGpuConfigOptions;

const defaultPosition: TypeGpuPositionTransform = (position, viewport) => {
  'use gpu';
  return d.vec4f((position.x * 2) / viewport.x - 1, 1 - (position.y * 2) / viewport.y, position.z, 1);
};
const positionTransform = tgpu.slot<TypeGpuPositionTransform>(defaultPosition);
const defaultColor: TypeGpuColorTransform = (color) => {
  'use gpu';
  return d.vec4f(color);
};
export const colorTransform: TgpuSlot<TypeGpuColorTransform> = tgpu.slot<TypeGpuColorTransform>(defaultColor);
export function shaderRoot(options: PipelineOptions): WithBinding {
  return options.root
    .with(positionTransform, options.transformPosition ?? defaultPosition)
    .with(colorTransform, options.transformColor ?? defaultColor);
}

export function corner(index: number): d.v2f {
  'use gpu';
  // Two triangles, top-left origin, no geometry/index allocation.
  const x = index === 1 || index === 4 || index === 5;
  const y = index === 2 || index === 3 || index === 5;
  return d.vec2f(std.select(0, 1, x), std.select(0, 1, y));
}
export function projectWithScene(position: d.v3f, viewport: d.v2f, offset: d.v2f): d.v4f {
  'use gpu';
  const pixel = d.vec2f(position.x, -position.y).add(offset);
  return positionTransform.$(d.vec3f(pixel, position.z), viewport);
}
export function target(options: PipelineOptions): GPUColorTargetState {
  return {
    format: options.format,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    },
  };
}
export function preparedDraw(root: TgpuRoot, pipeline: TgpuRenderPipeline, start: number, count: number): Draw {
  return {
    draw(pass, bindGroups) {
      recordDraw(root, pipeline, pass, bindGroups, start, count);
    },
  };
}
export function recordDraw(
  root: TgpuRoot,
  pipeline: TgpuRenderPipeline,
  pass: TgpuRenderPass | GPURenderPassEncoder,
  bindGroups: readonly TgpuBindGroup[],
  start: number,
  count: number,
): void {
  let bound = pipeline;
  for (const group of bindGroups) bound = bound.with(group);
  bound.with('resourceType' in pass ? root.unwrap(pass) : pass).draw(6, count, 0, start);
}
