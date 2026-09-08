import { d, type TgpuRoot, type TgpuBindGroup, type TgpuRenderPass } from 'typegpu';
import type { Codec, GlyphConfigFor, GlyphHandle, GlyphRoot } from '../index.js';
import { defineGlyphConfig, resourceLease } from '../config/glyph.js';
import { bitmap } from '../raster/bitmap.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug.js';
import { schema } from './internal/bindings.js';
import { codecDescriptor } from './internal/codec.js';
import { createResource } from './internal/resources.js';
import { Renderer, type TypeGpuTransform } from './internal/renderer.js';
import { createText, type TypeGpuFontSelection, type TypeGpuText, type TypeGpuTextOptions } from './text.js';

/** Vertex-stage callback: top-left, y-down logical pixels (including text.position) to homogeneous clip coordinates.
 * May capture TypeGPU resources. Slug estimates its antialiasing footprint from nearby positions;
 * matrix projections are exact, while nonlinear deformations use a local approximation.
 */
export type TypeGpuPositionTransform = (position: d.v3f, viewport: d.v2f) => d.v4f;
/** Fragment-stage callback: straight RGBA after raster coverage, plus WebGPU fragment position (physical pixels).
 * Preserve color.a to retain glyph edges. May capture TypeGPU resources; runs for fill, outline, and shadow together.
 */
export type TypeGpuColorTransform = (color: d.v4f, fragmentPosition: d.v4f) => d.v4f;

export interface TypeGpuConfigOptions {
  /** Caller-owned TypeGPU root. Disposing Glyph leaves this root and its device alive. */
  readonly root: TgpuRoot;
  /** Color attachment format of the passes used with draw(). */
  readonly format: GPUTextureFormat;
  readonly sampleCount?: 1 | 4;
  /** Optional depth state. The caller must supply a matching depth attachment in draw(). */
  readonly depthStencil?: GPUDepthStencilState;
  /** Optional 'use gpu' function replacing the default 2D pixel projection. Fixed for this config's lifetime. */
  readonly transformPosition?: TypeGpuPositionTransform;
  /** Optional 'use gpu' function transforming the final fragment color. Fixed for this config's lifetime. */
  readonly transformColor?: TypeGpuColorTransform;
  readonly defaultFontFormat?: 'bitmap' | 'msdf' | 'slug';
}
export interface TypeGpuFontFormats {
  readonly bitmap: typeof bitmap;
  readonly msdf: typeof msdf;
  readonly slug: typeof slug;
}
/** Reusable draw bindings for a TypeGPU text root. The originating handle owns the text and its lifetime. */
export interface TypeGpuDraw {
  /** Returns a new draw view; the last group for a layout wins. Does not mutate this view or own caller resources. */
  with(bindGroup: TgpuBindGroup): TypeGpuDraw;
  /** Records current accepted text with these bindings. Never submits or ends the caller-owned pass. */
  draw(
    pass: TgpuRenderPass | GPURenderPassEncoder,
    viewport: { readonly width: number; readonly height: number },
  ): void;
}
export interface TypeGpuRoot extends GlyphRoot, TypeGpuDraw {
  createText<Selection extends TypeGpuFontSelection>(options: TypeGpuTextOptions<Selection>): TypeGpuText<Selection>;
}
export type TypeGpuHandle = GlyphHandle<TypeGpuRoot>;
export type TypeGpuGlyphConfig = GlyphConfigFor<typeof schema, TypeGpuRoot, void, Codec, TypeGpuFontFormats>;

function createDraw(renderer: Renderer, bindGroups: readonly TgpuBindGroup[]): TypeGpuDraw {
  return {
    with(bindGroup) {
      return createDraw(renderer, [...bindGroups.filter((group) => group.layout !== bindGroup.layout), bindGroup]);
    },
    draw(pass, viewport) {
      renderer.draw(pass, viewport.width, viewport.height, bindGroups);
    },
  };
}

/** A renderer integration using the shared bitmap, MSDF, and Slug shader functions. */
export function defineTypeGpuConfig(options: TypeGpuConfigOptions): TypeGpuGlyphConfig {
  return defineGlyphConfig({
    schema,
    fonts: { default: options.defaultFontFormat ?? 'msdf', formats: { bitmap, msdf, slug } },
    encode: ({ ids }) => ({ descriptor: codecDescriptor(ids) }),
    resolve: ({ format, payload }) => {
      const resource = createResource(options, format, payload);
      return resourceLease(resource, () => resource.dispose());
    },
    renderer: ({ defaultRenderer }) => {
      if (defaultRenderer === undefined) throw new Error('TypeGPU renderer requires its configured root');
      return defaultRenderer;
    },
    root: {
      create(context) {
        const renderer = new Renderer(options.root);
        const texts = new Set<TypeGpuText>();
        const transforms = new Set<TypeGpuTransform>();
        const retired = new Set<TypeGpuTransform>();
        let disposed = false;
        const dispose = (): void => {
          if (disposed) return;
          disposed = true;
          for (const text of texts) text.dispose();
          for (const transform of transforms) transform.position.buffer.destroy();
          texts.clear();
          transforms.clear();
          retired.clear();
          renderer.dispose();
        };
        try {
          return context.create(
            {
              createText<Selection extends TypeGpuFontSelection>(
                textOptions: TypeGpuTextOptions<Selection>,
              ): TypeGpuText<Selection> {
                if (disposed) throw new Error('TypeGPU root is disposed');
                const transform = { position: options.root.createUniform(d.vec2f) };
                let text: TypeGpuText<Selection>;
                try {
                  text = createText(context.fonts!, context.services, transform, textOptions, () => {
                    texts.delete(text);
                    retired.add(transform);
                  });
                } catch (error) {
                  transform.position.buffer.destroy();
                  throw error;
                }
                texts.add(text);
                transforms.add(transform);
                return text;
              },
              ...createDraw(renderer, []),
            },
            {
              boundary: undefined,
              defaultRenderer: renderer,
              dispose,
              shape: {
                accepted: () => {
                  for (const transform of retired) {
                    transform.position.buffer.destroy();
                    transforms.delete(transform);
                  }
                  retired.clear();
                },
              },
            },
          );
        } catch (error) {
          dispose();
          throw error;
        }
      },
    },
  });
}
