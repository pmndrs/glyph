/**
 * The renderer-neutral text engine: everything a custom renderer integration needs to
 * load fonts into one Wasm shaper, serialize frame updates, and consume revisioned
 * render plans. `@pmndrs/text/three` is implemented on exactly this surface.
 */
export {
  createRuntimeShaper,
  type RuntimeShaper,
  type RuntimeShaperMemoryReport,
  type RuntimeShaperOptions,
  type TextShaperWasmSource,
} from './shaper.js';
export { textRuntimeShaper } from './text-runtime.js';
export {
  acquireFontSelectionForRuntime,
  assertFontSelectionForRuntime,
  concreteFonts,
  observeLoadedFontDispose,
  releaseFontSelection,
} from './loaded-font.js';
export {
  TextEngineHost,
  TextEngineSession,
  TextEngineStatusError,
  type TextEnginePublication,
  type TextEngineSessionOptions,
} from './core/host.js';
export {
  compileTextEngineFrameUpdate,
  type TextEngineConstraint,
  type TextEngineDecoration,
  type TextEngineExclusion,
  type TextEngineFeature,
  type TextEngineFrameLimits,
  type TextEngineFlowVertex,
  type TextEngineFrameUpdate,
  type TextEngineInlineObject,
  type TextEngineParagraphMutation,
  type TextEngineRegion,
  type TextEngineStyleMutation,
  type TextEngineStyleValue,
  type TextEngineTextMutation,
} from './core/frame-wire.js';
export { TextEngineRenderPlanView, type RenderPlanTable } from './core/plan-view.js';
export { readTextEngineLayouts, readTextEngineMeasurements } from './core/layout-query-view.js';
export {
  compileFontBinding,
  schemaFieldTable,
  emptyFontBindingTable,
  loadedFontBindingBytes,
  fontBindingResources,
  type BindingResource,
  type FontBindingDescriptor,
  type FontBindingFieldTable,
} from './core/font-binding.js';
export {
  compileRenderPolicy,
  createProgram,
  techniqueWireIds,
  floatBuffers,
  programContext,
  renderWireId,
  RenderWireIdentityRegistry,
  stores,
  u32Buffers,
  type TechniqueWireIds,
  type PolicyAllocationMode,
  type PolicyBuffer,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  type PolicyInput,
  type PolicyInputScope,
  type PolicyOperation,
  type PolicyProgram,
  type PolicyTransformMode,
  type ProgramContext,
} from './core/render-policy.js';
export {
  definePolicyBuffers,
  defineTechniqueSchema,
  schemaPolicyBuffers,
  type PolicyBufferDeclaration,
  type PolicyBufferDeclarations,
  type PolicyScalarKind,
  type TechniqueBindingDeclaration,
  type TechniqueResourceDeclaration,
  type TechniqueSchema,
  type TechniqueSchemaDeclaration,
} from './core/technique-schema.js';
export {
  addF32,
  constantF32,
  constantU32,
  multiplyF32,
  policyProgram,
  techniqueProgram,
  subtractF32,
  u32ToF32,
  type CompiledPolicyProgramBody,
  type PolicyColorChannels,
  type PolicyF32Value,
  type PolicyProgramBuilder,
  type PolicyProgramOptions,
  type PolicyProgramSemantics,
  type PolicyU32Value,
} from './core/policy-program.js';
export { textShaperAbi } from './generated/text-shaper-abi.js';
