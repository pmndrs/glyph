import {
  createParagraph,
  type AnyRasterTechnique,
  type FontSelection,
  type FormattedText,
  type ParagraphSpan,
} from '@pmndrs/glyph';
import {
  readCompiledRasterFont,
  createGlyphEngine,
  compileFontBinding,
  GlyphBackend,
  TextEngineRenderPlanView,
  TextEngineStatusError,
  type AnyTechniqueSchema,
  type CompiledRasterFont,
  type RasterPlanProgram,
  type FontBindingDescriptor,
  type BackendFontStackBinding,
  type BackendMaterialBinding,
  type BackendPolicy,
  type BackendResourceBinding,
  type BackendTransformBinding,
  type MaterialHandle,
  type PlanTarget,
  type RenderPlanClipId,
  type RenderPlanSemanticId,
  type RenderPlanTransformId,
  type ResourceHandle,
  type SynchronousRetainedPlan,
  id,
} from '@pmndrs/glyph/core';
import { bitmapPlanProgram } from '@pmndrs/glyph/raster/bitmap';
// @ts-expect-error Dynamic engine plan IDs are package-managed implementation state.
import type { RetainedPlanHandle as PublicRetainedPlanHandle } from '@pmndrs/glyph/core';
void (undefined as unknown as PublicRetainedPlanHandle);
// @ts-expect-error Raw frame compilation is package-managed implementation state.
import { compileTextEngineFrameUpdate as publicCompileTextEngineFrameUpdate } from '@pmndrs/glyph/core';
void publicCompileTextEngineFrameUpdate;
// @ts-expect-error Raw Wasm publications are package-managed implementation state.
import type { PlanPublication as PublicTextEnginePublication } from '@pmndrs/glyph/core';
void (undefined as unknown as PublicTextEnginePublication);
// @ts-expect-error Owned-publication branding was replaced by target-bound delivery.
import type { OwnedPlanPublication as PublicOwnedTextEnginePublication } from '@pmndrs/glyph/core';
void (undefined as unknown as PublicOwnedTextEnginePublication);

const glyphEngine = await createGlyphEngine();
const backend: GlyphBackend = glyphEngine.createBackend({ integration: 'core-api-test' });
declare const installedPolicy: BackendPolicy;
declare const stackBinding: BackendFontStackBinding;
declare const materialBinding: BackendMaterialBinding;
declare const resourceBinding: BackendResourceBinding;
declare const transformBinding: BackendTransformBinding;
declare const materialHandle: MaterialHandle;
declare const resourceHandle: ResourceHandle;
const target: PlanTarget = {
  delivery: 'borrowed',
  accept(candidate) {
    void candidate.plan.table('draws');
    candidate.resolveMaterial(materialHandle);
    candidate.resolveResource(resourceHandle);
    candidate.acquirePayload(resourceHandle).dispose();
    return { accepted: true };
  },
  dispose() {},
};
const retainedPlan: SynchronousRetainedPlan = backend.createRetainedPlan({
  policy: installedPolicy,
  target: () => target,
  limits: {
    maxParagraphs: 8,
    maxClusters: 256,
    maxLines: 64,
    maxRegions: 8,
    maxExclusions: 8,
    maxInlineObjects: 8,
    maxSlotsPerBand: 8,
    maxOutputBytes: 128 * 1024,
  },
  requestCapacity: 4096,
  resultCapacity: 128 * 1024,
  textCapacity: 1024,
});
const retainedText = retainedPlan.createText({ font: stackBinding, text: 'hello' });
retainedText.update({ text: 'world' });
const retainedMeasurement = retainedText.layout();
const retainedInspection = retainedText.glyphs();
void retainedMeasurement;
void retainedInspection;
retainedPlan.createText({
  font: stackBinding,
  text: 'material',
  material: materialBinding,
  transform: transformBinding,
});
// @ts-expect-error Resource identities cannot be authored where a material identity is required.
retainedPlan.createText({ font: stackBinding, text: 'resource-as-material', material: resourceBinding });
// @ts-expect-error Material identities cannot be authored where a transform identity is required.
retainedPlan.createText({ font: stackBinding, text: 'material-as-transform', transform: materialBinding });
retainedPlan.createText({
  font: stackBinding,
  text: 'inline',
  inlineObjects: [
    {
      textOffset: 0,
      material: materialBinding,
      resource: resourceBinding,
      inlineExtent: 1,
      blockExtent: 1,
      baselineOffset: 0,
      marginInlineStart: 0,
      marginInlineEnd: 0,
      marginBlockStart: 0,
      marginBlockEnd: 0,
      baselineAlignment: 'alphabetic',
    },
  ],
});
retainedPlan.createText({
  font: stackBinding,
  text: 'invalid-inline',
  inlineObjects: [
    {
      textOffset: 0,
      material: materialBinding,
      // @ts-expect-error Inline resources have a distinct identity domain from materials.
      resource: materialBinding,
      inlineExtent: 1,
      blockExtent: 1,
      baselineOffset: 0,
      marginInlineStart: 0,
      marginInlineEnd: 0,
      marginBlockStart: 0,
      marginBlockEnd: 0,
      baselineAlignment: 'alphabetic',
    },
  ],
});
const acceptance = retainedPlan.publish();
void acceptance;
// @ts-expect-error Policy parameters have no registered schema and are not an accepted publish input.
retainedPlan.publish({ policyParameters: new Uint8Array() });

