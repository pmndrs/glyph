import tgpu, { d, std, type TgpuRoot, type TgpuRenderPipeline } from 'typegpu';
import type { PortableLeafResource } from '../../index.js';
import { MSDF_GLYPH_TABLE_LAYER_STEP, msdfBakedPages, msdfSchema } from '../../raster/msdf.js';
import {
  MsdfCompositeInput,
  msdfAtlasSizeAccessor,
  msdfComposite,
  msdfPixelRangeAccessor,
  msdfPosition,
  msdfSampleSlot,
} from '../../shaders/typegpu/msdf-shader.js';
import { msdfDistances } from '../../shaders/typegpu/msdf/distance.js';
import { decorationPaint } from '../../shaders/typegpu/decoration-shader.js';
import { TYPEGPU_PLACEMENT_SLOT_BUFFER_ID } from './codec.js';
import {
  colorTransform,
  corner,
  projectWithScene,
  recordDraw,
  shaderRoot,
  target,
  type PipelineOptions,
  type TypeGpuResource,
} from './pipeline.js';

const msdfScene = tgpu.bindGroupLayout({
  viewport: { uniform: d.vec2f },
  position: { uniform: d.vec2f },
  placementSlots: { storage: d.arrayOf(d.u32), access: 'readonly' as const, visibility: ['vertex' as const] },
  placements: { storage: d.arrayOf(d.vec2f), access: 'readonly' as const, visibility: ['vertex' as const] },
  /** One row per baked glyph: `[left, top, width, height + layer * 4096]` in atlas texels. */
  glyphs: { storage: d.arrayOf(d.vec4f), access: 'readonly' as const, visibility: ['vertex' as const] },
});
// Each attribute needs its own layout identity, even when its physical shape matches.
const rectLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const colorLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const effectColorLayout = tgpu.vertexLayout(d.disarrayOf(d.uint32x2), 'instance');
const effectLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
/** `[shadowX, shadowY]` em to atlas UV and outline width em to distance units, from the font's baked constants. */
const effectScaleAccessor = tgpu.accessor(d.vec3f);

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

/**
 * Everything constant across one glyph, resolved per vertex: its cell from the font's glyph table, its placement, and
 * its decoded effect colors. A program that composes no outline or shadow leaves those outputs unread.
 */
