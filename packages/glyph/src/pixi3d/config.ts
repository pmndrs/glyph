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

export function definePixi3DConfig(): Pixi3DGlyphConfig {
  return defineGlyphConfig({
    schema: Pixi3DSchema,
    fonts: { default: 'msdf', formats: { bitmap, msdf, slug } },
    encode: ({ ids }) => ({ descriptor: pixi3dCodecDescriptor(ids) }),
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
          rejectPublication(error: unknown): void;
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
            // The engine throws the rejection from `glyph.shape()`; each text keeps it as its `error`.
            rejected: (error) => {
              for (const text of texts) text.rejectPublication(error);
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
