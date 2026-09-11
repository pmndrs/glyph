import tgpu, {
  d,
  std,
  type TgpuRoot,
  type TgpuUniform,
  type TgpuRenderPass,
  type TgpuBindGroup,
  type TgpuRenderPipeline,
} from 'typegpu';
import type { CodecBufferId, PortableResource, PortableLeafResource } from '../../index.js';
import { bitmapSchema } from '../../raster/bitmap.js';
import { msdfSchema } from '../../raster/msdf.js';
import { slugSchema } from '../../raster/slug.js';
import { bitmapFragment, bitmapQuadPosition, bitmapAtlasUv } from '../../shaders/typegpu/bitmap-shader.js';
import {
  msdfFragment,
  msdfVertex,
  msdfSampleSlot,
  msdfAtlasSizeAccessor,
  msdfPixelRangeAccessor,
} from '../../shaders/typegpu/msdf-shader.js';
import { decorationPaint } from '../../shaders/typegpu/decoration-shader.js';
import { slugRender, SlugShaderGlyph } from '../../shaders/typegpu/slug/slug-render.js';
import { slugDilate } from '../../shaders/typegpu/slug/core/dilate.js';
import {
  slugCurveTexelSlot,
  slugHeaderTexelSlot,
  slugReferenceTexelSlot,
  slugCurveWidthAccessor,
  slugHeaderWidthAccessor,
  slugReferenceWidthAccessor,
} from '../../shaders/typegpu/slug/slug-texture.js';
import type { TypeGpuConfigOptions, TypeGpuPositionTransform, TypeGpuColorTransform } from '../config.js';
import { bitmapPageAccessor } from '../../shaders/typegpu/bitmap-shader.js';
import { TYPEGPU_PLACEMENT_SLOT_BUFFER_ID } from './codec.js';

export interface Draw {
  draw(pass: TgpuRenderPass | GPURenderPassEncoder, bindGroups: readonly TgpuBindGroup[]): void;
}
export interface TypeGpuResource {
  prepare(
    buffers: ReadonlyMap<CodecBufferId, GPUBuffer>,
    placementTable: GPUBuffer,
    viewport: TgpuUniform<d.Vec2f>,
    position: TgpuUniform<d.Vec2f>,
    start: number,
    count: number,
  ): Draw;
  dispose(): void;
}
type PipelineOptions = TypeGpuConfigOptions;

const defaultPosition: TypeGpuPositionTransform = (position, viewport) => {
  'use gpu';
  return d.vec4f((position.x * 2) / viewport.x - 1, 1 - (position.y * 2) / viewport.y, position.z, 1);
};
const positionTransform = tgpu.slot<TypeGpuPositionTransform>(defaultPosition);
const defaultColor: TypeGpuColorTransform = (color) => {
  'use gpu';
  return d.vec4f(color);
};
const colorTransform = tgpu.slot<TypeGpuColorTransform>(defaultColor);
function shaderRoot(options: PipelineOptions) {
  return options.root
    .with(positionTransform, options.transformPosition ?? defaultPosition)
    .with(colorTransform, options.transformColor ?? defaultColor);
}

const scene = tgpu.bindGroupLayout({
  viewport: { uniform: d.vec2f },
  position: { uniform: d.vec2f },
  placementSlots: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  placements: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
});
const slugScene = tgpu.bindGroupLayout({
  viewport: { uniform: d.vec2f },
  position: { uniform: d.vec2f },
  placements: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
});
const v2 = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const v4 = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const u1 = tgpu.vertexLayout(d.disarrayOf(d.uint32), 'instance');
const u2 = tgpu.vertexLayout(d.disarrayOf(d.uint32x2), 'instance');
const u4 = tgpu.vertexLayout(d.disarrayOf(d.uint32x4), 'instance');
// Each attribute needs its own layout identity, even when its physical shape matches.
const originLayout = v2;
const sizeLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const uvOriginLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const uvSizeLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const colorLayout = v4;
const rectLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const uvRectLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const boundsLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const pageLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const planeLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const bandLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const inverseLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const countsLayout = tgpu.vertexLayout(d.disarrayOf(d.uint32x4), 'instance');

