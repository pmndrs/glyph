import tgpu, { d, std, type TgpuBindGroup, type TgpuRenderPipeline, type TgpuSampler } from 'typegpu';
import type { CodecBufferId, PortableLeafResource } from '../../index.js';
import { MSDF_GLYPH_TABLE_LAYER_STEP, msdfSchema } from '../../raster/msdf.js';
import { MsdfCompositeInput, msdfComposite, msdfPosition } from '../../shaders/typegpu/msdf-shader.js';
import { msdfDistances } from '../../shaders/typegpu/msdf/distance.js';
import { decorationPaint } from '../../shaders/typegpu/decoration-shader.js';
import { ResidentMsdfAtlas } from './msdf-atlas.js';
import { TYPEGPU_PLACEMENT_SLOT_BUFFER_ID, TYPEGPU_TRANSFORM_INDEX_BUFFER_ID } from './codec.js';
import {
  colorTransform,
  corner,
  recordDraw,
  sceneFunctions,
  shaderRoot,
  type SceneLayout,
  target,
  type PipelineOptions,
  type TypeGpuResource,
} from './pipeline.js';

/**
 * What one MSDF font binds: its atlas, the sampler, its glyph table and its metrics. Every font of a config shares one
 * program per effect variant; only this group differs between them.
 */
const MsdfFontMetrics = d.struct({
  /** Atlas layer extent in texels, distance-field range in texels, and outline width units per em distance. */
  atlas: d.vec4f,
  /** 1 when the atlas holds only the true distance (single-channel mode), else 0. */
  singleChannel: d.f32,
});
/**
 * MSDF binds its font with the session tables in one group: a caller may bring up to two groups of its own and the
 * catch-all takes one, within WebGPU's four.
 */
const font = tgpu.bindGroupLayout({
  viewport: { uniform: d.vec2f },
  placementSlots: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  placements: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
  transformIndices: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  transforms: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
  atlas: { texture: d.texture2dArray(d.f32), visibility: ['fragment'] },
  sampler: { sampler: 'filtering', visibility: ['fragment'] },
  /** One row per baked glyph: `[left, top, width, height + layer * 4096]` in atlas texels. */
  glyphs: { storage: d.arrayOf(d.vec4f), access: 'readonly', visibility: ['vertex'] },
  metrics: { uniform: MsdfFontMetrics },
});
// Each attribute needs its own layout identity, even when its physical shape matches.
const rectLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const colorLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const effectColorLayout = tgpu.vertexLayout(d.disarrayOf(d.uint32x2), 'instance');
const effectLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const scene = sceneFunctions(font as unknown as SceneLayout);
function atlasSize(): d.v2f {
  'use gpu';
  return d.vec2f(font.$.metrics.atlas.xy);
}
function fieldRange(): number {
  'use gpu';
  return d.f32(font.$.metrics.atlas.z);
}
/**
 * The atlas sample as the four-channel field the reconstruction expects. A single-channel atlas holds only the true
 * distance, so every channel reads it. The explicit level samples what an implicit one would (the atlas has one
 * level) and stays legal inside the shadow's per-instance branch.
 */
function sampleAtlas(uv: d.v2f, layer: number): d.v4f {
  'use gpu';
  const sample = std.textureSampleLevel(font.$.atlas, font.$.sampler, uv, layer, 0);
  return std.select(sample, d.vec4f(sample.r), font.$.metrics.singleChannel > 0.5);
}

/**
 * Which effects one MSDF program composes over the fill: bit 1 outline, bit 2 shadow. A draw renders with the
 * program for exactly the effects present in its instance range, so plain text takes one atlas sample and composes
 * nothing; an instance whose effect alpha is zero draws nothing for that effect, so it needs no program for it.
 */
type EffectKey = 0 | 1 | 2 | 3;
const OUTLINE = 1;
const SHADOW = 2;

/** Reads the packed `[outline, shadow]` sRGB colors of a record range; an alpha byte of zero means absent. */
function effectsInUse(lane: Uint8Array, start: number, count: number): EffectKey {
  const words = new Uint32Array(lane.buffer, lane.byteOffset, lane.byteLength >>> 2);
  let outline = 0;
  let shadow = 0;
  for (let offset = start * 2; offset < (start + count) * 2; offset += 2) {
    outline |= words[offset]! >>> 24;
    shadow |= words[offset + 1]! >>> 24;
  }
  return ((outline === 0 ? 0 : OUTLINE) | (shadow === 0 ? 0 : SHADOW)) as EffectKey;
}

