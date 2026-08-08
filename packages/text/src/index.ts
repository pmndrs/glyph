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
  LoadedFontV0,
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

export type { FontSelection, FontStack, LoadedFont } from './loaded-font.js';
export { createFontStack, FontLeaseError } from './loaded-font.js';

export type {
  GlyphBatchKey,
  GlyphBufferCapacity,
  GlyphCapacityOverflow,
  GlyphOriginUpdate,
  GlyphSnapshot,
  GlyphTopology,
  Paragraph,
  ParagraphAxisConstraint,
  ParagraphBaseProperties,
  ParagraphBatch,
  ParagraphBatchObserver,
  ParagraphBatchOptions,
  ParagraphContentBox,
  ParagraphContentProperties,
  ParagraphId,
  ParagraphProperties,
  ParagraphSnapshot,
  ParagraphUpdate,
  PreparedGlyphBatch,
  PreparedGlyphRun,
  PreparedParagraph,
  PreparedParagraphBatchRevision,
  TextPreparationError,
} from './paragraph-batch.js';
export type {
  ParagraphBatchAttachment,
  ParagraphBatchTarget,
  ParagraphBatchTargetError,
  ParagraphBatchTargetRevision,
  ParagraphBatchTargetStage,
  ParagraphBatchTargetUpdate,
} from './paragraph-batch-attachment.js';

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
export { span, txt } from './formatted-text.js';

export type { IdentifiedSpanRange, SpanRange } from './internal/span-cascade.js';
export { SpanNestingError } from './internal/span-cascade.js';

export type { GlyphPaint, LinearRgba, ResolvedPaint } from './paint.js';
export { setTextProfiler, userTimingProfiler } from './profiler.js';
export type { TextProfilePhase, TextProfiler } from './profiler.js';

export type {
  ParagraphConstraints,
  ParagraphEngine,
  ParagraphEngineOptions,
  ParagraphInput,
  ParagraphStyle,
} from './paragraph.js';
export type { Paragraph as LayoutParagraph } from './paragraph.js';
export type { ParagraphAxisConstraint as LayoutParagraphAxisConstraint } from './paragraph.js';
export { createParagraphEngine } from './paragraph.js';

export type {
  AnyRasterModule,
  AnyRasterInput,
  JsonValue,
  LoadedRaster,
  RasterBatchOf,
  RasterBatchStage,
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
  RasterModuleOptionsOf,
  RasterOptionsArgument,
  RasterSelection,
  RasterSource,
  StaticNumberTuple,
  RegisteredRaster,
  RuntimeRasterBakeRequest,
  RuntimeRasterBakerLoader,
  RuntimeRasterBakerModule,
} from './raster.js';
export { defineRaster, defineRasterBatchStage } from './raster.js';
export { RasterRuntime } from './raster-runtime.js';
export type { RasterDrawBatch, RasterObjectDrawBatch } from './raster.js';

export type {
  AnyRasterTechnique,
  GlyphBatchStorage,
  GlyphBatchStorageOf,
  GlyphBatchStorageShape,
  GlyphRange,
  RasterBindingOf,
  RasterDataOf,
  RasterGlyphInput,
  RasterGlyphSelection,
  RasterGlyphWriteInput,
  RasterResourceId,
  RasterTechnique,
  RasterTechniqueDescriptorOf,
  RasterTechniqueId,
  RasterOptionsOf,
  RasterTechniqueOptionsOf,
  RasterTechniqueTypesOf,
} from './raster-technique.js';
export { defineRasterResourceId, defineRasterTechnique } from './raster-technique.js';

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
export type { FontFeature, ResolvedFontFeature } from './font-feature.js';

export type {
  AsyncTextUpdateOptions,
  LoadedFontInput,
  LoadedFontRequest,
  TextPreparationWorker,
  TextRuntime,
  TextRuntimeOptions,
  TextRuntimeRevision,
  TextUpdateCallback,
  TextUpdateOutcome,
  TextUpdateProgress,
  TextUpdateResult,
} from './text-runtime.js';
export { createTextPreparationWorker, createTextRuntime } from './text-runtime.js';
