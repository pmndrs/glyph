export { span, txt } from './formatted-text.js';
export type {
  FormattedText,
  GlyphPaintInput,
  SpanFormat,
  SpanStyle,
  SpanTag,
  TextInput,
  UnboundSpanTag,
} from './formatted-text.js';
export type { FontSelection, FontStack, LoadedFont } from './loaded-font.js';
export type { GlyphBufferCapacity, GlyphOriginUpdate, GlyphSnapshot, ParagraphContentBox } from './paragraph-batch.js';
export type { ParagraphLayout } from './layout.js';
export type { ParagraphStyle } from './paragraph.js';
export { bitmapShader } from './three/bitmap-shader.js';
export type {
  ThreeBitmapInstanceNodes,
  ThreeBitmapShaderOutput,
  ThreeBitmapShaderResources,
} from './three/bitmap-shader.js';
export { FontLoader } from './three/font-loader.js';
export { msdfShader } from './three/msdf-shader.js';
export type { ThreeMsdfInstanceNodes, ThreeMsdfShaderOutput, ThreeMsdfShaderResources } from './three/msdf-shader.js';
export { registerThreeRasterProgram } from './three/program-registry.js';
export type {
  ThreeRasterProgram,
  ThreeRasterTargetAccounting,
  ThreeRasterTargetOwner,
} from './three/program-registry.js';
export type {
  ThreeFontLoaderOptions as FontLoaderOptions,
  ThreeLoadedFontRequest as LoadedFontRequest,
} from './three/font-loader.js';
export { slugShader } from './three/slug-shader.js';
export type {
  ThreeSlugFillRule,
  ThreeSlugInstanceNodes,
  ThreeSlugPageResources,
  ThreeSlugShaderOutput,
  ThreeSlugShaderResources,
} from './three/slug-shader.js';
export { Text, TextGroup } from './three/text.js';
export type {
  StandaloneTextProperties,
  TextGroupOptions,
  TextProperties,
  TextSpan,
  TextUpdate,
  ThreeRenderVariant,
} from './three/text.js';