const MsdfGlyph = d.struct({
  position: d.vec4f,
  uv: d.vec2f,
  bounds: d.vec4f,
  layer: d.u32,
  outline: d.vec4f,
  width: d.f32,
  shadowUv: d.vec2f,
  shadow: d.vec4f,
});

/** Screen pixels a trimmed quad keeps around the ink for antialiasing; the coverage ramp never reaches further. */
const TRIM_ANTIALIAS_PIXELS = 1;
/**
 * Atlas texels kept besides. The median of three filtered channels is not exactly the distance to the ink box, so a
 * faint edge (under 2% coverage) can sit slightly past the antialiasing margin.
 */
const TRIM_FIELD_TEXELS = 0.5;

function projectCell(origin: d.v2f, size: d.v2f, cell: d.v2f, offset: d.v2f): d.v4f {
  'use gpu';
  return scene.projectText(msdfPosition(origin, size, d.vec3f(cell, 0)), offset);
}

/**
 * The quad corner `unit` moved inward from the cell edge, in cell-normalized coordinates; the rule the Three path
 * uses.
 *
 * The baker pads every ink box by half the distance range (rounded up) on each side. Coverage can be nonzero outside
 * the ink box only as far as the antialiasing ramp (one screen pixel plus half a texel), the outline width, and the
 * shadow displacement on the side the shadow falls toward. Each side keeps exactly that much padding and never grows
 * past the cell, so a trimmed quad discards only fragments whose coverage was already zero. The screen pixel comes
 * from the configured projection, evaluated at the cell corners: exact for any matrix (projective) transform, a local
 * estimate for a nonlinear one. Minified text, whose ramp spans the whole range, keeps the full cell.
 *
 * `outlineTexels` and `shadowTexels` are what the program's effects can draw outside the ink; an effect the program
 * does not compose passes zero.
 */
function trimmedCell(
  origin: d.v2f,
  size: d.v2f,
  cellTexels: d.v2f,
  unit: d.v2f,
  outlineTexels: number,
  shadowTexels: d.v2f,
  offset: d.v2f,
): d.v2f {
  'use gpu';
  const padding = std.ceil(fieldRange() * 0.5);
  // The projection is linear in the cell coordinate before the perspective divide: clip(u, v) = a + u b + v c.
  const a = projectCell(origin, size, d.vec2f(0, 0), offset);
  const b = projectCell(origin, size, d.vec2f(1, 0), offset).sub(a);
  const c = projectCell(origin, size, d.vec2f(0, 1), offset).sub(a);
  const clip = a.add(b.mul(unit.x)).add(c.mul(unit.y));
  // Screen-pixel Jacobian of the cell coordinate at this corner, scaled by w squared to avoid the divide.
  const halfViewport = scene.viewportSize().mul(0.5);
  const alongU = b.xy.mul(clip.w).sub(clip.xy.mul(b.w)).mul(halfViewport);
  const alongV = c.xy.mul(clip.w).sub(clip.xy.mul(c.w)).mul(halfViewport);
  const area = std.abs(alongU.x * alongV.y - alongU.y * alongV.x);
  // Cell-coordinate distance that moves an edge one screen pixel along its normal.
  const pixel = d.vec2f(std.length(alongV), std.length(alongU)).mul((clip.w * clip.w) / std.max(area, 1e-30));
  const antialias = pixel.mul(cellTexels).mul(TRIM_ANTIALIAS_PIXELS).add(TRIM_FIELD_TEXELS);
  const low = antialias.add(std.max(d.vec2f(outlineTexels), shadowTexels.mul(-1)));
  const high = antialias.add(std.max(d.vec2f(outlineTexels), shadowTexels));
  const insetLow = std.clamp(d.vec2f(padding).sub(low), d.vec2f(0), d.vec2f(padding)).div(cellTexels);
  const insetHigh = std.clamp(d.vec2f(padding).sub(high), d.vec2f(0), d.vec2f(padding)).div(cellTexels);
  return insetLow.add(d.vec2f(1).sub(insetHigh).sub(insetLow).mul(unit));
}

/**
 * Everything constant across one glyph, resolved per vertex: its cell from the font's glyph table, its placement, its
 * trimmed quad and its decoded effect colors. A program that composes no outline or shadow leaves those outputs
 * unread; `outlineReach` and `shadowReach` (0 or 1) say whether the program composes them, so whether they claim room.
 */
