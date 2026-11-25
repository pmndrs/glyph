import type { Codec, GlyphConfigFor, GlyphHandle, GlyphRoot } from '../index.js';
import { defineGlyphConfig, resourceLease } from '../config/glyph.js';
import { bitmap } from '../raster/bitmap.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug.js';

import { Pixi3DSchema, type Pixi3DRootBoundary } from './internal/bindings.js';
import { pixi3dCodecDescriptor } from './internal/codec.js';
import { Pixi3DRenderer } from './internal/renderer.js';
import { resolveRasterResource } from './internal/resource.js';
import { RenderFailures } from '../render-failures.js';
import { Pixi3DText, type Pixi3DFontSelection, type Pixi3DTextOptions } from './text.js';

export interface Pixi3DFontFormats {
  readonly bitmap: typeof bitmap;
  readonly msdf: typeof msdf;
  readonly slug: typeof slug;
}

export interface Pixi3DRootExtension {
  createText<Selection extends Pixi3DFontSelection>(options: Pixi3DTextOptions<Selection>): Pixi3DText<Selection>;
}

export type Pixi3DRoot = GlyphRoot & Pixi3DRootExtension;
export type Pixi3DHandle = GlyphHandle<Pixi3DRoot>;
export type Pixi3DGlyphConfig = GlyphConfigFor<typeof Pixi3DSchema, Pixi3DRoot, void, Codec, Pixi3DFontFormats>;

export interface Pixi3DConfigOptions {
  /**
   * Publishes each glyph's layout index and pen origin for shader bits that declare the `aGlyphFacts` attribute
   * (`float32x4`: the origin's x and y, then the index). The index is the one `Pixi3DText.glyphs()` reports the glyph
   * at, counting every glyph of the text in the order it is drawn, blanks included; it is a position, not an identity,
   * and an edit before a glyph shifts it. The origin is `glyphs().x`, `-glyphs().y` at that index: the pen origin on
   * the baseline in the paragraph space of the vertex `position` the Glyph raster bit writes, so `position.xy -
   * aGlyphFacts.xy` is a vertex's offset from its own glyph. Off by default, and a material of a handle without it
   * throws when a bit declares the attribute: the facts are 16 more bytes per glyph that the engine gathers for every
   * text of the handle. Only a material whose bits declare the attribute carries it per vertex.
   */
  readonly glyphFacts?: boolean;
}

export function definePixi3DConfig(config: Pixi3DConfigOptions = {}): Pixi3DGlyphConfig {
  if (typeof config !== 'object' || config === null) throw new TypeError('Pixi3D config options must be an object');
  const glyphFacts = config.glyphFacts ?? false;
  if (typeof glyphFacts !== 'boolean') throw new TypeError('Pixi3D config glyphFacts must be a boolean');
  return defineGlyphConfig({
    schema: Pixi3DSchema,
    fonts: { default: 'msdf', formats: { bitmap, msdf, slug } },
    encode: ({ ids }) => ({ descriptor: pixi3dCodecDescriptor(ids, glyphFacts) }),
    resolve: ({ format, resourceName, payload }) => {
      const resource = resolveRasterResource(format, resourceName, payload);
      return resourceLease(resource, () => {
        if (resource.format === 'pmndrs.bitmap') resource.bitmap.dispose();
        else if (resource.format === 'pmndrs.msdf') resource.msdf.dispose();
        else resource.slug.dispose();
      });
    },
    renderer: ({ defaultRenderer }) => {
      if (defaultRenderer === undefined) throw new Error('Pixi3D renderer requires its configured root');
      return defaultRenderer;
    },
    root: {
      create(context) {
        if (context.fonts === undefined) throw new TypeError('Pixi3D config must declare raster fonts');
        const renderer = new Pixi3DRenderer();
        const failures = new RenderFailures();
        const texts = new Set<{
          preparePublication(failures: RenderFailures): void;
          acceptPublication(): void;
          dispose(): void;
        }>();
        const fonts = context.fonts;
        const services = context.services;
        const extension: Pixi3DRootExtension = {
          createText<Selection extends Pixi3DFontSelection>(options: Pixi3DTextOptions<Selection>) {
            const text: Pixi3DText<Selection> = new Pixi3DText(fonts, services, options, () => {
              texts.delete(text);
            });
            texts.add(text);
            return text;
          },
        };
        const boundary: Pixi3DRootBoundary = Object.freeze({ name: context.name });
        const accept = (): void => {
          for (const text of texts) text.acceptPublication();
          renderer.syncTransforms();
        };
        return context.create(extension, {
          boundary,
          defaultRenderer: renderer,
          shape: {
            // Every dirty paragraph is prepared by now, so resolving anchors reads summaries without engine work.
            prepared: () => {
              for (const text of texts) text.preparePublication(failures);
            },
            unchanged: accept,
            // `glyph.shape()` is this integration's render entry: after the root accepted, it throws a refusal once.
            // An unchanged root defers it to its next accepted publication, as a throw there would reject the root.
            accepted: () => {
              accept();
              failures.throwFound();
            },
          },
          dispose: () => {
            failures.clear();
            try {
              for (const text of texts) text.dispose();
            } finally {
              renderer.dispose();
            }
          },
        });
      },
    },
  });
}

export const Pixi3DConfig: Pixi3DGlyphConfig = definePixi3DConfig();
