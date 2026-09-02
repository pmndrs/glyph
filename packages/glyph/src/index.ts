export type {
  BakeProgress,
  BakeProgressListener,
  BakeProgressPhase,
  AnyRasterBakerModule,
  BakeArtifact,
  RasterBakeArtifact,
  RasterBakeDescriptorOf,
  RasterBakeFontContext,
  RasterBakeOptionsOf,
  RasterBakePlan,
  RasterBakeRequest,
  RasterBakerModule,
  RasterPackaging,
  RasterPagePayloadReport,
  RasterPayloadReport,
  BakeWarning,
  FontPayloadReport,
  SerializedBakeError,
} from './bake.js';
export { glyph, type Glyph } from './glyph.js';
export {
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  type AnyGlyphBindings,
  type BufferPatch,
  type CommandBufferView,
  type Codec,
  type GlyphBatchBindingInput,
  type GlyphBindings,
  type GlyphBufferBindingInput,
  type GlyphConfig,
  type GlyphConfigHandle,
  type GlyphCopy,
  type GlyphCopyDestination,
  type GlyphCopyRequest,
  type GlyphHandle,
  type GlyphInstanceSpanBindingInput,
  type GlyphRenderer,
  type GlyphRoot,
  type GlyphRootInstanceBindingInput,
  type GlyphRootRecipeContext,
  type GlyphRootServices,
  type GlyphSchema,
  type GlyphTextController,
  type GlyphTextState,
  type ResourceLease,
} from './core/glyph-config.js';
export {
  compileRenderPolicy,
  id,
  type PolicyBufferId,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  type PolicyProgram,
  type RenderIdFactory,
} from './core/render-policy.js';
export { definePolicyBuffers } from './core/technique-schema.js';
export type {
  TechniqueGeometryDeclaration,
  TechniqueResourceDeclaration,
  TechniqueResourceDeclarations,
} from './core/technique-schema.js';
export {
  assertPortableResource,
  type PortableGeometryPayload,
  type PortableResource,
} from './core/portable-resources.js';
export { createRasterPolicyProgram, resolveRasterPlanProgram } from './core/raster-plan-program.js';
export type { RenderPlanScalarType } from './core/plan-view.js';

export type {
  AnyFontFace,
  AnyFontFaceSelection,
  FontFace,
  FontFaceConfig,
  FontFaceDeclaredFormat,
  FontFaceFormat,
  FontFaceFormatDeclaration,
  FontFaceSelection,
  FontFaceSource,
  FontFaceTechniqueOf,
} from './font-face.js';

export type {
  AnyFontToken,
  BakedFontSource,
  Font,
  FontBytesInput,
  FontInput,
  FontInputOf,
  FontMetrics,
  RasterDecodeFont,
  FontRasterTechniqueOf,
  FontSourceOverride,
  FontToken,
} from './font.js';
export { defineFont } from './font.js';

export type { FontSlot, LocalGlyphId, RasterKey, Sha256Hex } from './identity.js';

export { glyphFlags } from './layout.js';
export type {
  BaselineMetrics,
  FontSlotRecord,
  LayoutBox,
  ParagraphIntrinsicWidths,
  GlyphLayout,
  GlyphLayoutInspection,
  ParagraphLayoutSummary,
  ParagraphLineMetrics,
  ParagraphMeasurement,
  ParagraphMetrics,
} from './layout.js';

export type { ParagraphOptions, ParagraphUpdate } from './paragraph.js';
export { createParagraph, Paragraph } from './paragraph.js';

export type { GlyphCaret, GlyphKey } from './glyph-placement.js';

export type {
  FontLoadDiagnostic,
  FontLoadOptions,
  FontLibrary,
  FontLibraryOptions,
  FontRasterInputs,
  Fonts,
  LoadFontInput,
  RuntimeFontBake,
  RuntimeFontBakeRequest,
} from './loader.js';
export { createFontLibrary, FontLoadError, loadFont } from './loader.js';

export type { FontSelection, FontStack } from './loaded-font.js';
export { createFontStack } from './loaded-font.js';

export type {
  AxisConstraint,
  ColorInput,
  GlyphBufferCapacity,
  LinearRgbaInput,
  ParagraphBaseProperties,
  ParagraphContentProperties,
  ParagraphProperties,
  PropertyList,
  TextDecorationStyle,
} from './text-properties.js';
export { Constraints, ParagraphLayout, TextStyle } from './text-properties.js';

export type {
  FormattedText,
  ParagraphSpan,
  SpanFormat,
  SpanStyle,
  SpanTag,
  TextInput,
  TextLiteral,
  TextSpanFragment,
  UnboundSpanTag,
} from './formatted-text.js';
export { span, txt } from './formatted-text.js';

export type { GlyphPaint, LinearRgba, ResolvedPaint } from './paint.js';

export type {
  JsonValue,
  RasterKind,
  RasterKindOf,
  RasterReference,
  RasterDecodeArtifact,
  RasterResourceSource,
  RasterOptionsArgument,
  RasterSource,
  StaticNumberTuple,
  RuntimeRasterBakeRequest,
  RuntimeRasterBakerLoader,
  RuntimeRasterBakerModule,
} from './raster.js';

export type {
  AnyRasterTechnique,
  RasterDataOf,
  RasterResourceId,
  RasterTechnique,
  RasterTechniqueDescriptorOf,
  RasterTechniqueId,
  RasterOptionsOf,
  RasterTechniqueOptionsOf,
  RasterTechniqueInput,
  RasterTechniqueRequest,
  RasterTechniqueTypesOf,
  RasterTextEffect,
} from './raster-technique.js';
export { defineRasterResourceId, defineRasterTechnique } from './raster-technique.js';

export type { RasterCoverage, RasterUnicodeRange } from './raster-coverage.js';

export type { FontFeature, ResolvedFontFeature } from './font-feature.js';