function msdfGlyph(
  index: number,
  instance: number,
  rect: d.v4f,
  effectColor: d.v2u,
  effect: d.v4f,
  outlineReach: number,
  shadowReach: number,
) {
  'use gpu';
  const atlas = atlasSize();
  const row = d.vec4f(font.$.glyphs[d.u32(effect.w)]!);
  const layer = std.floor(row.w / MSDF_GLYPH_TABLE_LAYER_STEP);
  const cellTexels = std.max(d.vec2f(row.z, row.w - layer * MSDF_GLYPH_TABLE_LAYER_STEP), d.vec2f(1e-6));
  const uvOrigin = row.xy.div(atlas);
  const uvSize = cellTexels.div(atlas);
  const origin = scene.placedOrigin(rect.xy, instance);
  const offset = scene.textOffset(instance);
  const width = effect.z * font.$.metrics.atlas.w;
  // Em to atlas UV: outline units per em times the field range is texels per em.
  const shadowOffset = effect.xy.mul(font.$.metrics.atlas.w * fieldRange()).div(atlas);
  const cell = trimmedCell(
    origin,
    rect.zw,
    cellTexels,
    corner(index),
    outlineReach * std.max(width, 0) * fieldRange(),
    shadowOffset.mul(atlas).mul(shadowReach),
    offset,
  );
  const uv = uvOrigin.add(cell.mul(uvSize));
  return MsdfGlyph({
    position: projectCell(origin, rect.zw, cell, offset),
    uv,
    bounds: d.vec4f(uvOrigin, uvOrigin.add(uvSize)),
    layer: d.u32(layer),
    outline: decorationPaint(d.vec2u(effectColor.x, 0)),
    width,
    shadowUv: uv.sub(shadowOffset),
    shadow: decorationPaint(d.vec2u(effectColor.y, 0)),
  });
}

const vertexIn = {
  index: d.builtin.vertexIndex,
  instance: d.builtin.instanceIndex,
  rect: d.vec4f,
  color: d.vec4f,
  effectColor: d.vec2u,
  effect: d.vec4f,
};
const fillVaryings = { uv: d.vec2f, bounds: d.vec4f, color: d.vec4f, layer: d.interpolate('flat', d.u32) };
const outlineVaryings = { outline: d.vec4f, width: d.f32 };
const shadowVaryings = { shadowUv: d.vec2f, shadow: d.vec4f };

/** RGB-median distance, alpha distance and screen pixels per distance unit at a cell's fill sample. */
function fillField(uv: d.v2f, bounds: d.v4f, layer: number): d.v3f {
  'use gpu';
  const atlas = atlasSize();
  const halfTexel = d.vec2f(0.5).div(atlas);
  const sample = sampleAtlas(std.clamp(uv, bounds.xy.add(halfTexel), bounds.zw.sub(halfTexel)), layer);
  return msdfDistances(sample, uv, atlas, fieldRange());
}
function distanceCoverage(distance: number, pixelsPerDistanceUnit: number): number {
  'use gpu';
  return std.clamp(distance * pixelsPerDistanceUnit + 0.5, 0, 1);
}
/** The outline ring with the fill subtracted, so the two never double-count a fragment. */
function outlineCoverage(field: d.v3f, width: number): number {
  'use gpu';
  return std.max(distanceCoverage(field.y + width, field.z) - distanceCoverage(field.x, field.z), 0);
}
/**
 * Coverage of the fill displaced by the shadow offset, inside the glyph's own cell. Only an instance whose shadow is
 * visible takes the second atlas sample; the others read zero coverage.
 */
function shadowCoverage(shadowUv: d.v2f, bounds: d.v4f, layer: number, alpha: number, field: d.v3f): number {
  'use gpu';
  let coverage = d.f32(0);
  if (alpha > 0) {
    const halfTexel = d.vec2f(0.5).div(atlasSize());
    const sample = sampleAtlas(std.clamp(shadowUv, bounds.xy.add(halfTexel), bounds.zw.sub(halfTexel)), layer);
    const inside = std.step(bounds.xy, shadowUv).mul(std.step(shadowUv, bounds.zw));
    coverage = distanceCoverage(sample.a - 0.5, field.z) * inside.x * inside.y;
  }
  return coverage;
}
/** Composites the fill, the outline ring and the shadow; a program without an effect passes it a transparent color. */
function composeEffects(
  field: d.v3f,
  fill: d.v4f,
  outline: d.v4f,
  width: number,
  shadow: d.v4f,
  shadowFill: number,
  position: d.v4f,
): d.v4f {
  'use gpu';
  const composite = msdfComposite(
    MsdfCompositeInput({
      coverage: d.vec3f(distanceCoverage(field.x, field.z), outlineCoverage(field, width), shadowFill),
      fillColor: fill,
      outlineColor: outline,
      shadowColor: shadow,
    }),
  );
  return colorTransform.$(composite, position);
}

