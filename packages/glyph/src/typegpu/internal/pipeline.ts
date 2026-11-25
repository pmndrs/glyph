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
import type { TypeGpuConfigOptions } from '../config.js';

/** What a batched (indexed-transform) program binds: the lanes of one buffer set plus the session tables. */
export interface BatchLanes {
  readonly buffers: ReadonlyMap<CodecBufferId, GPUBuffer>;
  /** The renderer's retained copy of each lane; current only from the frame's commit onwards. */
  readonly bytes: ReadonlyMap<CodecBufferId, Uint8Array>;
  readonly placementTable: GPUBuffer;
  /** One `vec2f` text offset per transform record, indexed by the instance's transformIndex lane. */
  readonly transformTable: GPUBuffer;
  readonly viewport: TgpuUniform<d.Vec2f>;
}
/**
 * One bind group and vertex-buffer set shared by every draw over the same lanes and tables. Draws are instance
 * ranges recorded against it; they own nothing.
 */
export interface BatchDrawBinding {
  /** Lanes whose contents `variant` reads (MSDF effect colors and glyph rows); a write to one re-reads its spans. */
  readonly watchedLanes: readonly Uint8Array[];
  /**
   * The program variant records `[start, start + count)` need. Runs at commit over committed lane bytes, and may
   * prepare what those records draw (MSDF makes their glyphs resident).
   */
  variant(start: number, count: number): number;
  draw(
    pass: TgpuRenderPass | GPURenderPassEncoder,
    bindGroups: readonly TgpuBindGroup[],
    variant: number,
    first: number,
    count: number,
  ): void;
}
export interface TypeGpuResource {
  /** Bindings that draws of many Texts share; every program reads its Text's offset from the transform table. */
  bind(lanes: BatchLanes): BatchDrawBinding;
  dispose(): void;
}
export type PipelineOptions = TypeGpuConfigOptions;

/** How every program calls the callbacks: a config that publishes glyph facts adapts its own to this shape. */
type PositionCall = (position: d.v3f, viewport: d.v2f) => d.v4f;
type ColorCall = (color: d.v4f, fragmentPosition: d.v4f) => d.v4f;

const defaultPosition: PositionCall = (position, viewport) => {
  'use gpu';
  return d.vec4f((position.x * 2) / viewport.x - 1, 1 - (position.y * 2) / viewport.y, position.z, 1);
};
const positionTransform = tgpu.slot<PositionCall>(defaultPosition);
const defaultColor: ColorCall = (color) => {
  'use gpu';
  return d.vec4f(color);
};
export const colorTransform: TgpuSlot<ColorCall> = tgpu.slot<ColorCall>(defaultColor);

/**
 * The glyph a stage is drawing, for a config created with `glyphFacts: true`. Its vertex and fragment entry points
 * write it before anything else runs, and the config's callbacks are called with it. A config without the option
 * compiles none of this: its programs are the ones it had before glyph facts existed.
 */
const GlyphFacts = d.struct({ index: d.u32, origin: d.vec2f });
const drawnGlyph = tgpu.privateVar(GlyphFacts);
/** Records the glyph of the current vertex or fragment; `origin` is in the pixels `transformPosition` receives. */
export function drawGlyph(index: number, origin: d.v2f): void {
  'use gpu';
  drawnGlyph.$ = GlyphFacts({ index, origin });
}
export function publishesGlyphFacts(options: PipelineOptions): boolean {
  return options.glyphFacts === true;
}
function positionCall(options: PipelineOptions): PositionCall {
  const callback = options.transformPosition;
  if (callback === undefined) return defaultPosition;
  if (!publishesGlyphFacts(options)) return callback as PositionCall;
  return (position, viewport) => {
    'use gpu';
    return callback(position, viewport, drawnGlyph.$.index, drawnGlyph.$.origin);
  };
}
function colorCall(options: PipelineOptions): ColorCall {
  const callback = options.transformColor;
  if (callback === undefined) return defaultColor;
  if (!publishesGlyphFacts(options)) return callback as ColorCall;
  return (color, fragmentPosition) => {
    'use gpu';
    return callback(color, fragmentPosition, drawnGlyph.$.index, drawnGlyph.$.origin);
  };
}
export function shaderRoot(options: PipelineOptions): WithBinding {
  return options.root.with(positionTransform, positionCall(options)).with(colorTransform, colorCall(options));
}

export function corner(index: number): d.v2f {
  'use gpu';
  // Two triangles, top-left origin, no geometry/index allocation.
  const x = index === 1 || index === 4 || index === 5;
  const y = index === 2 || index === 3 || index === 5;
  return d.vec2f(std.select(0, 1, x), std.select(0, 1, y));
}
function projectWithScene(position: d.v3f, viewport: d.v2f, offset: d.v2f): d.v4f {
  'use gpu';
  const pixel = d.vec2f(position.x, -position.y).add(offset);
  return positionTransform.$(d.vec3f(pixel, position.z), viewport);
}
/** Session tables every batched program reads: placements, the per-instance transform index and the offsets. */
const scene = tgpu.bindGroupLayout({
  viewport: { uniform: d.vec2f },
  placementSlots: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  placements: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
  transformIndices: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  transforms: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
});
export function createSceneGroup(
  root: TgpuRoot,
  lanes: BatchLanes,
  placementSlots: GPUBuffer,
  transformIndices: GPUBuffer,
): TgpuBindGroup {
  return root.createBindGroup(scene, {
    viewport: lanes.viewport,
    placementSlots,
    placements: lanes.placementTable,
    transformIndices,
    transforms: lanes.transformTable,
  });
}
/** What a batched layout must hold for the scene functions: the session tables and the viewport. */
export interface SceneLayout {
  readonly $: {
    readonly viewport: d.v2f;
    readonly placementSlots: readonly number[];
    readonly placements: readonly d.v2f[];
    readonly transformIndices: readonly number[];
    readonly transforms: readonly d.v2f[];
  };
}
/** The scene reads of one batched layout; MSDF adds its font to its own layout, so it reads through its own. */
export interface SceneFunctions {
  /** An instance's origin moved by its paragraph placement. */
  placedOrigin(origin: d.v2f, instance: number): d.v2f;
  /** The offset of the Text an instance belongs to (its position and anchor), from the transform table. */
  textOffset(instance: number): d.v2f;
  /** The logical viewport the current draw() was given. */
  viewportSize(): d.v2f;
  /** Projects a paragraph-space position (y up) moved by a text offset. */
  projectText(position: d.v3f, offset: d.v2f): d.v4f;
}
export function sceneFunctions(layout: SceneLayout): SceneFunctions {
  return {
    placedOrigin: (origin: d.v2f, instance: number): d.v2f => {
      'use gpu';
      return origin.add(layout.$.placements[layout.$.placementSlots[instance]!]!);
    },
    textOffset: (instance: number): d.v2f => {
      'use gpu';
      return d.vec2f(layout.$.transforms[layout.$.transformIndices[instance]!]!);
    },
    viewportSize: (): d.v2f => {
      'use gpu';
      return d.vec2f(layout.$.viewport);
    },
    projectText: (position: d.v3f, offset: d.v2f): d.v4f => {
      'use gpu';
      return projectWithScene(position, layout.$.viewport, offset);
    },
  };
}
/** Bitmap's scene. */
export const textScene: SceneFunctions = sceneFunctions(scene as unknown as SceneLayout);
export function target(options: PipelineOptions): GPUColorTargetState {
  return {
    format: options.format,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
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
