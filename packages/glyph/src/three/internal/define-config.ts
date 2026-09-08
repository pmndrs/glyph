import { defineGlyphConfig, resourceLease, type RendererContext } from '../../config/glyph.js';
import { normalizeGlyphBufferCapacity } from '../../text-properties.js';
import { threeCodecDescriptor } from '../codec.js';
import type { ThreePublicationBoundary } from './publication-boundary.js';
import { createThreeCodec, threeCodecResources } from './renderer-resources.js';
import {
  ThreeRootHost,
  normalizeThreeRootCompositing,
  threeTextConstructionToken,
  type ThreeRootOptions,
} from '../text.js';

import {
  ThreeSchema,
  ThreeFontFormats,
  type ThreeConfigOptions,
  type ThreeGlyphConfig,
  type ThreeBindings,
  type ThreeCodec,
} from '../schema.js';
import type { ThreeShaderSet } from './shader-set.js';

/** Creates a pure Three config descriptor; every handle still owns independent mutable state. */
export function createThreeConfig(options: ThreeConfigOptions, shaders: ThreeShaderSet): ThreeGlyphConfig {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('ThreeConfig options must be an object');
  }
  const transformMode = options.transformMode ?? 'indexed';
  const allocationMode = options.allocationMode ?? 'ordered';
  const defaultFontFormat = options.defaultFontFormat ?? 'msdf';
  const capacity =
    options.capacity === undefined ? undefined : normalizeGlyphBufferCapacity(options.capacity, 'ThreeConfig capacity');
  const compositing =
    options.compositing === undefined
      ? undefined
      : normalizeThreeRootCompositing(options.compositing, 'ThreeConfig compositing');
  const config = defineGlyphConfig({
    schema: ThreeSchema,
    fonts: { default: defaultFontFormat, formats: ThreeFontFormats },
    encode: ({ ids }) =>
      createThreeCodec(
        ids,
        transformMode,
        (programs) =>
          threeCodecDescriptor(
            ids,
            transformMode,
            programs.map((program) => program.codec),
            allocationMode,
          ),
        options.material,
        shaders,
      ),
    resolve: ({ format, resourceName, resources }) =>
      resourceLease(
        Object.freeze({
          format,
          resourceName,
          resources,
        }),
        () => undefined,
      ),
    renderer: (context: RendererContext<ThreeBindings, void, ThreeCodec, ThreePublicationBoundary>) => {
      if (context.defaultRenderer === undefined) {
        throw new TypeError('ThreeConfig.renderer() must be constructed by a Three publication boundary');
      }
      return context.defaultRenderer;
    },
    commands: {
      limits: {
        maxParagraphs: 4_096,
        maxClusters: 65_536,
        maxLines: 65_536,
        maxRegions: 65_536,
        maxExclusions: 1,
        maxInlineObjects: 1,
        maxSlotsPerBand: 8,
        maxOutputBytes: 64 * 1024 * 1024,
      },
      requestBytes: 64 * 1024,
      resultBytes: 256 * 1024,
      textUnits: 256,
    },
    root: {
      create: (context) => {
        if (context.fonts === undefined) throw new TypeError('Three GlyphConfig must declare font formats');
        const rootOptions: ThreeRootOptions = {
          ...(capacity === undefined ? {} : { capacity }),
          ...(compositing === undefined ? {} : { compositing }),
        };
        const root = new ThreeRootHost(
          threeTextConstructionToken,
          context.name,
          context.fonts,
          context.services,
          threeCodecResources(context.codec),
          rootOptions,
        );
        const selected = context.create(root.publicRoot(), {
          boundary: root.boundary(options.material),
          defaultRenderer: root.renderer,
          shape: {
            prepare: () => root.prepareShape(),
            accepted: () => root.acceptShape(),
            rejected: (error) => root.rejectShape(error),
          },
          dispose: () => root.disposeHost(),
        });
        root.bindPublicRoot(selected);
        return selected;
      },
    },
  });
  config satisfies ThreeGlyphConfig;
  return config;
}
