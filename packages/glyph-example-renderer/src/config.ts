import type { AnyRasterTechnique, Font, FontStack } from '@pmndrs/glyph';
import {
  defaultDecoder,
  defineGlyphConfig,
  resourceLease,
  type BackendFontBinding,
  type BackendFontStackBinding,
  type BackendMaterialBinding,
  type BackendTransformBinding,
  type GlyphBindings,
  type GlyphConfig,
  type GlyphHandle,
  type GlyphRenderer,
  type RendererContext,
} from '@pmndrs/glyph/core';

import type { ExampleRendererDevice } from './device.js';
import { ExampleTextEngine, type ExampleText, type ExampleTextOptions } from './engine.js';
import { exampleCapabilitySet, exampleRenderPolicyDescriptor } from './policy.js';

export interface ExampleResolvedResource {
  readonly name: string;
  readonly resource: unknown;
}

export interface ExampleBufferBinding {
  readonly kind: 'example-buffer';
}
export interface ExampleProgramBinding {
  readonly kind: 'example-program';
}
export interface ExamplePrimitiveBinding {
  readonly kind: 'example-primitive';
}
export interface ExampleDrawBinding {
  readonly kind: 'example-draw';
}

export type ExampleBindings = GlyphBindings<
  ExampleResolvedResource,
  ExampleBufferBinding,
  ExampleProgramBinding,
  BackendMaterialBinding,
  BackendTransformBinding,
  ExamplePrimitiveBinding,
  ExampleDrawBinding
>;

interface ExampleHandleExtension {
  bindFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): BackendFontBinding<Technique>;
  bindFontStack<Technique extends AnyRasterTechnique>(
    stack: FontStack<Technique, Font<Technique>>,
  ): BackendFontStackBinding;
  createText(options: ExampleTextOptions): ExampleText;
  publish(): ReturnType<ExampleTextEngine['publish']>;
  replaceDevice(device: ExampleRendererDevice): void;
}

export interface ExampleHandle extends GlyphHandle, ExampleHandleExtension {}

interface ExamplePortableResource {
  readonly name: string;
  readonly resource: unknown;
}

export type ExampleGlyphConfig = GlyphConfig<
  ExampleHandle,
  ExampleBindings,
  void,
  ExamplePortableResource,
  typeof exampleCapabilitySet
>;

export interface ExampleRendererContext extends RendererContext<ExampleBindings> {
  readonly defaultRenderer: GlyphRenderer<ExampleBindings, void>;
}

export function defineExampleConfig(device?: ExampleRendererDevice): ExampleGlyphConfig {
  return defineGlyphConfig<ExampleHandle, ExampleBindings, void, ExamplePortableResource, typeof exampleCapabilitySet>({
    capabilities: exampleCapabilitySet,
    encode: ({ ids }) => ({ descriptor: exampleRenderPolicyDescriptor(ids) }),
    decode: defaultDecoder,
    resolve: ({ payload }) =>
      resourceLease(Object.freeze({ name: payload.name, resource: payload.resource }), () => undefined),
    renderer: (context) => {
      const configured = context as ExampleRendererContext;
      if (configured.defaultRenderer === undefined) {
        throw new TypeError('example renderer config requires a publication boundary');
      }
      return configured.defaultRenderer;
    },
    createHandle: (context) => {
      const engine = new ExampleTextEngine(context.engine, device, context.config as ExampleGlyphConfig);
      return context.create<ExampleHandleExtension>(
        {
          bindFont: engine.bindFont.bind(engine),
          bindFontStack: engine.bindFontStack.bind(engine),
          createText: engine.createText.bind(engine),
          publish: engine.publish.bind(engine),
          replaceDevice: engine.replaceDevice.bind(engine),
        },
        () => engine.dispose(),
      );
    },
  });
}