function corner(index: number): d.v2f {
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
function project(position: d.v3f): d.v4f {
  'use gpu';
  return projectWithScene(position, scene.$.viewport, scene.$.position);
}
function placedOrigin(origin: d.v2f, instance: number): d.v2f {
  'use gpu';
  return origin.add(scene.$.placements[scene.$.placementSlots[instance]!]!);
}
function projectSlug(position: d.v3f): d.v4f {
  'use gpu';
  return projectWithScene(position, slugScene.$.viewport, slugScene.$.position);
}
function placedSlugOrigin(origin: d.v2f, placementSlot: number): d.v2f {
  'use gpu';
  return origin.add(slugScene.$.placements[placementSlot]!);
}
function target(options: PipelineOptions): GPUColorTargetState {
  return {
    format: options.format,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    },
  };
}
function texture(root: TgpuRoot, payload: PortableLeafResource) {
  if (payload.kind !== 'texture' && payload.kind !== 'texture-array') throw new Error('Expected a raster texture');
  const result = root
    .createTexture({
      size: [payload.width, payload.height, payload.kind === 'texture-array' ? payload.layers : 1],
      format: payload.format,
    })
    .$usage('sampled');
  try {
    result.write(payload.bytes);
    return result;
  } catch (error) {
    result.destroy();
    throw error;
  }
}
function scalar(payload: PortableLeafResource, index = 0): number {
  if (payload.kind !== 'buffer') throw new Error('Expected a raster constant');
  return new DataView(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength).getFloat32(
    index * 4,
    true,
  );
}

export function createResource(options: PipelineOptions, format: string, payload: PortableResource): TypeGpuResource {
  if (format === 'pmndrs.bitmap') return bitmapResource(options, payload);
  if (payload.kind !== 'group') throw new Error('Expected grouped raster resources');
  if (format === 'pmndrs.msdf') return msdfResource(options, payload.members);
  if (format === 'pmndrs.slug') return slugResource(options, payload.members);
  throw new TypeError(`TypeGPU cannot render raster format "${format}"`);
}
function preparedDraw(root: TgpuRoot, pipeline: TgpuRenderPipeline, start: number, count: number): Draw {
  return {
    draw(pass, bindGroups) {
      let bound = pipeline;
      for (const group of bindGroups) bound = bound.with(group);
      bound.with('resourceType' in pass ? root.unwrap(pass) : pass).draw(6, count, 0, start);
    },
  };
}

