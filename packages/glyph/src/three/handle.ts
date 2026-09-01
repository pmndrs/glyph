import * as THREE from 'three/webgpu';

import {
  defaultDecoder,
  defineGlyphConfig,
  resourceLease,
  type AnyGlyphConfig,
  type GlyphBindings,
  type GlyphConfig,
  type GlyphHandle,
  type GlyphRenderer,
  type RendererContext,
} from '../core.js';
import type { GlyphEngine } from '../glyph-engine.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { ThreeTextEngineCoordinator } from './engine-coordinator.js';
import type { PortableResource } from '../core.js';
import type { ThreeEngineDomainLease, ThreeEngineDomainProvider } from './engine-domain.js';
import { threePolicyCapabilitySet, threeRenderPolicyDescriptor } from './render-policy.js';
import type { ThreeAllocationMode, ThreeTransformMode } from './render-policy.js';
import type { ThreeTextMaterial } from './material.js';
import { Text, TextGroup, type StandaloneTextProperties, type TextGroupOptions } from './text.js';

export interface ThreeProgramBinding {
  readonly kind: 'three-program';
}

export interface ThreeBufferBinding {
  readonly kind: 'three-buffer';
}

export interface ThreePrimitiveBinding {
  readonly kind: 'three-primitive';
}

export interface ThreeDrawBinding {
  readonly kind: 'three-draw';
}

export interface ThreePortableResource {
  readonly technique: string;
  readonly resourceName: string;
  readonly resources: ReadonlyMap<string, PortableResource>;
}

export interface ThreeResolvedResourceBinding extends ThreePortableResource {}

export type ThreeBindings = GlyphBindings<
  ThreeResolvedResourceBinding,
  ThreeBufferBinding,
  ThreeProgramBinding,
  ThreeTextMaterial,
  THREE.Object3D,
  ThreePrimitiveBinding,
  ThreeDrawBinding
>;

export interface ThreeHandle extends GlyphHandle {
  createText<Technique extends AnyRasterTechnique>(properties: StandaloneTextProperties<Technique>): Text<Technique>;
  createTextGroup(options?: TextGroupOptions): TextGroup;
}

export interface ThreeConfigOptions {
  readonly transformMode?: ThreeTransformMode;
  readonly allocationMode?: ThreeAllocationMode;
}

export type ThreeGlyphConfig = GlyphConfig<ThreeHandle, ThreeBindings, void, ThreePortableResource>;
const handleDomains = new WeakMap<ThreeHandle, ThreeEngineDomainProvider>();

export interface ThreeRendererContext extends RendererContext<ThreeBindings> {
  readonly defaultRenderer: GlyphRenderer<ThreeBindings, void>;
}

/** @internal Resolve the construction binding without adding it to the public handle surface. */
export function threeHandleDomain(handle: ThreeHandle): ThreeEngineDomainProvider {
  const domain = handleDomains.get(handle);
  if (domain === undefined) throw new TypeError('Three handle was not created by glyph.handle() with ThreeConfig');
  return domain;
}

/** Creates a pure Three config descriptor; every handle still owns independent mutable state. */
export function defineThreeConfig(options: ThreeConfigOptions = {}): ThreeGlyphConfig {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('ThreeConfig options must be an object');
  }
  const transformMode = options.transformMode ?? 'indexed';
  const allocationMode = options.allocationMode ?? 'ordered';
  return defineGlyphConfig<ThreeHandle, ThreeBindings, void, ThreePortableResource>({
    capabilities: threePolicyCapabilitySet(),
    encode: ({ ids }) => ({ descriptor: threeRenderPolicyDescriptor(ids, transformMode, [], allocationMode) }),
    decode: defaultDecoder,
    resolve: ({ payload }) =>
      resourceLease(
        Object.freeze({
          technique: payload.technique,
          resourceName: payload.resourceName,
          resources: payload.resources,
        }),
        () => undefined,
      ),
    renderer: (context) => {
      const configured = context as ThreeRendererContext;
      if (configured.defaultRenderer === undefined) {
        throw new TypeError('ThreeConfig.renderer() must be constructed by a Three publication boundary');
      }
      return configured.defaultRenderer;
    },
    createHandle: (context) => {
      const domain = new ThreeHandleDomain(context.engine, context.config);
      const handle = context.create(
        {
          createText: <Technique extends AnyRasterTechnique>(properties: StandaloneTextProperties<Technique>) => {
            domain.assertActive();
            return new Text(properties, domain);
          },
          createTextGroup: (groupOptions: TextGroupOptions = {}) => {
            domain.assertActive();
            return new TextGroup(groupOptions, domain);
          },
        },
        () => domain.releaseHandle(),
      );
      handleDomains.set(handle, domain);
      return handle;
    },
  });
}

/** Built-in indexed/ordered Three adapter. Spreading it preserves hooks without shared handle state. */
export const ThreeConfig: ThreeGlyphConfig = defineThreeConfig();

class ThreeHandleDomain implements ThreeEngineDomainProvider {
  readonly coordinator: ThreeTextEngineCoordinator;
  readonly #config: ThreeGlyphConfig;
  #leases = 0;
  #handleReleased = false;
  #disposed = false;

  constructor(engine: GlyphEngine, config: AnyGlyphConfig) {
    this.#config = config as ThreeGlyphConfig;
    this.coordinator = new ThreeTextEngineCoordinator(engine, {}, this.#config);
  }

  acquire(): ThreeEngineDomainLease {
    this.assertActive();
    return this.#retain();
  }

  assertActive(): void {
    if (this.#handleReleased || this.#disposed) throw new Error('Three Glyph handle has been disposed');
  }

  releaseHandle(): void {
    if (this.#handleReleased) return;
    this.#handleReleased = true;
    this.#maybeDispose();
  }

  #retain(): ThreeEngineDomainLease {
    if (this.#disposed) throw new Error('Three Glyph handle domain has been disposed');
    this.#leases += 1;
    let disposed = false;
    return Object.freeze({
      coordinator: this.coordinator,
      retain: () => {
        if (disposed) throw new Error('Three Glyph handle domain lease has been disposed');
        return this.#retain();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.#leases -= 1;
        this.#maybeDispose();
      },
    });
  }

  #maybeDispose(): void {
    if (!this.#handleReleased || this.#leases !== 0 || this.#disposed) return;
    this.#disposed = true;
    this.coordinator.dispose();
    void this.#config;
  }
}
