import tgpu, { d, std, type TgpuRoot } from 'typegpu';
import type { PortableResource, PortableLeafResource } from '../../index.js';
import { bitmapSchema } from '../../raster/bitmap.js';
import { slugSchema } from '../../raster/slug.js';
import { bitmapFragment, bitmapQuadPosition, bitmapAtlasUv } from '../../shaders/typegpu/bitmap-shader.js';
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
import { bitmapPageAccessor } from '../../shaders/typegpu/bitmap-shader.js';
import { TYPEGPU_PLACEMENT_SLOT_BUFFER_ID } from './codec.js';
import { msdfResource } from './msdf.js';
import {
  colorTransform,
  corner,
  preparedDraw,
  projectWithScene,
  shaderRoot,
  storageTable,
  target,
  type PipelineOptions,
  type TypeGpuResource,
} from './pipeline.js';

export type { Draw, TypeGpuResource } from './pipeline.js';

function sceneEntries() {
  return {
    viewport: { uniform: d.vec2f },
    position: { uniform: d.vec2f },
    placementSlots: { storage: d.arrayOf(d.u32), access: 'readonly' as const, visibility: ['vertex' as const] },
    placements: { storage: d.arrayOf(d.vec2f), access: 'readonly' as const, visibility: ['vertex' as const] },
  };
}

const scene = tgpu.bindGroupLayout(sceneEntries());
/** One row of a Slug page's `glyphs` table: the em quad and band transform, then the table bases and band counts. */
const SlugGlyphRow = d.struct({ quad: d.vec4f, band: d.vec4f, starts: d.vec4u, counts: d.vec4u });
const slugScene = tgpu.bindGroupLayout({
  viewport: { uniform: d.vec2f },
  position: { uniform: d.vec2f },
  placements: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
  glyphs: { storage: d.arrayOf(SlugGlyphRow), access: 'readonly', visibility: ['vertex'] },
});
const v2 = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const v4 = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const u1 = tgpu.vertexLayout(d.disarrayOf(d.uint32), 'instance');
const u2 = tgpu.vertexLayout(d.disarrayOf(d.uint32x2), 'instance');
// Each attribute needs its own layout identity, even when its physical shape matches.
const originLayout = v2;
const sizeLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const uvOriginLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const uvSizeLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x2), 'instance');
const colorLayout = v4;
const rectLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');

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
export function createResource(options: PipelineOptions, format: string, payload: PortableResource): TypeGpuResource {
  if (format === 'pmndrs.bitmap') return bitmapResource(options, payload);
  if (payload.kind !== 'group') throw new Error('Expected grouped raster resources');
  if (format === 'pmndrs.msdf') return msdfResource(options, payload.members);
  if (format === 'pmndrs.slug') return slugResource(options, payload.members);
  throw new TypeError(`TypeGPU cannot render raster format "${format}"`);
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
function slugResource(
  options: PipelineOptions,
  members: Readonly<Record<string, PortableLeafResource>>,
): TypeGpuResource {
  const { root } = options;
  const textures: ReturnType<typeof texture>[] = [];
  const glyphs = storageTable(root, members.glyphs!);
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
      counts: d.interpolate('flat', d.vec2u),
    };
    const vertex = tgpu.vertexFn({
      in: {
        index: d.builtin.vertexIndex,
        rect: d.vec4f,
        color: d.vec4f,
        glyph: d.vec2u,
      },
      out: { position: d.builtin.position, ...varyings },
    })((input) => {
      'use gpu';
      const unit = corner(input.index);
      // What every drawing of a glyph shares is read once per vertex from the page's glyph table.
      const row = slugScene.$.glyphs[input.glyph.x]!;
      const origin = placedSlugOrigin(input.rect.xy, input.glyph.y);
      const local = d.vec2f(origin.x + unit.x * input.rect.z, -(origin.y + unit.y * input.rect.w));
      const normal = d.vec2f((unit.x - 0.5) * input.rect.z, -(unit.y - 0.5) * input.rect.w);
      const em = d.vec2f(row.quad.x + unit.x * row.quad.z, row.quad.y - unit.y * row.quad.w);
      // Em units per layout unit: the quad is the em quad scaled by the font size.
      const inverseScale = (row.quad.z + row.quad.w) / std.max(input.rect.z + input.rect.w, 1e-30);
      // Local homogeneous projection derivatives keep Slug's half-pixel expansion in screen space.
      const clip = projectSlug(d.vec3f(local, 0));
      const dx = projectSlug(d.vec3f(local.x + 1, local.y, 0)).sub(clip);
      const dy = projectSlug(d.vec3f(local.x, local.y + 1, 0)).sub(clip);
      const dilated = slugDilate(
        d.vec2f(0),
        normal,
        em,
        inverseScale,
        d.vec4f(dx.x, dy.x, 0, clip.x),
        d.vec4f(dx.y, dy.y, 0, clip.y),
        d.vec4f(dx.w, dy.w, 0, clip.w),
        slugScene.$.viewport,
      );
      return {
        position: projectSlug(d.vec3f(local.add(dilated.xy), 0)),
        coordinate: dilated.zw,
        color: input.color,
        band: row.band,
        starts: row.starts,
        counts: row.counts.xy,
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
          color: colorLayout.attrib,
          glyph: u2.attrib,
        },
        targets: target(options),
        multisample: { count: options.sampleCount ?? 1 },
        depthStencil: options.depthStencil,
      });
    pipeline.initSync();
    return {
      dispose: () => {
        for (const value of textures) value.destroy();
        glyphs.destroy();
      },
      prepare(buffers, placementTable, viewport, position, start, count) {
        const group = root.createBindGroup(slugScene, { viewport, position, placements: placementTable, glyphs });
        const b = slugSchema.buffers;
        const draw = pipeline
          .with(group)
          .with(rectLayout, buffers.get(b.rect.id)!)
          .with(colorLayout, buffers.get(b.color.id)!)
          .with(u2, buffers.get(b.glyph.id)!);
        return preparedDraw(root, draw, start, count);
      },
    };
  } catch (error) {
    for (const value of textures) value.destroy();
    glyphs.destroy();
    throw error;
  }
}
