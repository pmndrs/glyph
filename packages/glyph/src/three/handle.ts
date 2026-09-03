import * as THREE from 'three/webgpu';

import {
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  type GlyphBindings,
  type GlyphBatchBindingInput,
  type GlyphBufferBindingInput,
  type GlyphConfigFor,
  type GlyphHandle,
  type GlyphInstanceSpanBindingInput,
  type GlyphRootInstanceBindingInput,
  type GlyphSchema,
  type RendererContext,
} from '../config/glyph.js';
import type { CodecProgram } from '../config/codec.js';
import type { PortableResource } from '../config/resources.js';
import { bitmap } from '../raster/bitmap.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug.js';
import { normalizeGlyphBufferCapacity } from '../text-properties.js';
import { threeCodecDescriptor } from './codec.js';
import type { ThreeAllocationMode, ThreeTransformMode } from './codec.js';
import type { ThreeRootContext, ThreeTextMaterial } from './material.js';
import { createThreeCodec, type ThreeCodec } from './internal/renderer-resources.js';
import {
  ThreeRootHost,
  normalizeThreeRootCompositing,
  threeTextConstructionToken,
  type ThreeRoot,
  type ThreeRootOptions,
} from './text.js';

export interface ThreeProgramBinding {
  readonly kind: 'three-program';
  readonly program: CodecProgram;
}

export interface ThreeBufferBinding {
  readonly kind: 'three-buffer';
  readonly input: GlyphBufferBindingInput<ThreeBindings>;
}

export interface ThreeInstanceSpanBinding {
  readonly kind: 'three-instance-span';
  readonly input: GlyphInstanceSpanBindingInput<ThreeBindings>;
}

export interface ThreeBatchBinding {
  readonly kind: 'three-batch';
  readonly input: GlyphBatchBindingInput<ThreeBindings>;
}

export interface ThreeInstanceBinding {
  readonly kind: 'three-instance';
  readonly input: GlyphRootInstanceBindingInput<ThreeBindings>;
}

export interface ThreePortableResource {
  readonly format: string;
  readonly resourceName: string;
  readonly resources: ReadonlyMap<string, PortableResource>;
}

export interface ThreeResolvedResourceBinding extends ThreePortableResource {}

/** Renderer-facing material selection after Text/TextGroup scene properties have been resolved. */
export interface ThreeMaterialBinding {
  readonly material: ThreeTextMaterial | undefined;
  readonly pixelSnapping: boolean;
  readonly renderOrder: number;
}

export interface ThreeResolvedMaterialBinding extends ThreeMaterialBinding {
  readonly root: ThreeRootContext;
}

export type ThreeBindings = GlyphBindings<
  ThreeResolvedResourceBinding,
  ThreeBufferBinding,
  ThreeProgramBinding,
  ThreeResolvedMaterialBinding,
  THREE.Object3D,
  ThreeBatchBinding,
  ThreeInstanceBinding,
  ThreeInstanceSpanBinding,
  THREE.Object3D,
  ThreeMaterialBinding,
  THREE.Object3D
>;

/** Callable Three handle. Its direct factories delegate to the one anonymous root. */
export type ThreeHandle = GlyphHandle<ThreeRoot>;

export interface ThreeConfigOptions extends ThreeRootOptions {
  readonly transformMode?: ThreeTransformMode;
  readonly allocationMode?: ThreeAllocationMode;
  readonly defaultFontFormat?: keyof ThreeFontFormats;
  /** Renderer-wide fallback after span, Text, TextGroup, and root material selection. */
  readonly material?: ThreeTextMaterial;
}

export interface ThreeFontFormats {
  readonly bitmap: typeof bitmap;
  readonly msdf: typeof msdf;
  readonly slug: typeof slug;
}

export const ThreeFontFormats: ThreeFontFormats = Object.freeze({ bitmap, msdf, slug });

/** Config-facing binding for one Three publication root. */
export interface ThreeRootBinding {
  readonly drawRoot: THREE.Object3D;
  readonly root: ThreeRootContext;
  readonly material: ThreeTextMaterial | undefined;
  objectForTransform?(recordIndex: number, source: THREE.Object3D): THREE.Object3D;
}

export const ThreeSchema: GlyphSchema<ThreeBindings, ThreeRootBinding> = defineGlyphSchema({
  drawRoot: (root: ThreeRootBinding) => root.drawRoot,
  program: (_root, program) => Object.freeze({ kind: 'three-program', program }),
  buffer: (_root, input) => Object.freeze({ kind: 'three-buffer', input }),
  material: (root, binding) =>
    Object.freeze({ ...binding, material: binding.material ?? root.material, root: root.root }),
  transform: (root, object, recordIndex) => root.objectForTransform?.(recordIndex, object) ?? object,
  batch: (_root, input) => Object.freeze({ kind: 'three-batch', input }),
  instance: (_root, input) => Object.freeze({ kind: 'three-instance', input }),
  instanceSpan: (_root, input) => Object.freeze({ kind: 'three-instance-span', input }),
});

export type ThreeGlyphConfig = GlyphConfigFor<typeof ThreeSchema, ThreeRoot, void, ThreeCodec, ThreeFontFormats>;

/** Creates a pure Three config descriptor; every handle still owns independent mutable state. */
export function defineThreeConfig(options: ThreeConfigOptions = {}): ThreeGlyphConfig {
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
    renderer: (context: RendererContext<ThreeBindings, void, ThreeCodec>) => {
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
          context.codec.resources,
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

/** Built-in indexed/ordered Three adapter. Spreading it preserves hooks without shared handle state. */
export const ThreeConfig: ThreeGlyphConfig = defineThreeConfig();
