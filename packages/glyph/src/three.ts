export { alignSpansToClusters, span, txt } from './formatted-text.js';
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
export type { GlyphBufferCapacity, ParagraphContentBox, ParagraphStyle } from './text-properties.js';
export { FontLoader } from './three/font-loader.js';
export { defineTextMaterial } from './three/material.js';
export type { ThreeTextMaterial, ThreeTextMaterialContext } from './three/material.js';
export { registerThreeRasterPlanProgram, threePolicyAbi } from './three/plan-program-registry.js';
export type {
  ThreePlanProgramBuffer,
  ThreePlanProgramFontCompiler,
  ThreePlanProgramMaterialContext,
  ThreeRasterPlanProgram,
} from './three/plan-program-registry.js';
export type {
  ThreeFontLoaderOptions as FontLoaderOptions,
  ThreeLoadedFontRequest as LoadedFontRequest,
} from './three/font-loader.js';
export { Text, TextGroup } from './three/text.js';
export type {
  StandaloneTextProperties,
  TextGlyphOriginSnapshot,
  TextGlyphOriginUpdate,
  TextGroupOptions,
  TextProperties,
  TextSpan,
  TextUpdate,
} from './three/text.js';
