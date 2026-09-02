import { createEngine, type Codec, type GlyphCommandBufferBinder } from '@pmndrs/glyph/core';

import type { ExampleBindings, ExampleGlyphConfig, ExampleRootContext } from './config.js';

/** Thin example integration over the renderer-neutral publication and resource engine. */
export class ExampleCommandBufferBinder implements GlyphCommandBufferBinder<ExampleBindings> {
  readonly #engine: GlyphCommandBufferBinder<ExampleBindings>;

  constructor(config: ExampleGlyphConfig, codec: Codec, root: ExampleRootContext) {
    this.#engine = createEngine({ config, codec, root });
  }

  source: GlyphCommandBufferBinder<ExampleBindings>['source'] = (...args) => this.#engine.source(...args);
  decodeDefault: GlyphCommandBufferBinder<ExampleBindings>['decodeDefault'] = (...args) =>
    this.#engine.decodeDefault(...args);
  settle: GlyphCommandBufferBinder<ExampleBindings>['settle'] = (...args) => this.#engine.settle(...args);
  dispose: GlyphCommandBufferBinder<ExampleBindings>['dispose'] = () => this.#engine.dispose();
}
