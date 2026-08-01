export type {
  BakeProgress,
  BakeProgressListener,
  BakeProgressPhase,
  AnyRasterBakerModule,
  BakeArtifactV0,
  RasterBakeArtifact,
  RasterBakeDescriptorOf,
  RasterBakeFontContext,
  RasterBakeOptionsOf,
  RasterBakePlan,
  RasterBakeRequest,
  RasterBakerModule,
  RasterPackagingV0,
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
  LoadedFont,
  FontMetrics,
  FontRasterModuleOf,
  FontSourceOverride,
  FontToken,
  RegisteredFont,
} from './font.js';
export { defineFont } from './font.js';

export type { FontHandle, FontKey, FontSlot, LocalGlyphId, RasterHandle, RasterKey, Sha256Hex } from './identity.js';

export type { FontSlotRecord, ParagraphLayout, ParagraphMeasurement } from './layout.js';

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

export type { GlyphPaint, LinearRgba, ResolvedPaint } from './paint.js';

export type {
  Paragraph,
  ParagraphAxisConstraint,
  ParagraphConstraints,
  ParagraphEngine,
  ParagraphEngineOptions,
  ParagraphInput,
  ParagraphSpan,
  ParagraphStyle,
} from './paragraph.js';
export { createParagraphEngine } from './paragraph.js';

export type {
  AnyRasterModule,
  AnyRasterInput,
  JsonValue,
  LoadedRaster,
  RasterBatchOf,
  RasterKind,
  RasterKindOf,
  RasterLoadOptions,
  RasterModule,
  RasterInput,
  RasterReference,
  RasterRequest,
  RasterResolver,
  RasterResolverContext,
  RasterResourceResolver,
  RasterResourceResolverContext,
  RasterResourceSource,
  RasterResourceOf,
  RasterOptionsOf,
  RasterOptionsArgument,
  RasterSelection,
  RasterSource,
  StaticNumberTuple,
  RegisteredRaster,
  RuntimeRasterBakeRequest,
  RuntimeRasterBakerLoader,
  RuntimeRasterBakerModule,
} from './raster.js';
export { defineRaster } from './raster.js';
export { RasterRuntime } from './raster-runtime.js';
export type { RasterDrawBatch } from './raster.js';

export type { RasterCoverage, RasterCoverageV0, RasterUnicodeRange, RasterUnicodeRangeV0 } from './raster-coverage.js';
export {
  MAX_RASTER_COVERAGE_GLYPH_IDS,
  MAX_RASTER_COVERAGE_RANGES,
  MAX_RASTER_COVERAGE_SCALARS,
  MAX_RASTER_COVERAGE_TEXT_CODE_POINTS,
  RasterCoverageError,
  normalizeRasterCoverage,
} from './raster-coverage.js';

export type {
  BidiAnalysisViews,
  BidiDirection,
  RuntimeShaper,
  RuntimeShaperMemoryReport,
  RuntimeShaperOptions,
  ReshapeBatchRequest,
  ReshapeRange,
  ShapeBatchRequest,
  ShapeRunRequest,
  ShapedBatchViews,
  TextShaperWasmSource,
} from './shaper.js';
export { createRuntimeShaper } from './shaper.js';

export type {
  FontFeature,
  ResolvedFontFeature,
  TextContentProperties,
  TextFontProperties,
  TextLayoutProperties,
  TextPaintProperties,
  TextProperties,
  TextShapingProperties,
  TextSpan,
  TextUpdateProperties,
} from './text.js';
export { Text } from './text.js';
