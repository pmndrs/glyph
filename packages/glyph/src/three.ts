export { span } from './formatted-text.js';
export type { FormattedText, GlyphPaintInput, TextInput } from './formatted-text.js';
export type { FontSelection, LoadedFont } from './loaded-font.js';
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
export type { ThreeFontLoaderOptions, ThreeLoadedFontRequest as LoadedFontRequest } from './three/font-loader.js';
export { TextFrameError } from './three/frame-error.js';
export type { TextFrameRejection, TextFrameSubject } from './three/frame-error.js';
export { Text, TextGroup } from './three/text.js';
export type {
  StandaloneTextProperties,
  TextCommitState,
  TextGroupOptions,
  TextProperties,
  TextSpan,
  TextUpdate,
} from './three/text.js';
// `measure()`, `glyphs()`, and `snapshotGlyphs()` return these, so a `/three` importer
// has to be able to name them without reaching for a second subpath.
export type { LayoutBox, ParagraphLayoutInspection, ParagraphLayoutSummary } from './layout.js';
export type { GlyphApplication, GlyphCaret, GlyphPlacements } from './glyph-placement.js';