const plainVertex = tgpu.vertexFn({ in: vertexIn, out: { position: d.builtin.position, ...fillVaryings } })((input) => {
  'use gpu';
  const glyph = msdfGlyph(input.index, input.instance, input.rect, input.effectColor, input.effect, d.f32(0), d.f32(0));
  return { position: glyph.position, uv: glyph.uv, bounds: glyph.bounds, color: input.color, layer: glyph.layer };
});
const plainFragment = tgpu.fragmentFn({ in: { position: d.builtin.position, ...fillVaryings }, out: d.vec4f })((
  input,
) => {
  'use gpu';
  const field = fillField(input.uv, input.bounds, input.layer);
  return colorTransform.$(d.vec4f(input.color.rgb, input.color.a * distanceCoverage(field.x, field.z)), input.position);
});
const outlineVertex = tgpu.vertexFn({
  in: vertexIn,
  out: { position: d.builtin.position, ...fillVaryings, ...outlineVaryings },
})((input) => {
  'use gpu';
  const glyph = msdfGlyph(input.index, input.instance, input.rect, input.effectColor, input.effect, d.f32(1), d.f32(0));
  return {
    position: glyph.position,
    uv: glyph.uv,
    bounds: glyph.bounds,
    color: input.color,
    layer: glyph.layer,
    outline: glyph.outline,
    width: glyph.width,
  };
});
const outlineFragment = tgpu.fragmentFn({
  in: { position: d.builtin.position, ...fillVaryings, ...outlineVaryings },
  out: d.vec4f,
})((input) => {
  'use gpu';
  const field = fillField(input.uv, input.bounds, input.layer);
  return composeEffects(field, input.color, input.outline, input.width, d.vec4f(0), 0, input.position);
});
const shadowVertex = tgpu.vertexFn({
  in: vertexIn,
  out: { position: d.builtin.position, ...fillVaryings, ...shadowVaryings },
})((input) => {
  'use gpu';
  const glyph = msdfGlyph(input.index, input.instance, input.rect, input.effectColor, input.effect, d.f32(0), d.f32(1));
  return {
    position: glyph.position,
    uv: glyph.uv,
    bounds: glyph.bounds,
    color: input.color,
    layer: glyph.layer,
    shadowUv: glyph.shadowUv,
    shadow: glyph.shadow,
  };
});
const shadowFragment = tgpu.fragmentFn({
  in: { position: d.builtin.position, ...fillVaryings, ...shadowVaryings },
  out: d.vec4f,
})((input) => {
  'use gpu';
  const field = fillField(input.uv, input.bounds, input.layer);
  const shadow = shadowCoverage(input.shadowUv, input.bounds, input.layer, input.shadow.a, field);
  return composeEffects(field, input.color, d.vec4f(0), 0, input.shadow, shadow, input.position);
});
const bothVertex = tgpu.vertexFn({
  in: vertexIn,
  out: { position: d.builtin.position, ...fillVaryings, ...outlineVaryings, ...shadowVaryings },
})((input) => {
  'use gpu';
  const glyph = msdfGlyph(input.index, input.instance, input.rect, input.effectColor, input.effect, d.f32(1), d.f32(1));
  return {
    position: glyph.position,
    uv: glyph.uv,
    bounds: glyph.bounds,
    color: input.color,
    layer: glyph.layer,
    outline: glyph.outline,
    width: glyph.width,
    shadowUv: glyph.shadowUv,
    shadow: glyph.shadow,
  };
});
const bothFragment = tgpu.fragmentFn({
  in: { position: d.builtin.position, ...fillVaryings, ...outlineVaryings, ...shadowVaryings },
  out: d.vec4f,
})((input) => {
  'use gpu';
  const field = fillField(input.uv, input.bounds, input.layer);
  const shadow = shadowCoverage(input.shadowUv, input.bounds, input.layer, input.shadow.a, field);
  return composeEffects(field, input.color, input.outline, input.width, input.shadow, shadow, input.position);
});
function scalar(payload: PortableLeafResource, index = 0): number {
  if (payload.kind !== 'buffer') throw new Error('Expected a raster constant');
  return new DataView(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength).getFloat32(
    index * 4,
    true,
  );
}

