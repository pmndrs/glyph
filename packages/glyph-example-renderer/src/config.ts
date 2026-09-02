import type { AnyRasterFormat } from '@pmndrs/glyph';
import {
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  type GlyphBatchBindingInput,
  type GlyphBindings,
  type GlyphBufferBindingInput,
  type GlyphConfigFor,
  type GlyphHandle,
  type GlyphInstanceSpanBindingInput,
  type GlyphRoot,
  type GlyphRootInstanceBindingInput,
  type GlyphRootServices,
  type GlyphSchema,
  type CodecProgram,
} from '@pmndrs/glyph';

import type { ExampleRendererDevice } from './device.js';
import { exampleRendererShader, RecordingExampleRendererDevice } from './device.js';
import type { ExampleDrawList } from './draw-list.js';
import { ExampleText, type ExampleTextOptions } from './engine.js';
import { exampleCodecDescriptor } from './codec.js';

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
  readonly program: CodecProgram;
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
  createText<Format extends AnyRasterFormat>(options: ExampleTextOptions<Format>): ExampleText<Format>;
  readonly drawList: ExampleDrawList;
}

export type ExampleRoot = GlyphRoot & ExampleRootExtension;
export type ExampleHandle = GlyphHandle<ExampleRoot>;

export type ExampleGlyphConfig = GlyphConfigFor<typeof ExampleSchema, ExampleRoot, ExampleDrawList>;

export function defineExampleConfig(device?: ExampleRendererDevice): ExampleGlyphConfig {
  const techniqueId = device?.shader.variant.techniqueId ?? exampleRendererShader.variant.techniqueId;
  const config = defineGlyphConfig({
    schema: ExampleSchema,
    encode: ({ ids }) => ({ descriptor: exampleCodecDescriptor(ids) }),
    resolve: ({ format, resourceName, payload }) => {
      if (format !== techniqueId) {
        throw new TypeError(`example renderer shader "${techniqueId}" cannot render "${format}"`);
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
        return context.create(extension, {
          boundary: Object.freeze({ name: context.name }),
          shape: { accepted: (drawList) => extension.accept(drawList) },
        });
      },
    },
  });
  config satisfies ExampleGlyphConfig;
  return config;
}

class ExampleRootImplementation implements ExampleRootExtension {
  readonly #services: GlyphRootServices<ExampleBindings, ExampleDrawList, ExampleRootContext>;

  constructor(services: GlyphRootServices<ExampleBindings, ExampleDrawList, ExampleRootContext>) {
    this.#services = services;
  }

  createText<Format extends AnyRasterFormat>(options: ExampleTextOptions<Format>): ExampleText<Format> {
    return new ExampleText(this.#services, options);
  }

  #drawList: ExampleDrawList | undefined;

  get drawList(): ExampleDrawList {
    if (this.#drawList === undefined) throw new Error('example root has not accepted a shaped draw list');
    return this.#drawList;
  }

  accept(drawList: ExampleDrawList): void {
    this.#drawList = drawList;
  }
}