function msdfGlyph(index: number, instance: number, rect: d.v4f, effectColor: d.v2u, effect: d.v4f) {
  'use gpu';
  const atlasSize = msdfAtlasSizeAccessor.$;
  const scale = effectScaleAccessor.$;
  const cell = msdfScene.$.glyphs[d.u32(effect.w)]!;
  const layer = std.floor(cell.w / MSDF_GLYPH_TABLE_LAYER_STEP);
  const uvOrigin = cell.xy.div(atlasSize);
  const uvSize = d.vec2f(cell.z, cell.w - layer * MSDF_GLYPH_TABLE_LAYER_STEP).div(atlasSize);
  const origin = rect.xy.add(msdfScene.$.placements[msdfScene.$.placementSlots[instance]!]!);
  const unit = corner(index);
  const uv = uvOrigin.add(unit.mul(uvSize));
  const position = msdfPosition(origin, rect.zw, d.vec3f(unit, 0));
  return MsdfGlyph({
    position: projectWithScene(position, msdfScene.$.viewport, msdfScene.$.position),
    uv,
    bounds: d.vec4f(uvOrigin, uvOrigin.add(uvSize)),
    layer: d.u32(layer),
    outline: decorationPaint(d.vec2u(effectColor.x, 0)),
    width: effect.z * scale.z,
    shadowUv: uv.sub(effect.xy.mul(scale.xy)),
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
  const atlasSize = msdfAtlasSizeAccessor.$;
  const halfTexel = d.vec2f(0.5).div(atlasSize);
  const sample = msdfSampleSlot.$(std.clamp(uv, bounds.xy.add(halfTexel), bounds.zw.sub(halfTexel)), layer);
  return msdfDistances(sample, uv, atlasSize, msdfPixelRangeAccessor.$);
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
    const halfTexel = d.vec2f(0.5).div(msdfAtlasSizeAccessor.$);
    const sample = msdfSampleSlot.$(std.clamp(shadowUv, bounds.xy.add(halfTexel), bounds.zw.sub(halfTexel)), layer);
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
  const glyph = msdfGlyph(input.index, input.instance, input.rect, input.effectColor, input.effect);
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
  const glyph = msdfGlyph(input.index, input.instance, input.rect, input.effectColor, input.effect);
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
  const glyph = msdfGlyph(input.index, input.instance, input.rect, input.effectColor, input.effect);
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
  const glyph = msdfGlyph(input.index, input.instance, input.rect, input.effectColor, input.effect);
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
/** Uploads every baked MSDF page as one layer, straight from the decoded page bytes. */
function bakedAtlas(root: TgpuRoot, token: PortableLeafResource) {
  if (token.kind !== 'buffer') throw new Error('Expected the MSDF baked-pages token');
  const baked = msdfBakedPages(token);
  const result = root
    .createTexture({ size: [baked.width, baked.height, baked.pages.length], format: 'rgba8unorm' })
    .$usage('sampled');
  try {
    const gpu = root.unwrap(result);
    for (const [layer, page] of baked.pages.entries()) {
      root.device.queue.writeTexture(
        { texture: gpu, origin: [0, 0, layer] },
        page.bytes,
        { bytesPerRow: page.width * 4, rowsPerImage: page.height },
        [page.width, page.height, 1],
      );
    }
    return result;
  } catch (error) {
    result.destroy();
    throw error;
  }
}
/** Uploads a portable constant table as a read-only storage buffer. */
function storageTable(root: TgpuRoot, payload: PortableLeafResource): GPUBuffer {
  if (payload.kind !== 'buffer') throw new Error('Expected a raster constant table');
  const buffer = root.device.createBuffer({
    size: Math.max(16, payload.bytes.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  root.device.queue.writeBuffer(buffer, 0, payload.bytes);
  return buffer;
}
function scalar(payload: PortableLeafResource, index = 0): number {
  if (payload.kind !== 'buffer') throw new Error('Expected a raster constant');
  return new DataView(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength).getFloat32(
    index * 4,
    true,
  );
}

export function msdfResource(
  options: PipelineOptions,
  members: Readonly<Record<string, PortableLeafResource>>,
): TypeGpuResource {
  const { root } = options;
  const atlas = bakedAtlas(root, members.pages!);
  const glyphs = storageTable(root, members.glyphs!);
  try {
    const view = atlas.createView(d.texture2dArray(d.f32));
    const sampler = root.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const configured = shaderRoot(options)
      .with(msdfAtlasSizeAccessor, d.vec2f(atlas.props.size[0], atlas.props.size[1]))
      .with(msdfPixelRangeAccessor, scalar(members.pixelRange!))
      .with(
        effectScaleAccessor,
        d.vec3f(scalar(members.effectScale!, 0), scalar(members.effectScale!, 1), scalar(members.effectScale!, 2)),
      )
      // The atlas has one mip level, so an explicit level samples exactly what an implicit one would, and stays
      // legal inside the shadow's per-instance branch.
      .with(msdfSampleSlot, (uv, layer) => {
        'use gpu';
        return std.textureSampleLevel(view.$, sampler.$, uv, layer, 0);
      });
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
    // Built on first use: most text never needs an effect program.
    const pipelines: (TgpuRenderPipeline | undefined)[] = [];
    const pipeline = (key: EffectKey): TgpuRenderPipeline => {
      let built = pipelines[key];
      if (built === undefined) {
        built = create(key);
        built.initSync();
        pipelines[key] = built;
      }
      return built;
    };
    pipeline(0);
    return {
      dispose: () => {
        atlas.destroy();
        glyphs.destroy();
      },
      prepare(buffers, placementTable, viewport, position, start, count, bytes) {
        const placementSlots = buffers.get(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID);
        if (placementSlots === undefined) throw new Error('TypeGPU glyph draw is missing its placement-slot lane');
        const group = root.createBindGroup(msdfScene, {
          viewport,
          position,
          placementSlots,
          placements: placementTable,
          glyphs,
        });
        const b = msdfSchema.buffers;
        const effectColors = bytes.get(b.effectColor.id)!;
        const bind = (key: EffectKey): TgpuRenderPipeline =>
          pipeline(key)
            .with(group)
            .with(rectLayout, buffers.get(b.rect.id)!)
            .with(colorLayout, buffers.get(b.color.id)!)
            .with(effectColorLayout, buffers.get(b.effectColor.id)!)
            .with(effectLayout, buffers.get(b.effect.id)!);
        let effects: EffectKey | undefined;
        let bound: TgpuRenderPipeline | undefined;
        const refresh = (written: ReadonlySet<Uint8Array>): TgpuRenderPipeline => {
          if (bound !== undefined && !written.has(effectColors)) return bound;
          const next = effectsInUse(effectColors, start, count);
          if (bound === undefined || next !== effects) {
            effects = next;
            bound = bind(next);
          }
          return bound;
        };
        return {
          refresh,
          draw(pass, bindGroups) {
            recordDraw(root, bound ?? refresh(new Set()), pass, bindGroups, start, count);
          },
        };
      },
    };
  } catch (error) {
    atlas.destroy();
    glyphs.destroy();
    throw error;
  }
}
