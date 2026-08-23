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
export { defineRasterBaker, rasterBake } from './bake.js';

export type {
  AnyFontToken,
  BakedFontSource,
  FontInput,
  FontInputOf,
  FontMetrics,
  FontRasterTechniqueOf,
  FontSourceOverride,
  FontToken,
  RegisteredFont,
} from './font.js';
export { defineFont } from './font.js';

export type { FontHandle, FontKey, FontSlot, LocalGlyphId, RasterHandle, RasterKey, Sha256Hex } from './identity.js';

export { glyphFlags } from './layout.js';
export type {
  BaselineMetrics,
  FontSlotRecord,
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

export type {
  FontLoadDiagnostic,
  FontLoadOptions,
  FontLoaderOptions,
  FontRegistryOptions,
  RasterAttachOptions,
  RuntimeFontBake,
  RuntimeFontBakeRequest,
} from './loader.js';
export { FontLoader, FontLoadError, FontRegistry } from './loader.js';

export type { FontSelection, FontStack, LoadedFont } from './loaded-font.js';
export { createFontStack } from './loaded-font.js';

export type {
  GlyphBufferCapacity,
  ParagraphAxisConstraint,
  ParagraphBaseProperties,
  ParagraphContentBox,
  ParagraphContentProperties,
  ParagraphProperties,
  ParagraphStyle,
  TextDecorationStyle,
} from './text-properties.js';

export type {
  ColorInput,
  FormattedText,
  GlyphPaintInput,
  ParagraphSpan,
  SpanFormat,
  SpanStyle,
  SpanTag,
  TextInput,
  TextLiteral,
  TextSpanFragment,
  UnboundSpanTag,
} from './formatted-text.js';
export { alignSpansToClusters, span, txt } from './formatted-text.js';

export type { GlyphPaint, LinearRgba, ResolvedPaint } from './paint.js';

export type {
  JsonValue,
  RasterKind,
  RasterKindOf,
  RasterLoadOptions,
  RasterReference,
  RasterResolver,
  RasterResolverContext,
  RasterResourceResolver,
  RasterResourceResolverContext,
  RasterResourceSource,
  RasterOptionsArgument,
  RasterSelection,
  RasterSource,
  StaticNumberTuple,
  RegisteredRaster,
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
} from './raster-technique.js';
export { defineRasterResourceId, defineRasterTechnique } from './raster-technique.js';

export type { RasterCoverage, RasterUnicodeRange } from './raster-coverage.js';

export type { FontFeature, ResolvedFontFeature } from './font-feature.js';

export type {
  LoadedFontInput,
  LoadedFontRasterRequests,
  LoadedFontRequest,
  LoadedFontTechniques,
  LoadedFonts,
  LoadedFontsRequest,
  TextRuntime,
  TextRuntimeOptions,
} from './text-runtime.js';
export { createTextRuntime } from './text-runtime.js';
