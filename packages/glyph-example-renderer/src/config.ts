import {
  type GlyphBatchBindingInput,
  type GlyphBindingSet,
  type GlyphBufferBindingInput,
  type GlyphConfigFor,
  type GlyphHandle,
  type GlyphHandleFonts,
  type GlyphInstanceSpanBindingInput,
  type GlyphRoot,
  type GlyphRootInstanceBindingInput,
  type GlyphRootServices,
  type GlyphSchema,
  type Codec,
  type CodecProgram,
} from '@pmndrs/glyph';
import { defineGlyphConfig, defineGlyphSchema, resourceLease } from '@pmndrs/glyph/config/glyph';
import { glyphExample } from '@pmndrs/glyph-example-raster';

import type { ExampleRendererDevice } from './device.js';
import { exampleRendererShader, RecordingExampleRendererDevice } from './device.js';
import type { ExampleDrawList } from './draw-list.js';
import {
  exampleTextConstructionToken,
  ExampleText,
  type ExampleFontFaceSelection,
  type ExampleTextOptions,
} from './engine.js';
import { exampleCodecDescriptor } from './codec.js';

export interface ExampleResolvedResource {
  readonly name: string;
  readonly resource: unknown;
}

export interface ExampleBufferBinding {
  readonly kind: 'example-buffer';
  readonly input: GlyphBufferBindingInput<ExampleProgramBinding>;
}
export interface ExampleProgramBinding {
  readonly kind: 'example-program';
  readonly program: CodecProgram;
}
export interface ExampleInstanceSpanBinding {
  readonly kind: 'example-instance-span';
  readonly input: GlyphInstanceSpanBindingInput<ExampleResolvedResource, ExampleBufferBinding, ExampleProgramBinding>;
}
export interface ExampleBatchBinding {
  readonly kind: 'example-batch';
  readonly input: GlyphBatchBindingInput<
    ExampleResolvedResource,
    ExampleBufferBinding,
    ExampleProgramBinding,
    ExampleMaterial,
    ExampleInstanceSpanBinding
  >;
}
export interface ExampleInstanceBinding {
  readonly kind: 'example-instance';
  readonly input: GlyphRootInstanceBindingInput<
    ExampleResolvedResource,
    ExampleBufferBinding,
    ExampleProgramBinding,
    ExampleMaterial,
    ExampleTransform,
    ExampleInstanceSpanBinding
  >;
}
export interface ExampleMaterial {
  readonly kind: 'example-material';
}
export interface ExampleTransform {
  readonly kind: 'example-transform';
}

export interface ExampleBindings extends GlyphBindingSet {
  readonly resource: ExampleResolvedResource;
  readonly buffer: ExampleBufferBinding;
  readonly program: ExampleProgramBinding;
  readonly material: ExampleMaterial;
  readonly transform: ExampleTransform;
  readonly batch: ExampleBatchBinding;
  readonly instance: ExampleInstanceBinding;
  readonly instanceSpan: ExampleInstanceSpanBinding;
  readonly materialInput: ExampleMaterial;
  readonly transformInput: ExampleTransform;
}

export interface ExampleRootContext {
  readonly name: string | undefined;
}

export interface ExampleFontFormats {
  readonly glyphExample: typeof glyphExample;
}

export const ExampleFontFormats: ExampleFontFormats = Object.freeze({ glyphExample });

export const ExampleSchema: GlyphSchema<ExampleBindings, ExampleRootContext> = defineGlyphSchema({
  program: (_root: ExampleRootContext, program) => Object.freeze({ kind: 'example-program', program }),
  buffer: (_root, input) => Object.freeze({ kind: 'example-buffer', input }),
  material: (_root, material) => material,
  transform: (_root, transform) => transform,
  batch: (_root, input) => Object.freeze({ kind: 'example-batch', input }),
  instance: (_root, input) => Object.freeze({ kind: 'example-instance', input }),
  instanceSpan: (_root, input) => Object.freeze({ kind: 'example-instance-span', input }),
});

interface ExampleRootExtension {
  createText<const Selection extends ExampleFontFaceSelection>(
    options: ExampleTextOptions<Selection>,
  ): ExampleText<Selection>;
  readonly drawList: ExampleDrawList;
}

export type ExampleRoot = GlyphRoot & ExampleRootExtension;
export type ExampleHandle = GlyphHandle<ExampleRoot>;

export type ExampleGlyphConfig = GlyphConfigFor<
  typeof ExampleSchema,
  ExampleRoot,
  ExampleDrawList,
  Codec,
  ExampleFontFormats
>;

export function defineExampleConfig(device?: ExampleRendererDevice): ExampleGlyphConfig {
  const formatId = device?.shader.variant.formatId ?? exampleRendererShader.variant.formatId;
  return defineGlyphConfig({
    schema: ExampleSchema,
    fonts: { default: glyphExample.kind, formats: ExampleFontFormats },
    encode: ({ ids }) => ({ descriptor: exampleCodecDescriptor(ids) }),
    resolve: ({ format, resourceName, payload }) => {
      if (format !== formatId) {
        throw new TypeError(`example renderer shader "${formatId}" cannot render "${format}"`);
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
        if (context.fonts === undefined) throw new TypeError('example GlyphConfig must declare font formats');
        const extension = new ExampleRootImplementation(context.fonts, context.services);
        return context.create(extension, {
          boundary: Object.freeze({ name: context.name }),
          shape: { accepted: (drawList) => extension.accept(drawList) },
        });
      },
    },
  });
}

class ExampleRootImplementation implements ExampleRootExtension {
  readonly #fonts: GlyphHandleFonts;
  readonly #services: GlyphRootServices<ExampleBindings, ExampleDrawList, ExampleRootContext>;

  constructor(
    fonts: GlyphHandleFonts,
    services: GlyphRootServices<ExampleBindings, ExampleDrawList, ExampleRootContext>,
  ) {
    this.#fonts = fonts;
    this.#services = services;
  }

  createText<const Selection extends ExampleFontFaceSelection>(
    options: ExampleTextOptions<Selection>,
  ): ExampleText<Selection> {
    return new ExampleText(exampleTextConstructionToken, this.#fonts, this.#services, options);
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
