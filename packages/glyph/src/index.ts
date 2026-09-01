export type {
  BakeProgress,
  BakeProgressListener,
  BakeProgressPhase,
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
export { GlyphError, type GlyphErrorCode } from './glyph-error.js';
export {
  GlyphEngineStatusError,
  glyphEngineStatusErrorDetails,
  type GlyphEngineFault,
  type GlyphEngineStatusCode,
  type GlyphEngineStatusDetails,
} from './engine-error.js';
export type {
  GlyphBindingSet,
  BorrowedCommandSequence,
  BatchIdentity,
  BufferPatch,
  BufferUpdate,
  ClipIdentity,
  CommandBufferView,
  Codec,
  DisplayList,
  DisplayListBatch,
  DisplayListChanges,
  DisplayListChild,
  DisplayListInstanceSpan,
  DisplayListPhase,
  DisplayListRootInstance,
  DisplayListTransform,
  EncodeContext,
  GlyphBatchBindingInput,
  GlyphBufferDeclaration,
  GlyphBufferBindingInput,
  GlyphCommandCapacity,
  GlyphConfig,
  GlyphConfigBindings,
  GlyphConfigFor,
  GlyphConfigHandle,
  GlyphCommandLimits,
  GlyphCopy,
  GlyphCopyDestination,
  GlyphCopyRequest,
  GlyphDrawBindingInput,
  GlyphFontConfig,
  GlyphFormattedText,
  GlyphHandle,
  GlyphHandleFonts,
  GlyphInstanceKind,
  GlyphInstanceSpanBindingInput,
  GlyphNamedRoot,
  PreparedRendererCommit,
  GlyphRenderer,
  GlyphRoot,
  GlyphRootCreateOptions,
  GlyphRootInstanceBindingInput,
  GlyphRootRecipe,
  GlyphRootRecipeContext,
  GlyphRootServices,
  GlyphShapeOptions,
  GlyphSchema,
  GlyphTextSpan,
  GlyphTextController,
  GlyphTextState,
  InstanceIdentity,
  InstanceSpanIdentity,
  ResourceLease,
  ResourceUpdate,
  RendererContext,
  ResolveContext,
  Retirement,
  SelectedGlyphConfig,
  SemanticIdentity,
  TransformUpdate,
} from './config/glyph.js';
export type {
  CodecAllocationMode,
  CodecBuffer,
  CodecBufferId,
  CodecCapability,
  CodecCapabilitySet,
  CodecDescriptor,
  CodecInput,
  CodecInputScope,
  CodecOperation,
  CodecProgram,
  CodecScalarType,
  CodecTransformMode,
  CodecProgramId,
  CodecIdFactory,
  CodecResourceId,
  CodecTechniqueId,
} from './config/codec.js';
export type {
  CodecBufferDeclaration,
  CodecBufferDeclarations,
  CodecScalarKind,
  TechniqueBindingDeclaration,
  TechniqueBufferResourceDeclaration,
  TechniqueCustomGeometryKind,
  TechniqueGeometryCoordinates,
  TechniqueGeometryDeclaration,
  TechniqueGeometryKind,
  TechniqueGeometryResourceDeclaration,
  TechniqueRenderDeclaration,
  TechniqueResourceDeclaration,
  TechniqueResourceDeclarations,
  TechniqueResourceGroupDeclaration,
  TechniqueResourceGroupMembers,
  TechniqueSchema,
  TechniqueSchemaDeclaration,
  TechniqueSuppliedGeometryKind,
  TechniqueTextureArrayResourceDeclaration,
  TechniqueTextureResourceDeclaration,
} from './config/schema.js';
export type {
  CompiledCodecProgramBody,
  CodecColorChannels,
  CodecF32Expressions,
  CodecF32Value,
  CodecProgramBuilder,
  CodecProgramOptions,
  CodecProgramSemantics,
  CodecProgramSystemBuffers,
  CodecU32Expressions,
  CodecU32Value,
  TechniqueCodecProgramBuilder,
  TechniqueCodecStores,
} from './config/codec-program.js';
export type {
  PortableAccessor,
  PortableBufferPayload,
  PortableBufferView,
  PortableComponentType,
  PortableCustomVertexSemantic,
  PortableDrawRange,
  PortableGeometryIndices,
  PortableGeometryPayload,
  PortableLeafResource,
  PortableResource,
  PortableResourceGroupPayload,
  PortableResourceKind,
  PortableTextureArrayPayload,
  PortableTextureFormat,
  PortableTexturePayload,
  PortableTopology,
  PortableVertexAttribute,
  PortableVertexInput,
  PortableVertexSemantic,
} from './config/resources.js';
export type {
  CompiledRasterFont,
  CompiledRasterFontResource,
  CompiledRasterFontView,
  RasterFontBinding,
  RasterCodec,
  RasterCodecFontCompiler,
  RasterCodecFont,
  RasterCodecBodyFactory,
  RasterCodecProgramOptions,
  RasterCodecSystem,
} from './config/raster.js';
export type {
  FontFace,
  FontFaceConfig,
  FontFaceDeclaredFormat,
  FontFaceFormat,
  FontFaceFormatDeclaration,
  FontFaceSelection,
  FontFaceSource,
  FontFaceRasterOf,
} from './font-face.js';
export type {
  FontFaceTransfer,
  SerializedFontFace,
  SerializedFontFaceRaster,
  SerializedFontFaceResource,
  SerializedFontFaceResourceIdentity,
} from './font-face-transfer.js';

export type { Font, FontMetrics, RasterDecodeFont } from './font.js';

export type { FontSlot, LocalGlyphId, RasterKey, Fingerprint } from './identity.js';
// A technique stamps this in its own extension so a core font and its raster agree through one
// comparison; a third-party technique needs it for the same reason a first-party one does.
export { compatibilityFingerprint } from './internal/raster-identity.js';
export { fingerprint } from './identity.js';

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
} from './layout.js';

export type { GlyphCaret, GlyphKey } from './glyph-placement.js';

// Font operations can throw this application-visible error; loader construction remains package-private.
export { GlyphFontError } from './loader.js';

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
  RasterDataOf,
  RasterResourceId,
  RasterFormat,
  RasterFormatDescriptorOf,
  RasterFormatId,
  RasterOptionsOf,
  RasterFormatInput,
  RasterFormatMetadata,
  RasterFormatRequest,
  RasterFormatRequestMetadata,
  RasterFormatTypesOf,
  RasterTextEffect,
} from './config/raster-format.js';

export type { RasterCoverage, RasterUnicodeRange } from './raster-coverage.js';

export type { FontFeature, ResolvedFontFeature } from './font-feature.js';
