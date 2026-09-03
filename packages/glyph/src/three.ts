export type { FontSelection } from './loaded-font.js';
export type { GlyphBufferCapacity, PropertyList } from './text-properties.js';
export { Constraints, ParagraphLayout, TextStyle } from './text-properties.js';
export { defineTextMaterial } from './three/material.js';
export { span } from './three/span.js';
export type {
  ThreeRootContext,
  ThreeTextMaterial,
  ThreeTextMaterialContext,
  ThreeTextMaterialContextMap,
} from './three/material.js';
export { registerThreeRasterPlanProgram, threeCodecAbi } from './three/plan-program-registry.js';
export type {
  ThreePlanProgramBuffer,
  ThreePlanProgramMaterialContext,
  ThreeRasterPlanBufferCapability,
  ThreeRasterPlanProgram,
  ThreeRasterPlanVariant,
} from './three/plan-program-registry.js';
export { TextFrameError } from './three/frame-error.js';
export type { TextFrameRejection, TextFrameSubject } from './three/frame-error.js';
export { Text, TextGroup, ThreeRoot } from './three/text.js';
export {
  ThreeConfig,
  ThreeFontFormats,
  defineThreeConfig,
  type ThreeBatchBinding,
  type ThreeBindings,
  type ThreeBufferBinding,
  type ThreeConfigOptions,
  type ThreeGlyphConfig,
  type ThreeHandle,
  type ThreeInstanceBinding,
  type ThreeInstanceSpanBinding,
  type ThreeMaterialBinding,
  type ThreePortableResource,
  type ThreeProgramBinding,
  type ThreeResolvedMaterialBinding,
  type ThreeResolvedResourceBinding,
  type ThreeRootBinding,
} from './three/handle.js';
export type { ThreeCodec } from './three/renderer-resources.js';
export type {
  StandaloneTextProperties,
  TextCommitState,
  TextGroupOptions,
  TextProperties,
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
