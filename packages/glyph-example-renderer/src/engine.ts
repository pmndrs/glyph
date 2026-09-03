import type {
  ColorInput,
  Font,
  FontFaceSelection,
  FontFaceRasterOf,
  GlyphHandleFonts,
  GlyphRootServices,
  GlyphTextController,
  RasterFormatRequest,
} from '@pmndrs/glyph';
import { glyphExample } from '@pmndrs/glyph-example-raster';

import type { ExampleDrawList } from './draw-list.js';
import type { ExampleBindings, ExampleRootContext, ExampleTransform } from './config.js';

const MAX_LINES = 4_096;

/** Package-private construction capability held by configured example roots. */
export const exampleTextConstructionToken: unique symbol = Symbol('pmndrs.glyph.example-renderer.construct');

/** Initial state for one retained example-renderer text instance. */
export type ExampleFontFaceSelection = FontFaceSelection<
  typeof glyphExample | RasterFormatRequest<typeof glyphExample> | undefined
>;

export interface ExampleTextOptions<Selection extends ExampleFontFaceSelection = ExampleFontFaceSelection> {
  readonly font: Selection;
  readonly text: string;
  readonly fontSize?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rasterPixelRatio?: number;
  readonly color?: ColorInput;
  readonly opacity?: number;
}

/** Desired-state changes accepted by an example-renderer text instance. */
export type ExampleTextUpdate<Selection extends ExampleFontFaceSelection = ExampleFontFaceSelection> = Partial<
  ExampleTextOptions<Selection>
>;

/** One retained Text owned by the root services supplied through GlyphConfig.root. */
export class ExampleText<Selection extends ExampleFontFaceSelection = ExampleFontFaceSelection> {
  readonly #fonts: GlyphHandleFonts;
  readonly #controller: GlyphTextController<
    FontFaceRasterOf<Selection>,
    ExampleBindings['materialInput'],
    ExampleTransform
  >;
  readonly #transform: ExampleTransform = Object.freeze({ kind: 'example-transform' });
  #font: Font<FontFaceRasterOf<Selection>>;
  #state: NormalizedExampleTextOptions<Selection>;
  #disposed = false;

  constructor(
    token: typeof exampleTextConstructionToken,
    fonts: GlyphHandleFonts,
    services: GlyphRootServices<ExampleBindings, ExampleDrawList, ExampleRootContext>,
    options: ExampleTextOptions<Selection>,
  ) {
    if (token !== exampleTextConstructionToken) {
      throw new TypeError('ExampleText instances must be created by a configured Glyph handle');
    }
    this.#fonts = fonts;
    this.#state = normalizeTextOptions(options);
    this.#font = fonts.acquire(this.#state.font);
    try {
      this.#controller = services.createText(this.#coreState(this.#state, this.#font));
    } catch (error) {
      this.#font.dispose();
      throw error;
    }
  }

  get text(): string {
    return this.#state.text;
  }

  update(update: ExampleTextUpdate<Selection>): void {
    this.#assertActive();
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      throw new TypeError('example text updates must be objects');
    }
    const next = normalizeTextOptions({ ...this.#state, ...update });
    const nextFont = next.font === this.#state.font ? this.#font : this.#fonts.acquire(next.font);
    try {
      this.#controller.update(this.#coreState(next, nextFont));
      if (nextFont !== this.#font) this.#font.dispose();
      this.#font = nextFont;
      this.#state = next;
    } catch (error) {
      if (nextFont !== this.#font) nextFont.dispose();
      throw error;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#controller.dispose();
    } finally {
      this.#font.dispose();
    }
  }

  #coreState(state: NormalizedExampleTextOptions<Selection>, font: Font<FontFaceRasterOf<Selection>>) {
    return {
      font,
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

type NormalizedExampleTextOptions<Selection extends ExampleFontFaceSelection> = Required<
  Omit<ExampleTextOptions<Selection>, 'font' | 'color' | 'opacity'>
> &
  Pick<ExampleTextOptions<Selection>, 'font' | 'color' | 'opacity'>;

function normalizeTextOptions<Selection extends ExampleFontFaceSelection>(
  options: ExampleTextOptions<Selection>,
): NormalizedExampleTextOptions<Selection> {
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
