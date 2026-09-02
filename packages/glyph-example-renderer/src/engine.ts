import type { AnyRasterFormat, ColorInput, FontSelection, GlyphRootServices, GlyphTextController } from '@pmndrs/glyph';

import type { ExampleDrawList } from './draw-list.js';
import type { ExampleBindings, ExampleRootContext, ExampleTransform } from './config.js';

const MAX_LINES = 4_096;

/** Initial state for one retained example-renderer text instance. */
export interface ExampleTextOptions<Format extends AnyRasterFormat = AnyRasterFormat> {
  readonly font: FontSelection<Format>;
  readonly text: string;
  readonly fontSize?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rasterPixelRatio?: number;
  readonly color?: ColorInput;
  readonly opacity?: number;
}

/** Desired-state changes accepted by an example-renderer text instance. */
export type ExampleTextUpdate<Format extends AnyRasterFormat = AnyRasterFormat> = Partial<ExampleTextOptions<Format>>;

/** One retained Text owned by the root services supplied through GlyphConfig.root. */
export class ExampleText<Format extends AnyRasterFormat = AnyRasterFormat> {
  readonly #services: GlyphRootServices<ExampleBindings, ExampleDrawList, ExampleRootContext>;
  readonly #controller: GlyphTextController<Format, ExampleBindings['materialInput'], ExampleTransform>;
  readonly #transform: ExampleTransform = Object.freeze({ kind: 'example-transform' });
  #state: NormalizedExampleTextOptions<Format>;
  #disposed = false;

  constructor(
    services: GlyphRootServices<ExampleBindings, ExampleDrawList, ExampleRootContext>,
    options: ExampleTextOptions<Format>,
  ) {
    this.#services = services;
    this.#state = normalizeTextOptions(options);
    this.#controller = services.createText(this.#coreState(this.#state));
  }

  get text(): string {
    return this.#state.text;
  }

  update(update: ExampleTextUpdate<Format>): void {
    this.#assertActive();
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      throw new TypeError('example text updates must be objects');
    }
    const next = normalizeTextOptions({ ...this.#state, ...update });
    this.#controller.update(this.#coreState(next));
    this.#state = next;
  }

  publish(): ExampleDrawList {
    this.#assertActive();
    return this.#services.shape();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#controller.dispose();
  }

  #coreState(state: NormalizedExampleTextOptions<Format>) {
    return {
      font: state.font,
      text: state.text,
      transform: this.#transform,
      style: {
        fontSize: state.fontSize,
        ...(state.color === undefined ? {} : { color: state.color }),
        ...(state.opacity === undefined ? {} : { opacity: state.opacity }),
      },
      rasterPixelRatio: state.rasterPixelRatio,
      constraints: {
        width: { mode: 'at-most' as const, size: state.width },
        height: { mode: 'at-most' as const, size: state.height },
      },
      layout: { maxLines: MAX_LINES },
    };
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('example text is disposed');
  }
}

type NormalizedExampleTextOptions<Format extends AnyRasterFormat> = Required<
  Omit<ExampleTextOptions<Format>, 'font' | 'color' | 'opacity'>
> &
  Pick<ExampleTextOptions<Format>, 'font' | 'color' | 'opacity'>;

function normalizeTextOptions<Format extends AnyRasterFormat>(
  options: ExampleTextOptions<Format>,
): NormalizedExampleTextOptions<Format> {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('example text options must be an object');
  }
  if (typeof options.text !== 'string') throw new TypeError('example text content must be a string');
  return {
    font: options.font,
    text: options.text,
    fontSize: positiveFinite(options.fontSize ?? 48, 'fontSize'),
    width: positiveFinite(options.width ?? 1024, 'width'),
    height: positiveFinite(options.height ?? 256, 'height'),
    rasterPixelRatio: positiveFinite(options.rasterPixelRatio ?? 1, 'rasterPixelRatio'),
    ...(options.color === undefined ? {} : { color: options.color }),
    ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
  };
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`example text ${name} must be positive and finite`);
  return value;
}
