import type {
  Font,
  FontFaceRasterOf,
  FontFaceSelection,
  GlyphHandleFonts,
  GlyphRootServices,
  GlyphTextController,
  ParagraphLayoutSummary,
  GlyphLayoutInspection,
  RasterFormatRequest,
  TextStyle,
  ParagraphLayout,
  Constraints,
} from '../index.js';
import type { bitmap } from '../raster/bitmap.js';
import type { msdf } from '../raster/msdf.js';
import type { slug } from '../raster/slug.js';
import type { Bindings } from './internal/bindings.js';
import type { TypeGpuTransform } from './internal/renderer.js';

export type TypeGpuFontSelection = FontFaceSelection<
  | typeof bitmap
  | typeof msdf
  | typeof slug
  | RasterFormatRequest<typeof bitmap>
  | RasterFormatRequest<typeof msdf>
  | RasterFormatRequest<typeof slug>
  | undefined
>;
export interface TypeGpuTextOptions<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly font: Selection;
  readonly text: string;
  readonly style?: Omit<TextStyle, 'decoration'> & { readonly decoration?: never };
  readonly layout?: ParagraphLayout;
  readonly constraints?: Constraints;
  readonly rasterPixelRatio?: number;
  /** Pixel coordinates relative to the upper-left corner of the viewport. */
  readonly position?: readonly [number, number];
}
export type TypeGpuTextUpdate<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> = Partial<
  TypeGpuTextOptions<Selection>
>;

/** Retained text. Create with a configured TypeGPU handle's createText(). */
export interface TypeGpuText<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly disposed: boolean;
  update(update: TypeGpuTextUpdate<Selection>): void;
  measure(): ParagraphLayoutSummary;
  glyphs(): GlyphLayoutInspection;
  dispose(): void;
}

export function createText<Selection extends TypeGpuFontSelection>(
  fonts: GlyphHandleFonts,
  services: GlyphRootServices<Bindings, void, void>,
  transform: TypeGpuTransform,
  options: TypeGpuTextOptions<Selection>,
  onDispose: () => void,
): TypeGpuText<Selection> {
  if (options.style?.decoration !== undefined) throw new TypeError('TypeGPU text decoration lines are not supported');
  let state = options;
  let font = fonts.acquire(options.font);
  let controller: GlyphTextController<FontFaceRasterOf<Selection>, object, TypeGpuTransform>;
  let disposed = false;
  const coreState = (next: TypeGpuTextOptions<Selection>, selected: Font<FontFaceRasterOf<Selection>>) => ({
    font: selected,
    text: next.text,
    transform,
    ...(next.style === undefined ? {} : { style: next.style }),
    ...(next.layout === undefined ? {} : { layout: next.layout }),
    ...(next.constraints === undefined ? {} : { constraints: next.constraints }),
    ...(next.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: next.rasterPixelRatio }),
  });
  try {
    setPosition(transform, options.position);
    controller = services.createText(coreState(options, font));
  } catch (error) {
    font.dispose();
    throw error;
  }
  function assertActive(): void {
    if (disposed) throw new Error('TypeGPU text is disposed');
  }
  return {
    get disposed() {
      return disposed;
    },
    update(update) {
      assertActive();
      const next = { ...state, ...update };
      if (next.style?.decoration !== undefined) throw new TypeError('TypeGPU text decoration lines are not supported');
      validatePosition(next.position);
      const nextFont = next.font === state.font ? font : fonts.acquire(next.font);
      try {
        controller.update(coreState(next, nextFont));
      } catch (error) {
        if (nextFont !== font) nextFont.dispose();
        throw error;
      }
      setPosition(transform, next.position);
      if (nextFont !== font) font.dispose();
      font = nextFont;
      state = next;
    },
    measure() {
      assertActive();
      return controller.measure();
    },
    glyphs() {
      assertActive();
      return controller.inspect();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        controller.dispose();
      } finally {
        font.dispose();
        // Accepted draws may still reference this transform until the next shape().
        onDispose();
      }
    },
  };
}
function validatePosition(position: readonly [number, number] = [0, 0]): void {
  if (position.length !== 2 || !position.every(Number.isFinite))
    throw new RangeError('TypeGPU text position must contain two finite coordinates');
}
function setPosition(transform: TypeGpuTransform, position: readonly [number, number] = [0, 0]): void {
  validatePosition(position);
  transform.position.write(position);
}
