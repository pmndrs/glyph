import { bitmapShader, decorationShader, msdfShader, slugShader } from './shaders/tsl/index.js';
import type { ThreeConfigOptions, ThreeGlyphConfig } from './three/schema.js';
import { createThreeConfig } from './three/internal/define-config.js';

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
export { registerThreeRasterProgram, threeCodecAbi } from './three/raster-program.js';
export type {
  ThreeRasterProgramBuffer,
  ThreeRasterMaterialContext,
  ThreeRasterBufferCapability,
  ThreeRasterProgram,
  ThreeRasterVariant,
} from './three/raster-program.js';
export { TextFrameError } from './three/frame-error.js';
export type { TextFrameRejection, TextFrameSubject } from './three/frame-error.js';
export { Text, TextGroup } from './three/text.js';
export type { ThreeRoot } from './three/text.js';
export {
  ThreeFontFormats,
  type ThreeBatchBinding,
  type ThreeBindings,
  type ThreeBufferBinding,
  type ThreeCodec,
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
} from './three/schema.js';
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

/** Creates a Three config using the stable TSL shader implementation. */
export function defineThreeConfig(options: ThreeConfigOptions = {}): ThreeGlyphConfig {
  return createThreeConfig(options, { bitmapShader, decorationShader, msdfShader, slugShader });
}

/** Built-in indexed/ordered Three adapter. Spreading it preserves hooks without shared handle state. */
export const ThreeConfig: ThreeGlyphConfig = defineThreeConfig();
