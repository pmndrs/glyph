import * as THREE from 'three/webgpu';

import {
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  type GlyphBindings,
  type GlyphBatchBindingInput,
  type GlyphBufferBindingInput,
  type GlyphConfig,
  type GlyphHandle,
  type GlyphInstanceSpanBindingInput,
  type GlyphRootInstanceBindingInput,
  type GlyphSchema,
  type PolicyProgram,
} from '../core.js';
import type { AnyFontFaceSelection, FontFaceTechniqueOf } from '../font-face.js';
import type { Font } from '../font.js';
import { bitmap } from '../raster/bitmap-technique.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug-technique.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { normalizeGlyphBufferCapacity } from '../text-properties.js';
import type { PortableResource } from '../core.js';
import { loadThreeTechnique } from './internal/builtin-shaders.js';
import { threeRenderPolicyDescriptor } from './render-policy.js';
import type { ThreeAllocationMode, ThreeTransformMode } from './render-policy.js';
import type { ThreeRootContext, ThreeTextMaterial } from './material.js';
import { createThreeCodec, type ThreeCodec } from './renderer-resources.js';
import { ThreeRoot, normalizeThreeRootCompositing, threeTextConstructionToken, type ThreeRootOptions } from './text.js';

export interface ThreeProgramBinding {
  readonly kind: 'three-program';
  readonly program: PolicyProgram;
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
  readonly technique: string;
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
  readonly defaultFontFormat?: keyof ThreeFontTechniques;
  /** Renderer-wide fallback after span, Text, TextGroup, and root material selection. */
  readonly material?: ThreeTextMaterial;
}

export interface ThreeFontTechniques {
  readonly bitmap: typeof bitmap;
  readonly msdf: typeof msdf;
  readonly slug: typeof slug;
}

export const ThreeFontTechniques: ThreeFontTechniques = Object.freeze({ bitmap, msdf, slug });

/** Config-facing binding for one Three publication root. */
export interface ThreeRootBinding {
  readonly drawRoot: THREE.Object3D;
  readonly root: ThreeRootContext;
  readonly material: ThreeTextMaterial | undefined;
  objectForTransform?(recordIndex: number, source: THREE.Object3D): THREE.Object3D;
}

export const ThreeSchema: GlyphSchema<ThreeBindings, ThreeRootBinding> = defineGlyphSchema<ThreeBindings>()({
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

export type ThreeGlyphConfig = GlyphConfig<
  ThreeRoot,
  ThreeBindings,
  void,
  PortableResource,
  ThreeFontTechniques,
  ThreeRootBinding,
  ThreeCodec,
  ThreeRootOptions & { material?: ThreeTextMaterial }
>;
/** @internal Resolve the anonymous root fronted by a Three handle. */
export function threeHandleRoot(handle: ThreeHandle): ThreeRoot {
  if (handle.handle !== handle || typeof handle.createText !== 'function') {
    throw new TypeError('handle is not configured for Three');
  }
  return handle;
}

/** @internal Resolve the owning handle for a root selected from a callable Three handle. */
export function threeRootHandle(root: ThreeRoot): ThreeHandle {
  return root.handle;
}

/** @internal Acquire an independent mounted Font lease from one loaded handle selection. */
export function acquireThreeHandleFont<const Selection extends AnyFontFaceSelection>(
  handle: ThreeHandle,
  selection: Selection,
): Font<FontFaceTechniqueOf<Selection>> {
  return threeHandleRoot(handle).acquireFont<FontFaceTechniqueOf<Selection>>(selection);
}

/** @internal Borrow the handle store's immutable source for a render-phase snapshot. */
export function threeHandleFontSource(handle: ThreeHandle, selection: AnyFontFaceSelection): Font<AnyRasterTechnique> {
  return threeHandleRoot(handle).fontSource(selection);
}

/** Creates a pure Three config descriptor; every handle still owns independent mutable state. */
export function defineThreeConfig(options: ThreeConfigOptions = {}): ThreeGlyphConfig {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('ThreeConfig options must be an object');
  }
  const transformMode = options.transformMode ?? 'indexed';
  const allocationMode = options.allocationMode ?? 'ordered';
  const defaultFontFormat = options.defaultFontFormat ?? 'msdf';
  return defineGlyphConfig({
    schema: ThreeSchema,
    fonts: { default: defaultFontFormat, techniques: ThreeFontTechniques, loadTechnique: loadThreeTechnique },
    encode: ({ ids }) =>
      createThreeCodec(
        ids,
        transformMode,
        (programs) =>
          threeRenderPolicyDescriptor(
            ids,
            transformMode,
            programs.map((program) => program.policy),
            allocationMode,
          ),
        options.material,
      ),
    resolve: ({ technique, resourceName, resources }) =>
      resourceLease(
        Object.freeze({
          technique,
          resourceName,
          resources,
        }),
        () => undefined,
      ),
    renderer: (context) => {
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
        if (context.fonts === undefined) throw new TypeError('Three GlyphConfig must declare font techniques');
        const rootOptions: ThreeRootOptions = {
          ...(context.config.capacity === undefined ? {} : { capacity: context.config.capacity }),
          ...(context.config.compositing === undefined ? {} : { compositing: context.config.compositing }),
        };
        const root = new ThreeRoot(
          threeTextConstructionToken,
          context.name,
          context.fonts,
          context.services,
          context.codec.resources,
          rootOptions,
        );
        const selected = context.create(root, {
          boundary: root.boundary(context.config.material),
          defaultRenderer: root.renderer,
          dispose: () => root.disposeHost(),
        });
        root.bindPublicRoot(selected);
        return selected;
      },
    },
    ...(options.capacity === undefined
      ? {}
      : { capacity: normalizeGlyphBufferCapacity(options.capacity, 'ThreeConfig capacity') }),
    ...(options.compositing === undefined
      ? {}
      : { compositing: normalizeThreeRootCompositing(options.compositing, 'ThreeConfig compositing') }),
    ...(options.material === undefined ? {} : { material: options.material }),
  });
}

/** Built-in indexed/ordered Three adapter. Spreading it preserves hooks without shared handle state. */
export const ThreeConfig: ThreeGlyphConfig = defineThreeConfig();
