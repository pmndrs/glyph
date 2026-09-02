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
  GlyphEngineStatusError,
  glyphEngineStatusErrorDetails,
  type GlyphEngineFault,
  type GlyphEngineStatusCode,
  type GlyphEngineStatusDetails,
} from './core/backend.js';
export {
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  type AnyGlyphBindings,
  type BorrowedCommandSequence,
  type BufferPatch,
  type BufferUpdate,
  type CommandBufferView,
  type Codec,
  type DisplayList,
  type DisplayListBatch,
  type DisplayListChanges,
  type DisplayListChild,
  type DisplayListInstanceSpan,
  type DisplayListPhase,
  type DisplayListRootInstance,
  type DisplayListTransform,
  type EncodeContext,
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
  type PreparedRendererCommit,
  type GlyphRenderer,
  type GlyphRoot,
  type GlyphRootInstanceBindingInput,
  type GlyphRootRecipeContext,
  type GlyphRootServices,
  type GlyphSchema,
  type GlyphTextController,
  type GlyphTextState,
  type ResourceLease,
  type ResourceUpdate,
  type RendererContext,
  type ResolveContext,
  type Retirement,
  type TransformUpdate,
} from './core/glyph-config.js';
export {
  compileRenderPolicy,
  createProgram,
  id,
  type PolicyAllocationMode,
  type PolicyBuffer,
  type PolicyBufferId,
  type PolicyCapability,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  type PolicyInput,
  type PolicyInputScope,
  type PolicyOperation,
  type PolicyProgram,
  type PolicyScalarType,
  type PolicyTransformMode,
  type RenderProgramId,
  type RenderIdFactory,
  type RenderResourceId,
  type RenderTechniqueId,
  selectPolicyCapabilitySet,
} from './core/render-policy.js';
export {
  definePolicyBuffers,
  defineTechniqueGeometryKind,
  defineTechniqueSchema,
  schemaPolicyBuffers,
  type AnyTechniqueSchema,
  type PolicyBufferDeclaration,
  type PolicyBufferDeclarations,
  type PolicyScalarKind,
  type TechniqueBindingDeclaration,
  type TechniqueBufferResourceDeclaration,
  type TechniqueCustomGeometryKind,
  type TechniqueGeometryCoordinates,
  type TechniqueGeometryDeclaration,
  type TechniqueGeometryKind,
  type TechniqueGeometryResourceDeclaration,
  type TechniqueRenderDeclaration,
  type TechniqueResourceDeclaration,
  type TechniqueResourceDeclarations,
  type TechniqueResourceGroupDeclaration,
  type TechniqueResourceGroupMembers,
  type TechniqueSchema,
  type TechniqueSchemaDeclaration,
  type TechniqueSuppliedGeometryKind,
  type TechniqueTextureArrayResourceDeclaration,
  type TechniqueTextureResourceDeclaration,
} from './core/technique-schema.js';
export {
  f32,
  policyProgram,
  techniqueProgram,
  u32,
  type CompiledPolicyProgramBody,
  type PolicyColorChannels,
  type PolicyF32Expressions,
  type PolicyF32Value,
  type PolicyProgramBuilder,
  type PolicyProgramOptions,
  type PolicyProgramSemantics,
  type PolicyProgramSystemBuffers,
  type PolicyU32Expressions,
  type PolicyU32Value,
  type TechniquePolicyProgramBuilder,
  type TechniquePolicyStores,
} from './core/policy-program.js';
export {
  assertPortableResource,
  assertPortableVertexSemantic,
  definePortableVertexSemantic,
  portableResourceKinds,
  portableTextureFormats,
  portableTopologies,
  type PortableAccessor,
  type PortableBufferPayload,
  type PortableBufferView,
  type PortableComponentType,
  type PortableCustomVertexSemantic,
  type PortableDrawRange,
  type PortableGeometryIndices,
  type PortableGeometryPayload,
  type PortableLeafResource,
  type PortableResource,
  type PortableResourceGroupPayload,
  type PortableResourceKind,
  type PortableTextureArrayPayload,
  type PortableTextureFormat,
  type PortableTexturePayload,
  type PortableTopology,
  type PortableVertexAttribute,
  type PortableVertexInput,
  type PortableVertexSemantic,
} from './core/portable-resources.js';
export {
  compileRasterFont,
  createRasterPolicyProgram,
  readCompiledRasterFont,
  registerRasterPlanProgram,
  resolveRasterPlanProgram,
  type CompiledRasterFont,
  type CompiledRasterFontResource,
  type CompiledRasterFontView,
  type RasterFontBinding,
  type RasterPlanProgram,
  type RasterPlanProgramFontCompiler,
  type RasterPolicyBodyFactory,
  type RasterPolicyProgramOptions,
  type RasterPolicySystem,
} from './core/raster-plan-program.js';
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
