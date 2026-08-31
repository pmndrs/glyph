export type { FormattedText, TextInput } from './formatted-text.js';
export type { FontSelection } from './loaded-font.js';
export type { GlyphBufferCapacity, PropertyList } from './text-properties.js';
export { Constraints, ParagraphLayout, TextStyle } from './text-properties.js';
export { FontLoader } from './three/font-loader.js';
export { defineTextMaterial } from './three/material.js';
export type { ThreeTextGenericMaterialContext, ThreeTextMaterial, ThreeTextMaterialContext } from './three/material.js';
export { registerThreeRasterPlanProgram, threePolicyAbi } from './three/plan-program-registry.js';
export type {
  ThreePlanProgramBuffer,
  ThreePlanProgramMaterialContext,
  ThreeRasterPlanBufferCapability,
  ThreeRasterPlanProgram,
  ThreeRasterPlanVariant,
} from './three/plan-program-registry.js';
export type { ThreeFontLoaderOptions, ThreeFontLoadRequest } from './three/font-loader.js';
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
export { Glyphs, localToWorldMatrix, worldToLocalMatrix } from './three/glyphs.js';
export type { DetachedGlyph } from './three/glyphs.js';
export { Decorations } from './three/decorations.js';
export type {
  GlyphAnchor,
  GlyphAnchorAxis,
  ThreeGlyphGeometryCoordinates,
  ThreeGlyphGeometrySource,
  ThreeGlyphMeasurement,
} from './three/glyph-measurement.js';
// `measure()`, `glyphs()`, caret helpers, and detached measurements return these.
export type { LayoutBox, GlyphLayoutInspection, ParagraphLayoutSummary } from './layout.js';
export type { GlyphCaret, GlyphKey } from './glyph-placement.js';