// @ts-expect-error Retained plans expose no raw update protocol.
retainedPlan.update(new Uint8Array());
// @ts-expect-error Retained plans expose no caller-authored acceptance cursor.
void retainedPlan.acknowledgedGeneration;

declare const transferredBytes: Uint8Array<ArrayBuffer>;
const plan = new TextEngineRenderPlanView().bindBytes(transferredBytes);
const draws = plan.table('draws');
void plan.record(draws, 0);

declare const clipId: RenderPlanClipId;
declare const semanticId: RenderPlanSemanticId;
declare const transformId: RenderPlanTransformId;
const numericClipId: number = clipId;
const numericSemanticId: number = semanticId;
const numericTransformId: number = transformId;
void numericClipId;
void numericSemanticId;
void numericTransformId;
// @ts-expect-error Render-plan clip identities are engine-owned, not caller-authored numbers.
const rawClipId: RenderPlanClipId = 1;
// @ts-expect-error Render-plan semantic identities are engine-owned, not caller-authored numbers.
const rawSemanticId: RenderPlanSemanticId = 1;
// @ts-expect-error Render-plan transform identities are host-bound, not caller-authored numbers.
const rawTransformId: RenderPlanTransformId = 1;
void rawClipId;
void rawSemanticId;
void rawTransformId;
const numericMaterialHandle: number = materialHandle;
const numericResourceHandle: number = resourceHandle;
void numericMaterialHandle;
void numericResourceHandle;
// @ts-expect-error Material identities are host-owned, not caller-authored numbers.
const rawMaterialHandle: MaterialHandle = 1;
// @ts-expect-error Resource identities are host-owned, not caller-authored numbers.
const rawResourceHandle: ResourceHandle = 1;
void rawMaterialHandle;
void rawResourceHandle;

declare const binding: FontBindingDescriptor;
const bindingBytes: Uint8Array = compileFontBinding(binding);
void bindingBytes;

declare const compiledRasterFont: CompiledRasterFont;
declare const rasterPlanProgram: RasterPlanProgram<AnyRasterTechnique, AnyTechniqueSchema>;
const compiledRasterView = readCompiledRasterFont(compiledRasterFont, rasterPlanProgram);
const compiledResource = compiledRasterView.resource(0, 0);
const compiledF32: number = compiledRasterView.f32('bearingX', 0);
const compiledU32: number = compiledRasterView.u32('page', 0);
void compiledResource;
void compiledF32;
void compiledU32;

const exactCompiledRasterView = readCompiledRasterFont(compiledRasterFont, bitmapPlanProgram);
exactCompiledRasterView.f32('bearingX', 0);
exactCompiledRasterView.u32('page', 0);
// @ts-expect-error Compiled field names are derived from the exact registered schema.
exactCompiledRasterView.f32('missing', 0);
// @ts-expect-error Scalar domains stay distinct even when both fields exist.
exactCompiledRasterView.u32('bearingX', 0);

declare const status: TextEngineStatusError;
const code: number = status.status;
void code;

// Policy authoring is core: a third-party renderer declares its own programs and
// compiles them to validated bytes without touching Three.
import {
  compileRenderPolicy,
  programContext,
  type RenderIdFactory,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  type PolicyProgram,
} from '@pmndrs/glyph/core';

const techniqueId: number = id.technique('example.technique');
const brandedTechniqueId: number = id.technique('example.technique');
const registry: RenderIdFactory = id;
void registry;

declare const capability: PolicyCapabilitySet;
declare const program: PolicyProgram;
const descriptor: PolicyDescriptor = { capabilitySets: [capability], programs: [program] };
const policyBytes: Uint8Array = compileRenderPolicy(descriptor);
backend.installPolicy(() => descriptor);
// @ts-expect-error A policy value has no host identity context; install through a factory.
backend.installPolicy(descriptor);
// @ts-expect-error Dynamic ID allocation is package-managed implementation state.
backend.id('policy', 'consumer-authored');
// @ts-expect-error Raw policy registration is package-managed implementation state.
backend.registerPolicy(1, policyBytes);
// @ts-expect-error The host's collision registry is supplied only to its policy factory.
void backend.wireIdentities;
void policyBytes;
void techniqueId;
void brandedTechniqueId;
void programContext;

// Paragraph content has one authority: plain text may carry explicit spans,
// while formatted text carries its own spans and cannot be combined with another array.
declare const paragraphFont: FontSelection<AnyRasterTechnique>;
declare const formattedText: FormattedText<AnyRasterTechnique>;
declare const paragraphSpans: readonly ParagraphSpan<AnyRasterTechnique>[];
const paragraph = await createParagraph({ font: paragraphFont, text: 'plain', spans: paragraphSpans });
const formattedParagraph = await createParagraph({ font: paragraphFont, text: formattedText });
void formattedParagraph;
// @ts-expect-error Formatted text already owns its spans.
const invalidFormattedParagraph = createParagraph({
  font: paragraphFont,
  text: formattedText,
  spans: paragraphSpans,
});
void invalidFormattedParagraph;
paragraph.update({ text: 'updated', spans: paragraphSpans });
paragraph.update({ text: formattedText });
// @ts-expect-error Updates cannot provide two span authorities either.
paragraph.update({ text: formattedText, spans: paragraphSpans });