/** One program per effect variant for every MSDF font of a config, built on first use. */
interface MsdfPrograms {
  pipeline(key: EffectKey): TgpuRenderPipeline;
  readonly sampler: TgpuSampler;
}
const programsByConfig = new WeakMap<PipelineOptions, MsdfPrograms>();
function msdfPrograms(options: PipelineOptions): MsdfPrograms {
  const cached = programsByConfig.get(options);
  if (cached !== undefined) return cached;
  const configured = shaderRoot(options);
  const common = {
    attribs: {
      rect: rectLayout.attrib,
      color: colorLayout.attrib,
      effectColor: effectColorLayout.attrib,
      effect: effectLayout.attrib,
    },
    targets: target(options),
    multisample: { count: options.sampleCount ?? 1 },
    depthStencil: options.depthStencil,
  };
  const create = (key: EffectKey): TgpuRenderPipeline => {
    switch (key) {
      case 0:
        return configured.createRenderPipeline({ vertex: plainVertex, fragment: plainFragment, ...common });
      case OUTLINE:
        return configured.createRenderPipeline({ vertex: outlineVertex, fragment: outlineFragment, ...common });
      case SHADOW:
        return configured.createRenderPipeline({ vertex: shadowVertex, fragment: shadowFragment, ...common });
      default:
        return configured.createRenderPipeline({ vertex: bothVertex, fragment: bothFragment, ...common });
    }
  };
  // Most text never needs an effect program.
  const pipelines: (TgpuRenderPipeline | undefined)[] = [];
  const programs: MsdfPrograms = {
    pipeline(key) {
      let built = pipelines[key];
      if (built === undefined) {
        built = create(key);
        built.initSync();
        pipelines[key] = built;
      }
      return built;
    },
    sampler: options.root.createSampler({ minFilter: 'linear', magFilter: 'linear' }),
  };
  programsByConfig.set(options, programs);
  return programs;
}

export function msdfResource(
  options: PipelineOptions,
  members: Readonly<Record<string, PortableLeafResource>>,
): TypeGpuResource {
  const { root } = options;
  const programs = msdfPrograms(options);
  const atlas = new ResidentMsdfAtlas(root, members.pages!, members.glyphs!, options.msdfAtlas === 'sdf');
  let metrics: ReturnType<typeof createMetrics> | undefined;
  const createMetrics = () =>
    root.createUniform(MsdfFontMetrics, {
      atlas: d.vec4f(atlas.page, atlas.page, scalar(members.pixelRange!), scalar(members.effectScale!, 2)),
      singleChannel: atlas.singleChannel ? 1 : 0,
    });
  try {
    metrics = createMetrics();
    const fontMetrics = metrics;
    programs.pipeline(0);
    return {
      dispose: () => {
        atlas.dispose();
        fontMetrics.buffer.destroy();
      },
      bind(lanes) {
        const b = msdfSchema.buffers;
        const lane = (id: CodecBufferId): GPUBuffer => {
          const buffer = lanes.buffers.get(id);
          if (buffer === undefined) throw new Error('TypeGPU MSDF draw is missing one of its lanes');
          return buffer;
        };
        // Rebuilt with its pipelines whenever the atlas grows into a new texture.
        let generation = -1;
        let group: TgpuBindGroup | undefined;
        let bound: (TgpuRenderPipeline | undefined)[] = [];
        const effectColors = lanes.bytes.get(b.effectColor.id)!;
        const effects = lanes.bytes.get(b.effect.id)!;
        return {
          watchedLanes: [effectColors, effects],
          variant(start, count) {
            // Glyphs a frame publishes become resident at its commit, before the frame that draws them.
            atlas.use(effects, start, count);
            const key = effectsInUse(effectColors, start, count);
            // Builds the program at commit, not in the caller's next draw.
            programs.pipeline(key);
            return key;
          },
          draw(pass, bindGroups, variant, first, count) {
            if (generation !== atlas.generation || group === undefined) {
              generation = atlas.generation;
              bound = [];
              group = root.createBindGroup(font, {
                viewport: lanes.viewport,
                placementSlots: lane(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID),
                placements: lanes.placementTable,
                transformIndices: lane(TYPEGPU_TRANSFORM_INDEX_BUFFER_ID),
                transforms: lanes.transformTable,
                atlas: atlas.view,
                sampler: programs.sampler,
                glyphs: atlas.glyphs,
                metrics: fontMetrics,
              });
            }
            let pipelineForVariant = bound[variant];
            if (pipelineForVariant === undefined) {
              pipelineForVariant = programs
                .pipeline(variant as EffectKey)
                .with(group)
                .with(rectLayout, lane(b.rect.id))
                .with(colorLayout, lane(b.color.id))
                .with(effectColorLayout, lane(b.effectColor.id))
                .with(effectLayout, lane(b.effect.id));
              bound[variant] = pipelineForVariant;
            }
            recordDraw(root, pipelineForVariant, pass, bindGroups, first, count);
          },
        };
      },
    };
  } catch (error) {
    atlas.dispose();
    metrics?.buffer.destroy();
    throw error;
  }
}
