import {
  createParagraph,
  type AnyRasterTechnique,
  type FontSelection,
  type FormattedText,
  type ParagraphSpan,
} from '@pmndrs/glyph';
import {
  createTextRuntime,
  compileFontBinding,
  TextEngineHost,
  TextEngineRenderPlanView,
  TextEngineStatusError,
  type FontBindingDescriptor,
  type HostFontStackBinding,
  type HostMaterialBinding,
  type HostPolicy,
  type HostResourceBinding,
  type HostTransformBinding,
  type MaterialHandle,
  type PlanTarget,
  type RenderPlanClipId,
  type RenderPlanSemanticId,
  type RenderPlanTransformId,
  type ResourceHandle,
  type SynchronousTextEngineSession,
} from '@pmndrs/glyph/core';
// @ts-expect-error Dynamic engine session IDs are package-managed implementation state.
import type { TextEngineSessionHandle as PublicTextEngineSessionHandle } from '@pmndrs/glyph/core';
void (undefined as unknown as PublicTextEngineSessionHandle);
// @ts-expect-error Raw frame compilation is package-managed implementation state.
import { compileTextEngineFrameUpdate as publicCompileTextEngineFrameUpdate } from '@pmndrs/glyph/core';
void publicCompileTextEngineFrameUpdate;
// @ts-expect-error Raw Wasm publications are package-managed implementation state.
import type { TextEnginePublication as PublicTextEnginePublication } from '@pmndrs/glyph/core';
void (undefined as unknown as PublicTextEnginePublication);
// @ts-expect-error Owned-publication branding was replaced by target-bound delivery.
import type { OwnedTextEnginePublication as PublicOwnedTextEnginePublication } from '@pmndrs/glyph/core';
void (undefined as unknown as PublicOwnedTextEnginePublication);

const runtime = await createTextRuntime();
const host: TextEngineHost = runtime.createTextEngineHost({ integration: 'core-api-test' });
declare const installedPolicy: HostPolicy;
declare const stackBinding: HostFontStackBinding;
declare const materialBinding: HostMaterialBinding;
declare const resourceBinding: HostResourceBinding;
declare const transformBinding: HostTransformBinding;
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
const session: SynchronousTextEngineSession = host.createSession({
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
const retainedText = session.createText({ font: stackBinding, text: 'hello' });
retainedText.update({ text: 'world' });
const retainedMeasurement = retainedText.layout();
const retainedInspection = retainedText.glyphs();
void retainedMeasurement;
void retainedInspection;
session.createText({ font: stackBinding, text: 'material', material: materialBinding, transform: transformBinding });
// @ts-expect-error Resource identities cannot be authored where a material identity is required.
session.createText({ font: stackBinding, text: 'resource-as-material', material: resourceBinding });
// @ts-expect-error Material identities cannot be authored where a transform identity is required.
session.createText({ font: stackBinding, text: 'material-as-transform', transform: materialBinding });
session.createText({
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
session.createText({
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
const acceptance = session.publish();
void acceptance;
// @ts-expect-error Policy parameters have no registered schema and are not an accepted publish input.
session.publish({ policyParameters: new Uint8Array() });

// @ts-expect-error Retained sessions expose no raw update protocol.
session.update(new Uint8Array());
// @ts-expect-error Retained sessions expose no caller-authored acceptance cursor.
void session.acknowledgedGeneration;

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

declare const status: TextEngineStatusError;
const code: number = status.status;
void code;

// Policy authoring is core: a third-party renderer declares its own programs and
// compiles them to validated bytes without touching Three.
import {
  compileRenderPolicy,
  programContext,
  renderWireId,
  RenderWireIdentityRegistry,
  techniqueId as renderTechniqueId,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  type PolicyProgram,
} from '@pmndrs/glyph/core';

const techniqueId: number = renderWireId('example.technique');
const brandedTechniqueId: number = renderTechniqueId('example.technique');
const registry = new RenderWireIdentityRegistry();
void registry;

declare const capability: PolicyCapabilitySet;
declare const program: PolicyProgram;
const descriptor: PolicyDescriptor = { capabilitySets: [capability], programs: [program] };
const policyBytes: Uint8Array = compileRenderPolicy(descriptor);
host.installPolicy(() => descriptor);
// @ts-expect-error A policy value has no host identity context; install through a factory.
host.installPolicy(descriptor);
// @ts-expect-error Dynamic ID allocation is package-managed implementation state.
host.id('policy', 'consumer-authored');
// @ts-expect-error Raw policy registration is package-managed implementation state.
host.registerPolicy(1, policyBytes);
// @ts-expect-error The host's collision registry is supplied only to its policy factory.
void host.wireIdentities;
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
