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
  ParagraphLayout,
  ParagraphLayoutInspection,
  ParagraphLayoutSummary,
  ParagraphLineMetrics,
  ParagraphMeasurement,
  ParagraphMetrics,
} from './layout.js';

export type { ParagraphLayoutPolicy, ParagraphConstraints } from './text-properties.js';
export type { ParagraphOptions, ParagraphUpdate } from './paragraph.js';
export { createParagraph, Paragraph } from './paragraph.js';

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
} from './raster-technique.js';
export { defineRasterResourceId, defineRasterTechnique } from './raster-technique.js';

export type { RasterCoverage, RasterUnicodeRange } from './raster-coverage.js';

export type { FontFeature, ResolvedFontFeature } from './font-feature.js';
