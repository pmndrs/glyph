import type { AnyRasterTechnique } from '@pmndrs/glyph';
import {
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  type GlyphBatchBindingInput,
  type GlyphBindings,
  type GlyphBufferBindingInput,
  type GlyphConfig,
  type GlyphHandle,
  type GlyphInstanceSpanBindingInput,
  type GlyphRoot,
  type GlyphRootInstanceBindingInput,
  type GlyphRootServices,
  type GlyphSchema,
  type PolicyProgram,
  type PortableResource,
} from '@pmndrs/glyph';

import type { ExampleRendererDevice } from './device.js';
import { exampleRendererShader, RecordingExampleRendererDevice } from './device.js';
import type { ExampleDrawList } from './draw-list.js';
import { ExampleText, type ExampleTextOptions } from './engine.js';
import { exampleRenderPolicyDescriptor } from './policy.js';

export interface ExampleResolvedResource {
  readonly name: string;
  readonly resource: unknown;
}

export interface ExampleBufferBinding {
  readonly kind: 'example-buffer';
  readonly input: GlyphBufferBindingInput<ExampleBindings>;
}
export interface ExampleProgramBinding {
  readonly kind: 'example-program';
  readonly program: PolicyProgram;
}
export interface ExampleInstanceSpanBinding {
  readonly kind: 'example-instance-span';
  readonly input: GlyphInstanceSpanBindingInput<ExampleBindings>;
}
export interface ExampleBatchBinding {
  readonly kind: 'example-batch';
  readonly input: GlyphBatchBindingInput<ExampleBindings>;
}
export interface ExampleInstanceBinding {
  readonly kind: 'example-instance';
  readonly input: GlyphRootInstanceBindingInput<ExampleBindings>;
}
export interface ExampleMaterial {
  readonly kind: 'example-material';
}
export interface ExampleTransform {
  readonly kind: 'example-transform';
}

export type ExampleBindings = GlyphBindings<
  ExampleResolvedResource,
  ExampleBufferBinding,
  ExampleProgramBinding,
  ExampleMaterial,
  ExampleTransform,
  ExampleBatchBinding,
  ExampleInstanceBinding,
  ExampleInstanceSpanBinding,
  undefined,
  ExampleMaterial,
  ExampleTransform
>;

export interface ExampleRootContext {
  readonly name: string | undefined;
}

export const ExampleSchema: GlyphSchema<ExampleBindings, ExampleRootContext> = defineGlyphSchema({
  drawRoot: () => undefined,
  program: (_root: ExampleRootContext, program) => Object.freeze({ kind: 'example-program', program }),
  buffer: (_root, input) => Object.freeze({ kind: 'example-buffer', input }),
  material: (_root, material) => material,
  transform: (_root, transform) => transform,
  batch: (_root, input) => Object.freeze({ kind: 'example-batch', input }),
  instance: (_root, input) => Object.freeze({ kind: 'example-instance', input }),
  instanceSpan: (_root, input) => Object.freeze({ kind: 'example-instance-span', input }),
});

interface ExampleRootExtension {
  createText<Technique extends AnyRasterTechnique>(options: ExampleTextOptions<Technique>): ExampleText<Technique>;
  publish(): ExampleDrawList;
}

export type ExampleRoot = GlyphRoot & ExampleRootExtension;
export type ExampleHandle = GlyphHandle<ExampleRoot>;

export type ExampleGlyphConfig = GlyphConfig<
  ExampleRoot,
  ExampleBindings,
  ExampleDrawList,
  PortableResource,
  Readonly<Record<string, AnyRasterTechnique>>,
  ExampleRootContext
>;

export function defineExampleConfig(device?: ExampleRendererDevice): ExampleGlyphConfig {
  const techniqueId = device?.shader.variant.techniqueId ?? exampleRendererShader.variant.techniqueId;
  return defineGlyphConfig({
    schema: ExampleSchema,
    encode: ({ ids }) => ({ descriptor: exampleRenderPolicyDescriptor(ids) }),
    resolve: ({ technique, resourceName, payload }) => {
      if (technique !== techniqueId) {
        throw new TypeError(`example renderer shader "${techniqueId}" cannot render "${technique}"`);
      }
      return resourceLease(Object.freeze({ name: resourceName, resource: payload }), () => undefined);
    },
    renderer: () => {
      const selectedDevice = device ?? new RecordingExampleRendererDevice();
      return {
        decode: (view) => selectedDevice.decode(view),
        syncTransforms: () => undefined,
        dispose: () => selectedDevice.reset(),
      };
    },
    root: {
      create: (context) => {
        const extension = new ExampleRootImplementation(context.services);
        return context.create(extension, { boundary: Object.freeze({ name: context.name }) });
      },
    },
  });
}

class ExampleRootImplementation implements ExampleRootExtension {
  readonly #services: GlyphRootServices<ExampleBindings, ExampleDrawList, ExampleRootContext>;

  constructor(services: GlyphRootServices<ExampleBindings, ExampleDrawList, ExampleRootContext>) {
    this.#services = services;
  }

  createText<Technique extends AnyRasterTechnique>(options: ExampleTextOptions<Technique>): ExampleText<Technique> {
    return new ExampleText(this.#services, options);
  }

  publish(): ExampleDrawList {
    return this.#services.shape();
  }
}
