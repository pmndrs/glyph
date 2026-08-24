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
export type { FontFeature, ResolvedFontFeature } from './font-feature.js';
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
export { TextFrameError } from './three/frame-error.js';
export type { TextFrameRejection, TextFrameSubject } from './three/frame-error.js';
export { Text, TextGroup } from './three/text.js';
export type {
  StandaloneTextProperties,
  TextAnchorX,
  TextAnchorY,
  TextCommitState,
  TextGroupOptions,
  TextProperties,
  TextSpan,
  TextUpdate,
} from './three/text.js';
// `measureLayout()`, `inspectLayout()`, and `snapshotGlyphs()` return these, so a `/three` importer
// has to be able to name them without reaching for a second subpath.
export { glyphFlags } from './layout.js';
export type {
  BaselineMetrics,
  LayoutBox,
  ParagraphLayout,
  ParagraphLayoutInspection,
  ParagraphLayoutSummary,
  ParagraphLineMetrics,
  ParagraphMeasurement,
} from './layout.js';
export type {
  GlyphAdoption,
  GlyphApplication,
  GlyphCaret,
  GlyphKey,
  GlyphLine,
  GlyphPlacement,
  GlyphPlacements,
  GlyphRun,
  GlyphSpace,
} from './glyph-placement.js';
