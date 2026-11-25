import tgpu, { d, std, type TgpuRenderPipeline, type TgpuRoot } from 'typegpu';
import type { CodecBufferId, PortableResource, PortableLeafResource } from '../../index.js';
import { bitmapSchema } from '../../raster/bitmap.js';
import { slugSchema } from '../../raster/slug.js';
import { SLUG_RESIDENT_BAND_CURVE_WIDTH } from '../../raster/internal/slug-residency.js';
import { ResidentSlugBands } from './slug-bands.js';
import { bitmapFragment, bitmapQuadPosition, bitmapAtlasUv } from '../../shaders/typegpu/bitmap-shader.js';
import { slugRender, SlugShaderGlyph } from '../../shaders/typegpu/slug/slug-render.js';
import { slugDilate } from '../../shaders/typegpu/slug/core/dilate.js';
import {
  slugBandCurveTexelSlot,
  slugBandCurveWidthAccessor,
  slugHeaderTexelSlot,
  slugHeaderWidthAccessor,
  slugUnpackHalvesSlot,
} from '../../shaders/typegpu/slug/slug-texture.js';
import { bitmapPageAccessor } from '../../shaders/typegpu/bitmap-shader.js';
import {
  TYPEGPU_GLYPH_FACTS_BUFFER_ID,
  TYPEGPU_PLACEMENT_SLOT_BUFFER_ID,
  TYPEGPU_TRANSFORM_INDEX_BUFFER_ID,
} from './codec.js';
import { msdfResource } from './msdf.js';
import {
  colorTransform,
  corner,
  createSceneGroup,
  drawGlyph,
  publishesGlyphFacts,
  recordDraw,
  shaderRoot,
  sceneFunctions,
  textScene,
  target,
  type SceneLayout,
  type PipelineOptions,
  type TypeGpuResource,
} from './pipeline.js';

export type { TypeGpuResource } from './pipeline.js';

/** One row of a Slug page's `glyphs` table: the em quad and band transform, then the table bases and band counts. */
const SlugGlyphRow = d.struct({ quad: d.vec4f, band: d.vec4f, starts: d.vec4u, counts: d.vec4u });
/**
 * Slug binds its page with the session tables in one group, as MSDF binds its font: a caller may bring up to two groups
 * of its own and the catch-all takes one, within WebGPU's four.
 */
