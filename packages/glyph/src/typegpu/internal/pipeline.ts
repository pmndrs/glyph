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
import {
  TYPEGPU_GLYPH_INDEX_BUFFER_ID,
  TYPEGPU_GLYPH_ORIGIN_BUFFER_ID,
  TYPEGPU_PLACEMENT_SLOT_BUFFER_ID,
  TYPEGPU_TRANSFORM_INDEX_BUFFER_ID,
} from './codec.js';

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

/** What a callback is told about the glyph it draws: its layout index and its pen origin in the callback's pixels. */
export const GlyphFacts: d.WgslStruct<{ index: d.U32; origin: d.Vec2f }> = d.struct({
  index: d.u32,
  origin: d.vec2f,
});
export type GlyphFacts = d.Infer<typeof GlyphFacts>;

const defaultPosition: TypeGpuPositionTransform = (position, viewport) => {
  'use gpu';
  return d.vec4f((position.x * 2) / viewport.x - 1, 1 - (position.y * 2) / viewport.y, position.z, 1);
};
const defaultColor: TypeGpuColorTransform = (color) => {
  'use gpu';
  return d.vec4f(color);
};
/**
 * Whether a callback declares the glyph parameters. One that stops at its first two parameters is never told about
 * glyphs, so a config of such callbacks reads no glyph fact and publishes no lane for one.
 */
function declaresGlyphFacts(callback: TypeGpuPositionTransform | TypeGpuColorTransform | undefined): boolean {
  return callback !== undefined && callback.length > 2;
}
/** Whether any callback of a config declares the glyph parameters, so its glyph fact lanes are published. */
export function readsGlyphFacts(options: PipelineOptions): boolean {
  return declaresGlyphFacts(options.transformPosition) || declaresGlyphFacts(options.transformColor);
}
/** Every program calls the callbacks with all four arguments; this adapts one that declares only the first two. */
function positionCallback(callback: TypeGpuPositionTransform): TypeGpuPositionTransform {
  if (declaresGlyphFacts(callback)) return callback;
  const twoArguments = callback as (position: d.v3f, viewport: d.v2f) => d.v4f;
  return (position, viewport, _glyphIndex, _glyphOrigin) => {
    'use gpu';
    return twoArguments(position, viewport);
  };
}
function colorCallback(callback: TypeGpuColorTransform): TypeGpuColorTransform {
  if (declaresGlyphFacts(callback)) return callback;
  const twoArguments = callback as (color: d.v4f, fragmentPosition: d.v4f) => d.v4f;
  return (color, fragmentPosition, _glyphIndex, _glyphOrigin) => {
    'use gpu';
    return twoArguments(color, fragmentPosition);
  };
}
const positionTransform = tgpu.slot<TypeGpuPositionTransform>(positionCallback(defaultPosition));
export const colorTransform: TgpuSlot<TypeGpuColorTransform> = tgpu.slot<TypeGpuColorTransform>(
  colorCallback(defaultColor),
);
/** Compile-time switch: programs of a config that asks for no glyph fact read none and pass zeros. */
const glyphFactsRead = tgpu.slot(false);
export function shaderRoot(options: PipelineOptions): WithBinding {
  return options.root
    .with(positionTransform, positionCallback(options.transformPosition ?? defaultPosition))
    .with(colorTransform, colorCallback(options.transformColor ?? defaultColor))
    .with(glyphFactsRead, readsGlyphFacts(options));
}

export function corner(index: number): d.v2f {
  'use gpu';
  // Two triangles, top-left origin, no geometry/index allocation.
  const x = index === 1 || index === 4 || index === 5;
  const y = index === 2 || index === 3 || index === 5;
  return d.vec2f(std.select(0, 1, x), std.select(0, 1, y));
}
function projectWithScene(position: d.v3f, viewport: d.v2f, offset: d.v2f, glyph: GlyphFacts): d.v4f {
  'use gpu';
  const pixel = d.vec2f(position.x, -position.y).add(offset);
  return positionTransform.$(d.vec3f(pixel, position.z), viewport, glyph.index, glyph.origin);
}
/**
 * Session tables every batched program reads: placements, the per-instance transform index, the offsets, and the
 * glyph fact lanes. A config that publishes no glyph fact lanes binds the placement lanes in their place; its programs
 * never read them.
 */
const scene = tgpu.bindGroupLayout({
  viewport: { uniform: d.vec2f },
  placementSlots: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  placements: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
  transformIndices: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  transforms: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
  glyphIndices: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  glyphOrigins: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
});
/** The buffers behind the session entries of a batched layout, for one buffer set. */
export interface SceneBindings {
  readonly viewport: TgpuUniform<d.Vec2f>;
  readonly placementSlots: GPUBuffer;
  readonly placements: GPUBuffer;
  readonly transformIndices: GPUBuffer;
  readonly transforms: GPUBuffer;
  readonly glyphIndices: GPUBuffer;
  readonly glyphOrigins: GPUBuffer;
}
export function sceneBindings(lanes: BatchLanes): SceneBindings {
  const lane = (id: CodecBufferId): GPUBuffer => {
    const buffer = lanes.buffers.get(id);
    if (buffer === undefined) throw new Error('TypeGPU draw is missing one of its session lanes');
    return buffer;
  };
  const placementSlots = lane(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID);
  return {
    viewport: lanes.viewport,
    placementSlots,
    placements: lanes.placementTable,
    transformIndices: lane(TYPEGPU_TRANSFORM_INDEX_BUFFER_ID),
    transforms: lanes.transformTable,
    glyphIndices: lanes.buffers.get(TYPEGPU_GLYPH_INDEX_BUFFER_ID) ?? placementSlots,
    glyphOrigins: lanes.buffers.get(TYPEGPU_GLYPH_ORIGIN_BUFFER_ID) ?? lanes.placementTable,
  };
}
export function createSceneGroup(root: TgpuRoot, lanes: BatchLanes): TgpuBindGroup {
  return root.createBindGroup(scene, sceneBindings(lanes));
}
/** What a batched layout must hold for the scene functions: the session tables and the viewport. */
export interface SceneLayout {
  readonly $: {
    readonly viewport: d.v2f;
    readonly placementSlots: readonly number[];
    readonly placements: readonly d.v2f[];
    readonly transformIndices: readonly number[];
    readonly transforms: readonly d.v2f[];
    readonly glyphIndices: readonly number[];
    readonly glyphOrigins: readonly d.v2f[];
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
  /**
   * What the callbacks are told about the glyph of an instance: its layout index, and its pen origin moved by its
   * placement and its Text's offset, in the pixels `transformPosition` receives. Zeros in a config that asks for none.
   */
  glyphFacts(instance: number, offset: d.v2f): GlyphFacts;
  /** Projects a paragraph-space position (y up) moved by a text offset, telling the callback which glyph it is. */
  projectText(position: d.v3f, offset: d.v2f, glyph: GlyphFacts): d.v4f;
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
    glyphFacts: (instance: number, offset: d.v2f): GlyphFacts => {
      'use gpu';
      if (glyphFactsRead.$) {
        const origin = layout.$.glyphOrigins[instance]!.add(layout.$.placements[layout.$.placementSlots[instance]!]!);
        return GlyphFacts({ index: layout.$.glyphIndices[instance]!, origin: origin.add(offset) });
      }
      return GlyphFacts({ index: 0, origin: d.vec2f(0) });
    },
    projectText: (position: d.v3f, offset: d.v2f, glyph: GlyphFacts): d.v4f => {
      'use gpu';
      return projectWithScene(position, layout.$.viewport, offset, glyph);
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
