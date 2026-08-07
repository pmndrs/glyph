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
export { FontLoader } from './three/font-loader.js';
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
export { Text, TextGroup } from './three/text.js';
export type {
  StandaloneTextProperties,
  TextGroupOptions,
  TextProperties,
  TextSpan,
  TextUpdate,
  ThreeRenderVariant,
} from './three/text.js';