const slugPage = tgpu.bindGroupLayout({
  viewport: { uniform: d.vec2f },
  placementSlots: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  placements: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
  transformIndices: { storage: d.arrayOf(d.u32), access: 'readonly', visibility: ['vertex'] },
  transforms: { storage: d.arrayOf(d.vec2f), access: 'readonly', visibility: ['vertex'] },
  headers: { texture: d.texture2d(d.u32), visibility: ['fragment'] },
  bandCurves: { texture: d.texture2d(d.u32), visibility: ['fragment'] },
  glyphs: { storage: d.arrayOf(SlugGlyphRow), access: 'readonly', visibility: ['vertex'] },
});
/** The lane a config created with `glyphFacts: true` adds to a vertex stage, and what it hands its fragment stage. */
const glyphInputs = { glyphFacts: d.vec4f };
const glyphVaryings = { glyphIndex: d.interpolate('flat', d.u32), glyphOrigin: d.interpolate('flat', d.vec2f) };
/** One record of the glyph facts lane: the pen origin, then the layout index as a float. */
interface GlyphInput {
  readonly glyphFacts: d.v4f;
}
interface GlyphVarying {
  readonly glyphIndex: number;
  readonly glyphOrigin: d.v2f;
}
const glyphFactsLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), 'instance');
const slugScene = sceneFunctions(slugPage as unknown as SceneLayout);
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
    const facts = publishesGlyphFacts(options);
    const vertexIn = {
      index: d.builtin.vertexIndex,
      instance: d.builtin.instanceIndex,
      origin: d.vec2f,
      size: d.vec2f,
      uvOrigin: d.vec2f,
      uvSize: d.vec2f,
      color: d.vec4f,
      layer: d.u32,
    };
    const varyings = { uv: d.vec2f, color: d.vec4f, layer: d.interpolate('flat', d.u32) };
    const vertexOut = { position: d.builtin.position, ...varyings };
    const fragmentIn = { position: d.builtin.position, ...varyings };
    const vertex = tgpu.vertexFn({
      in: (facts ? { ...vertexIn, ...glyphInputs } : vertexIn) as typeof vertexIn,
      out: (facts ? { ...vertexOut, ...glyphVaryings } : vertexOut) as typeof vertexOut,
    })((input) => {
      'use gpu';
      const unit = corner(input.index);
      if (facts) {
        const inputIndex = d.u32((input as typeof input & GlyphInput).glyphFacts.z);
        const inputOrigin = (input as typeof input & GlyphInput).glyphFacts.xy;
        const offset = textScene.textOffset(input.instance);
        const glyphOrigin = textScene.placedOrigin(inputOrigin, input.instance).add(offset);
        drawGlyph(inputIndex, glyphOrigin);
        return {
          position: textScene.projectText(
            bitmapQuadPosition(textScene.placedOrigin(input.origin, input.instance), input.size, unit),
            offset,
          ),
          uv: bitmapAtlasUv(input.uvOrigin, input.uvSize, unit),
          color: input.color,
          layer: input.layer,
          glyphIndex: inputIndex,
          glyphOrigin,
        };
      }
      return {
        position: textScene.projectText(
          bitmapQuadPosition(textScene.placedOrigin(input.origin, input.instance), input.size, unit),
          textScene.textOffset(input.instance),
        ),
        uv: bitmapAtlasUv(input.uvOrigin, input.uvSize, unit),
        color: input.color,
        layer: input.layer,
      };
    });
    const fragment = tgpu.fragmentFn({
      in: (facts ? { ...fragmentIn, ...glyphVaryings } : fragmentIn) as typeof fragmentIn,
      out: d.vec4f,
    })((input) => {
      'use gpu';
      if (facts) {
        const inputIndex = (input as typeof input & GlyphVarying).glyphIndex;
        const inputOrigin = (input as typeof input & GlyphVarying).glyphOrigin;
        drawGlyph(inputIndex, inputOrigin);
      }
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
          ...(facts ? { glyphFacts: glyphFactsLayout.attrib } : {}),
        },
        targets: target(options),
        multisample: { count: options.sampleCount ?? 1 },
        depthStencil: options.depthStencil,
      });
    pipeline.initSync();
    return {
      dispose: () => atlas.destroy(),
      bind(lanes) {
        const lane = (id: CodecBufferId): GPUBuffer => {
          const buffer = lanes.buffers.get(id);
          if (buffer === undefined) throw new Error('TypeGPU bitmap draw is missing one of its lanes');
          return buffer;
        };
        const b = bitmapSchema.buffers;
        const bound = pipeline
          .with(
            createSceneGroup(
              root,
              lanes,
              lane(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID),
              lane(TYPEGPU_TRANSFORM_INDEX_BUFFER_ID),
            ),
          )
          .with(originLayout, lane(b.origin.id))
          .with(sizeLayout, lane(b.size.id))
          .with(uvOriginLayout, lane(b.uvOrigin.id))
          .with(uvSizeLayout, lane(b.uvSize.id))
          .with(colorLayout, lane(b.color.id))
          .with(u1, lane(b.page.id));
        const drawn = facts ? bound.with(glyphFactsLayout, lane(TYPEGPU_GLYPH_FACTS_BUFFER_ID)) : bound;
        return {
          watchedLanes: [],
          variant: () => 0,
          draw(pass, bindGroups, _variant, first, count) {
            recordDraw(root, drawn, pass, bindGroups, first, count);
          },
        };
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
  const bands = new ResidentSlugBands(root, members.curves!, members.references!, members.glyphs!);
  let headers: ReturnType<typeof texture> | undefined;
  try {
    headers = texture(root, members.headers!);
    const headerView = root.unwrap(headers).createView();
    const headerWidth = headers.props.size[0];
    const varyings = {
      coordinate: d.vec2f,
      color: d.vec4f,
      band: d.vec4f,
      starts: d.interpolate('flat', d.vec4u),
      counts: d.interpolate('flat', d.vec2u),
    };
    const facts = publishesGlyphFacts(options);
    const vertexIn = {
      index: d.builtin.vertexIndex,
      instance: d.builtin.instanceIndex,
      rect: d.vec4f,
      color: d.vec4f,
      glyph: d.vec2u,
    };
    const vertexOut = { position: d.builtin.position, ...varyings };
    const fragmentIn = { position: d.builtin.position, ...varyings };
    const vertex = tgpu.vertexFn({
      in: (facts ? { ...vertexIn, ...glyphInputs } : vertexIn) as typeof vertexIn,
      out: (facts ? { ...vertexOut, ...glyphVaryings } : vertexOut) as typeof vertexOut,
    })((input) => {
      'use gpu';
      if (facts) {
        const inputIndex = d.u32((input as typeof input & GlyphInput).glyphFacts.z);
        const inputOrigin = (input as typeof input & GlyphInput).glyphFacts.xy;
        drawGlyph(
          inputIndex,
          slugScene.placedOrigin(inputOrigin, input.instance).add(slugScene.textOffset(input.instance)),
        );
      }
      const unit = corner(input.index);
      // What every drawing of a glyph shares is read once per vertex from the page's glyph table.
      const row = slugPage.$.glyphs[input.glyph.x]!;
      const origin = slugScene.placedOrigin(input.rect.xy, input.instance);
      const offset = slugScene.textOffset(input.instance);
      const local = d.vec2f(origin.x + unit.x * input.rect.z, -(origin.y + unit.y * input.rect.w));
      const normal = d.vec2f((unit.x - 0.5) * input.rect.z, -(unit.y - 0.5) * input.rect.w);
      const em = d.vec2f(row.quad.x + unit.x * row.quad.z, row.quad.y - unit.y * row.quad.w);
      // Em units per layout unit: the quad is the em quad scaled by the font size.
      const inverseScale = (row.quad.z + row.quad.w) / std.max(input.rect.z + input.rect.w, 1e-30);
      // Local homogeneous projection derivatives keep Slug's half-pixel expansion in screen space.
      const clip = slugScene.projectText(d.vec3f(local, 0), offset);
      const dx = slugScene.projectText(d.vec3f(local.x + 1, local.y, 0), offset).sub(clip);
      const dy = slugScene.projectText(d.vec3f(local.x, local.y + 1, 0), offset).sub(clip);
      const dilated = slugDilate(
        d.vec2f(0),
        normal,
        em,
        inverseScale,
        d.vec4f(dx.x, dy.x, 0, clip.x),
        d.vec4f(dx.y, dy.y, 0, clip.y),
        d.vec4f(dx.w, dy.w, 0, clip.w),
        slugScene.viewportSize(),
      );
      if (facts) {
        const inputIndex = d.u32((input as typeof input & GlyphInput).glyphFacts.z);
        const inputOrigin = (input as typeof input & GlyphInput).glyphFacts.xy;
        return {
          position: slugScene.projectText(d.vec3f(local.add(dilated.xy), 0), offset),
          coordinate: dilated.zw,
          color: input.color,
          band: row.band,
          starts: row.starts,
          counts: row.counts.xy,
          glyphIndex: inputIndex,
          glyphOrigin: slugScene.placedOrigin(inputOrigin, input.instance).add(offset),
        };
      }
      return {
        position: slugScene.projectText(d.vec3f(local.add(dilated.xy), 0), offset),
        coordinate: dilated.zw,
        color: input.color,
        band: row.band,
        starts: row.starts,
        counts: row.counts.xy,
      };
    });
    const fragment = tgpu.fragmentFn({
      in: (facts ? { ...fragmentIn, ...glyphVaryings } : fragmentIn) as typeof fragmentIn,
      out: d.vec4f,
    })((input) => {
      'use gpu';
      if (facts) {
        const inputIndex = (input as typeof input & GlyphVarying).glyphIndex;
        const inputOrigin = (input as typeof input & GlyphVarying).glyphOrigin;
        drawGlyph(inputIndex, inputOrigin);
      }
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
      .with(slugHeaderWidthAccessor, d.u32(headerWidth))
      .with(slugBandCurveWidthAccessor, d.u32(SLUG_RESIDENT_BAND_CURVE_WIDTH))
      .with(slugHeaderTexelSlot, (coords) => {
        'use gpu';
        return std.textureLoad(slugPage.$.headers, coords, 0);
      })
      .with(slugBandCurveTexelSlot, (coords) => {
        'use gpu';
        return std.textureLoad(slugPage.$.bandCurves, coords, 0);
      })
      // This renderer is WebGPU only, so it decodes the packed control points with the builtin.
      .with(slugUnpackHalvesSlot, (word) => {
        'use gpu';
        return std.unpack2x16float(word);
      })
      .createRenderPipeline({
        vertex,
        fragment,
        attribs: {
          rect: rectLayout.attrib,
          color: colorLayout.attrib,
          glyph: u2.attrib,
          ...(facts ? { glyphFacts: glyphFactsLayout.attrib } : {}),
        },
        targets: target(options),
        multisample: { count: options.sampleCount ?? 1 },
        depthStencil: options.depthStencil,
      });
    pipeline.initSync();
    const ownedHeaders = headers;
    return {
      dispose: () => {
        ownedHeaders.destroy();
        bands.dispose();
      },
      bind(lanes) {
        const lane = (id: CodecBufferId): GPUBuffer => {
          const buffer = lanes.buffers.get(id);
          if (buffer === undefined) throw new Error('TypeGPU Slug draw is missing one of its lanes');
          return buffer;
        };
        const b = slugSchema.buffers;
        const glyphLane = lanes.bytes.get(b.glyph.id)!;
        // Rebuilt whenever the band curves grow into a new texture.
        let generation = -1;
        let bound: TgpuRenderPipeline | undefined;
        return {
          watchedLanes: [glyphLane],
          variant(start, count) {
            // Glyphs a frame publishes become resident at its commit, before the frame that draws them.
            bands.use(glyphLane, start, count);
            return 0;
          },
          draw(pass, bindGroups, _variant, first, count) {
            if (generation !== bands.generation || bound === undefined) {
              generation = bands.generation;
              const group = root.createBindGroup(slugPage, {
                viewport: lanes.viewport,
                placementSlots: lane(TYPEGPU_PLACEMENT_SLOT_BUFFER_ID),
                placements: lanes.placementTable,
                transformIndices: lane(TYPEGPU_TRANSFORM_INDEX_BUFFER_ID),
                transforms: lanes.transformTable,
                headers: headerView,
                bandCurves: bands.view,
                glyphs: bands.glyphs,
              });
              bound = pipeline
                .with(group)
                .with(rectLayout, lane(b.rect.id))
                .with(colorLayout, lane(b.color.id))
                .with(u2, lane(b.glyph.id));
              if (facts) {
                bound = bound.with(glyphFactsLayout, lane(TYPEGPU_GLYPH_FACTS_BUFFER_ID));
              }
            }
            recordDraw(root, bound, pass, bindGroups, first, count);
          },
        };
      },
    };
  } catch (error) {
    headers?.destroy();
    bands.dispose();
    throw error;
  }
}
