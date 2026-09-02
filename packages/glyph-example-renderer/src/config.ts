import type { AnyRasterTechnique, Font, FontStack } from '@pmndrs/glyph';
import {
  defaultDecoder,
  createGlyphRootRegistry,
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  type BackendFontBinding,
  type BackendFontStackBinding,
  type BackendMaterialBinding,
  type BackendTransformBinding,
  type GlyphBindings,
  type GlyphBatchBindingInput,
  type GlyphBufferBindingInput,
  type GlyphConfig,
  type GlyphHandle,
  type GlyphRoot,
  type GlyphEngine,
  type GlyphInstanceSpanBindingInput,
  type GlyphRootInstanceBindingInput,
  type GlyphSchema,
  type PolicyProgram,
  type PortableResource,
} from '@pmndrs/glyph/core';

import type { ExampleRendererDevice } from './device.js';
import { exampleRendererShader, RecordingExampleRendererDevice } from './device.js';
import type { ExampleDrawList } from './draw-list.js';
import { ExampleTextEngine, type ExampleText, type ExampleTextOptions } from './engine.js';
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

export type ExampleBindings = GlyphBindings<
  ExampleResolvedResource,
  ExampleBufferBinding,
  ExampleProgramBinding,
  BackendMaterialBinding,
  BackendTransformBinding,
  ExampleBatchBinding,
  ExampleInstanceBinding,
  ExampleInstanceSpanBinding,
  undefined
>;

export interface ExampleRootContext {
  readonly name: string | undefined;
}

export const ExampleSchema: GlyphSchema<ExampleBindings, ExampleRootContext> = defineGlyphSchema<ExampleBindings>()({
  drawRoot: () => undefined,
  program: (_root, program) => Object.freeze({ kind: 'example-program', program }),
  buffer: (_root, input) => Object.freeze({ kind: 'example-buffer', input }),
  material: (_root, binding) => binding,
  transform: (_root, binding) => binding,
  batch: (_root, input) => Object.freeze({ kind: 'example-batch', input }),
  instance: (_root, input) => Object.freeze({ kind: 'example-instance', input }),
  instanceSpan: (_root, input) => Object.freeze({ kind: 'example-instance-span', input }),
});

interface ExampleRootExtension {
  bindFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): BackendFontBinding<Technique>;
  bindFontStack<Technique extends AnyRasterTechnique>(
    stack: FontStack<Technique, Font<Technique>>,
  ): BackendFontStackBinding;
  createText(options: ExampleTextOptions): ExampleText;
  publish(): ExampleDrawList;
}

export interface ExampleRoot extends GlyphRoot, ExampleRootExtension {}

export interface ExampleHandle extends GlyphHandle<ExampleRoot>, ExampleRootExtension {}

export type ExampleGlyphConfig = GlyphConfig<
  ExampleHandle,
  ExampleBindings,
  ExampleDrawList,
  PortableResource,
  Readonly<Record<string, AnyRasterTechnique>>,
  ExampleRootContext
>;

export function defineExampleConfig(device?: ExampleRendererDevice): ExampleGlyphConfig {
  const techniqueId = device?.shader.variant.techniqueId ?? exampleRendererShader.variant.techniqueId;
  return defineGlyphConfig<
    ExampleHandle,
    ExampleBindings,
    ExampleDrawList,
    PortableResource,
    Readonly<Record<string, AnyRasterTechnique>>,
    ExampleRootContext
  >({
    schema: ExampleSchema,
    encode: ({ ids }) => ({ descriptor: exampleRenderPolicyDescriptor(ids) }),
    decode: defaultDecoder,
    resolve: ({ technique, resourceName, payload }) => {
      if (technique !== techniqueId) {
        throw new TypeError(`example renderer shader "${techniqueId}" cannot render "${technique}"`);
      }
      return resourceLease(Object.freeze({ name: resourceName, resource: payload }), () => undefined);
    },
    renderer: (_context) => {
      const selectedDevice = device ?? new RecordingExampleRendererDevice();
      return {
        prepare: (frame) => selectedDevice.prepare(frame),
        syncTransforms: () => undefined,
        dispose: () => selectedDevice.reset(),
      };
    },
    createHandle: (context) => {
      const roots = createGlyphRootRegistry(
        (name, release) =>
          new ExampleRootImplementation(name, context.engine, context.config as ExampleGlyphConfig, release),
      );
      const anonymous = roots.anonymous;
      const selectRoot = Object.assign((name: string) => roots.get(name), {
        bindFont: anonymous.bindFont.bind(anonymous),
        bindFontStack: anonymous.bindFontStack.bind(anonymous),
        createText: anonymous.createText.bind(anonymous),
        publish: anonymous.publish.bind(anonymous),
      });
      return context.create(selectRoot, () => roots.dispose());
    },
  });
}

class ExampleRootImplementation implements ExampleRoot {
  readonly name: string | undefined;
  readonly #engine: ExampleTextEngine;
  readonly #release: () => void;
  #disposed = false;

  constructor(name: string | undefined, engine: GlyphEngine, config: ExampleGlyphConfig, release: () => void) {
    this.name = name;
    this.#engine = new ExampleTextEngine(engine, config, Object.freeze({ name }));
    this.#release = release;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  bindFont: ExampleRootExtension['bindFont'] = (font) => {
    this.#assertActive();
    return this.#engine.bindFont(font);
  };

  bindFontStack: ExampleRootExtension['bindFontStack'] = (stack) => {
    this.#assertActive();
    return this.#engine.bindFontStack(stack);
  };

  createText(options: ExampleTextOptions): ExampleText {
    this.#assertActive();
    return this.#engine.createText(options);
  }

  publish(): ExampleDrawList {
    this.#assertActive();
    return this.#engine.publish();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#engine.dispose();
    } finally {
      this.#release();
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error(`example root ${JSON.stringify(this.name)} has been disposed`);
  }
}
