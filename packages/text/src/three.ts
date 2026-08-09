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
export type { GlyphBufferCapacity, ParagraphContentBox } from './paragraph-batch.js';
export type { ParagraphStyle } from './paragraph.js';
export { bitmapShader } from './three/bitmap-shader.js';
export type {
  ThreeBitmapInstanceNodes,
  ThreeBitmapShaderOutput,
  ThreeBitmapShaderResources,
} from './three/bitmap-shader.js';
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
export { setThreeTextProfiler, threeTextUserTimingProfiler } from './three/profiler.js';
export type { ThreeTextProfiler, ThreeTextProfilePhase } from './three/profiler.js';
export { msdfShader } from './three/msdf-shader.js';
export type { ThreeMsdfInstanceNodes, ThreeMsdfShaderOutput, ThreeMsdfShaderResources } from './three/msdf-shader.js';
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
  TextGlyphOriginSnapshot,
  TextGlyphOriginUpdate,
  TextGroupOptions,
  TextProperties,
  TextSpan,
  TextUpdate,
} from './three/text.js';