function bitmapResource(options: PipelineOptions, payload: PortableResource): TypeGpuResource {
  if (payload.kind === 'group') throw new Error('Expected bitmap atlas');
  const { root } = options;
  const atlas = texture(root, payload);
  try {
    const view = atlas.createView(d.texture2dArray(d.f32));
    const vertex = tgpu.vertexFn({
      in: {
        index: d.builtin.vertexIndex,
        instance: d.builtin.instanceIndex,
        origin: d.vec2f,
        size: d.vec2f,
        uvOrigin: d.vec2f,
        uvSize: d.vec2f,
        color: d.vec4f,
        layer: d.u32,
      },
      out: { position: d.builtin.position, uv: d.vec2f, color: d.vec4f, layer: d.interpolate('flat', d.u32) },
    })((input) => {
      'use gpu';
      const unit = corner(input.index);
      return {
        position: project(bitmapQuadPosition(placedOrigin(input.origin, input.instance), input.size, unit)),
        uv: bitmapAtlasUv(input.uvOrigin, input.uvSize, unit),
        color: input.color,
        layer: input.layer,
      };
    });
    const fragment = tgpu.fragmentFn({
      in: { position: d.builtin.position, uv: d.vec2f, color: d.vec4f, layer: d.interpolate('flat', d.u32) },
      out: d.vec4f,
    })((input) => {
      'use gpu';
      const result = bitmapFragment({ atlasUv: input.uv, color: input.color, pageLayer: input.layer });
      return colorTransform.$(d.vec4f(result.color, result.opacity), input.position);
    });
    const pipeline = shaderRoot(options)
      .with(bitmapPageAccessor, view)
      .createRenderPipeline({
        vertex,
        fragment,
        attribs: {
          origin: originLayout.attrib,
          size: sizeLayout.attrib,
          uvOrigin: uvOriginLayout.attrib,
          uvSize: uvSizeLayout.attrib,
          color: colorLayout.attrib,
          layer: u1.attrib,
        },
        targets: target(options),
        multisample: { count: options.sampleCount ?? 1 },
        depthStencil: options.depthStencil,
      });
    pipeline.initSync();
    return {
      dispose: () => atlas.destroy(),
      prepare(buffers, placementTable, viewport, position, start, count) {
        const placementSlots = buffers.get(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID);
        if (placementSlots === undefined) throw new Error('TypeGPU glyph draw is missing its placement-slot lane');
        const group = root.createBindGroup(scene, { viewport, position, placementSlots, placements: placementTable });
        const b = bitmapSchema.buffers;
        const draw = pipeline
          .with(group)
          .with(originLayout, buffers.get(b.origin.id)!)
          .with(sizeLayout, buffers.get(b.size.id)!)
          .with(uvOriginLayout, buffers.get(b.uvOrigin.id)!)
          .with(uvSizeLayout, buffers.get(b.uvSize.id)!)
          .with(colorLayout, buffers.get(b.color.id)!)
          .with(u1, buffers.get(b.page.id)!);
        return preparedDraw(root, draw, start, count);
      },
    };
  } catch (error) {
    atlas.destroy();
    throw error;
  }
}
function msdfResource(
  options: PipelineOptions,
  members: Readonly<Record<string, PortableLeafResource>>,
): TypeGpuResource {
  const { root } = options;
  const atlas = texture(root, members.texture!);
  try {
    const view = atlas.createView(d.texture2dArray(d.f32));
    const sampler = root.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const atlasSize = d.vec2f(atlas.props.size[0], atlas.props.size[1]);
    const pixelRange = scalar(members.pixelRange!);
    const effectScale = d.vec3f(
      scalar(members.effectScale!, 0),
      scalar(members.effectScale!, 1),
      scalar(members.effectScale!, 2),
    );
    const varyings = {
      uv: d.vec2f,
      shadowUv: d.vec2f,
      bounds: d.vec4f,
      color: d.vec4f,
      outline: d.vec4f,
      shadow: d.vec4f,
      width: d.f32,
      layer: d.interpolate('flat', d.u32),
    };
    const vertex = tgpu.vertexFn({
      in: {
        index: d.builtin.vertexIndex,
        instance: d.builtin.instanceIndex,
        rect: d.vec4f,
        uvRect: d.vec4f,
        bounds: d.vec4f,
        color: d.vec4f,
        effect: d.vec2u,
        page: d.vec4f,
      },
      out: { position: d.builtin.position, ...varyings },
    })((input) => {
      'use gpu';
      const unit = corner(input.index);
      const output = msdfVertex({
        unitPosition: d.vec3f(unit, 0),
        unitUv: unit,
        instance: {
          origin: placedOrigin(input.rect.xy, input.instance),
          size: input.rect.zw,
          uvOrigin: input.uvRect.xy,
          uvSize: input.uvRect.zw,
          uvBounds: input.bounds,
          fillColor: input.color,
          outlineColor: decorationPaint(d.vec2u(input.effect.x, 0)),
          shadowColor: decorationPaint(d.vec2u(input.effect.y, 0)),
          shadowOffset: input.page.xy.mul(effectScale.xy),
          outlineWidth: input.page.z * effectScale.z,
          pageIndex: d.u32(input.page.w),
        },
      });
      return {
        position: project(output.position),
        uv: output.atlasCoordinate,
        shadowUv: output.shadowCoordinate,
        bounds: output.uvBounds,
        color: output.fillColor,
        outline: output.outlineColor,
        shadow: output.shadowColor,
        width: output.outlineWidth,
        layer: output.pageIndex,
      };
    });
    const fragment = tgpu.fragmentFn({ in: { position: d.builtin.position, ...varyings }, out: d.vec4f })((input) => {
      'use gpu';
      const output = msdfFragment({
        position: d.vec3f(0),
        atlasCoordinate: input.uv,
        shadowCoordinate: input.shadowUv,
        uvBounds: input.bounds,
        fillColor: input.color,
        outlineColor: input.outline,
        shadowColor: input.shadow,
        outlineWidth: input.width,
        pageIndex: input.layer,
      });
      return colorTransform.$(d.vec4f(output.color, output.opacity), input.position);
    });
    const pipeline = shaderRoot(options)
      .with(msdfAtlasSizeAccessor, atlasSize)
      .with(msdfPixelRangeAccessor, pixelRange)
      .with(msdfSampleSlot, (uv, layer) => {
        'use gpu';
        return std.textureSample(view.$, sampler.$, uv, layer);
      })
      .createRenderPipeline({
        vertex,
        fragment,
        attribs: {
          rect: rectLayout.attrib,
          uvRect: uvRectLayout.attrib,
          bounds: boundsLayout.attrib,
          color: colorLayout.attrib,
          effect: u2.attrib,
          page: pageLayout.attrib,
        },
        targets: target(options),
        multisample: { count: options.sampleCount ?? 1 },
        depthStencil: options.depthStencil,
      });
    pipeline.initSync();
    return {
      dispose: () => atlas.destroy(),
      prepare(buffers, placementTable, viewport, position, start, count) {
        const placementSlots = buffers.get(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID);
        if (placementSlots === undefined) throw new Error('TypeGPU glyph draw is missing its placement-slot lane');
        const group = root.createBindGroup(scene, { viewport, position, placementSlots, placements: placementTable });
        const b = msdfSchema.buffers;
        const draw = pipeline
          .with(group)
          .with(rectLayout, buffers.get(b.rect.id)!)
          .with(uvRectLayout, buffers.get(b.uvRect.id)!)
          .with(boundsLayout, buffers.get(b.uvBounds.id)!)
          .with(colorLayout, buffers.get(b.color.id)!)
          .with(u2, buffers.get(b.effectColor.id)!)
          .with(pageLayout, buffers.get(b.page.id)!);
        return preparedDraw(root, draw, start, count);
      },
    };
  } catch (error) {
    atlas.destroy();
    throw error;
  }
}
function slugResource(
  options: PipelineOptions,
  members: Readonly<Record<string, PortableLeafResource>>,
): TypeGpuResource {
  const { root } = options;
  const textures: ReturnType<typeof texture>[] = [];
  try {
    const curves = texture(root, members.curves!);
    textures.push(curves);
    const headers = texture(root, members.headers!);
    textures.push(headers);
    const references = texture(root, members.references!);
    textures.push(references);
    const curveView = curves.createView(d.texture2d(d.f32));
    const headerView = headers.createView(d.texture2d(d.u32));
    const referenceView = references.createView(d.texture2d(d.u32));
    const varyings = {
      coordinate: d.vec2f,
      color: d.vec4f,
      band: d.vec4f,
      starts: d.interpolate('flat', d.vec4u),
      counts: d.interpolate('flat', d.vec4u),
    };
    const vertex = tgpu.vertexFn({
      in: {
        index: d.builtin.vertexIndex,
        rect: d.vec4f,
        plane: d.vec4f,
        band: d.vec4f,
        color: d.vec4f,
        inverse: d.vec4f,
        starts: d.vec4u,
        counts: d.vec4u,
      },
      out: { position: d.builtin.position, ...varyings },
    })((input) => {
      'use gpu';
      const unit = corner(input.index);
      const origin = placedSlugOrigin(input.rect.xy, input.counts.z);
      const local = d.vec2f(origin.x + unit.x * input.rect.z, -(origin.y + unit.y * input.rect.w));
      const normal = d.vec2f((unit.x - 0.5) * input.rect.z, -(unit.y - 0.5) * input.rect.w);
      const em = d.vec2f(input.plane.x + unit.x * input.plane.z, input.plane.y - unit.y * input.plane.w);
      // Local homogeneous projection derivatives keep Slug's half-pixel expansion in screen space.
      const clip = projectSlug(d.vec3f(local, 0));
      const dx = projectSlug(d.vec3f(local.x + 1, local.y, 0)).sub(clip);
      const dy = projectSlug(d.vec3f(local.x, local.y + 1, 0)).sub(clip);
      const dilated = slugDilate(
        d.vec2f(0),
        normal,
        em,
        input.inverse.x,
        d.vec4f(dx.x, dy.x, 0, clip.x),
        d.vec4f(dx.y, dy.y, 0, clip.y),
        d.vec4f(dx.w, dy.w, 0, clip.w),
        slugScene.$.viewport,
      );
      return {
        position: projectSlug(d.vec3f(local.add(dilated.xy), 0)),
        coordinate: dilated.zw,
        color: input.color,
        band: input.band,
        starts: input.starts,
        counts: input.counts,
      };
    });
    const fragment = tgpu.fragmentFn({ in: { position: d.builtin.position, ...varyings }, out: d.vec4f })((input) => {
      'use gpu';
      const coverage = slugRender(
        SlugShaderGlyph({
          curveBaseTexel: input.starts.x,
          horizontalHeaderBase: input.starts.y,
          verticalHeaderBase: input.starts.z,
          referenceBase: input.starts.w,
          horizontalBandCount: input.counts.x,
          verticalBandCount: input.counts.y,
          bandTransform: input.band,
        }),
        input.coordinate,
      );
      return colorTransform.$(d.vec4f(input.color.rgb, input.color.a * coverage), input.position);
    });
    const pipeline = shaderRoot(options)
      .with(slugCurveWidthAccessor, d.u32(curves.props.size[0]))
      .with(slugHeaderWidthAccessor, d.u32(headers.props.size[0]))
      .with(slugReferenceWidthAccessor, d.u32(references.props.size[0]))
      .with(slugCurveTexelSlot, (coords) => {
        'use gpu';
        return std.textureLoad(curveView.$, coords, 0);
      })
      .with(slugHeaderTexelSlot, (coords) => {
        'use gpu';
        return std.textureLoad(headerView.$, coords, 0);
      })
      .with(slugReferenceTexelSlot, (coords) => {
        'use gpu';
        return std.textureLoad(referenceView.$, coords, 0);
      })
      .createRenderPipeline({
        vertex,
        fragment,
        attribs: {
          rect: rectLayout.attrib,
          plane: planeLayout.attrib,
          band: bandLayout.attrib,
          color: colorLayout.attrib,
          inverse: inverseLayout.attrib,
          starts: u4.attrib,
          counts: countsLayout.attrib,
        },
        targets: target(options),
        multisample: { count: options.sampleCount ?? 1 },
        depthStencil: options.depthStencil,
      });
    pipeline.initSync();
    return {
      dispose: () => {
        for (const value of textures) value.destroy();
      },
      prepare(buffers, placementTable, viewport, position, start, count) {
        const group = root.createBindGroup(slugScene, { viewport, position, placements: placementTable });
        const b = slugSchema.buffers;
        const draw = pipeline
          .with(group)
          .with(rectLayout, buffers.get(b.rect.id)!)
          .with(planeLayout, buffers.get(b.planeRect.id)!)
          .with(bandLayout, buffers.get(b.bandTransform.id)!)
          .with(colorLayout, buffers.get(b.color.id)!)
          .with(inverseLayout, buffers.get(b.inverseFontSize.id)!)
          .with(u4, buffers.get(b.tableStarts.id)!)
          .with(countsLayout, buffers.get(b.bandCounts.id)!);
        return preparedDraw(root, draw, start, count);
      },
    };
  } catch (error) {
    for (const value of textures) value.destroy();
    throw error;
  }
}
