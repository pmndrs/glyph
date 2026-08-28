import { type AnyRasterTechnique, type FontSelection, type FormattedText, type ParagraphSpan } from '@pmndrs/glyph';
import {
  assertOwnedTextEnginePublication,
  createTextRuntime,
  compileFontBinding,
  createRuntimeShaper,
  Paragraph,
  readTextEngineLayouts,
  readTextEngineMeasurements,
  TextEngineHost,
  TextEnginePublicationExpiredError,
  TextEngineRenderPlanView,
  TextEngineStatusError,
  textRuntimeShaper,
  type FontBindingDescriptor,
  type HostFontStackBinding,
  type HostMaterialBinding,
  type HostPolicy,
  type HostResourceBinding,
  type HostTransformBinding,
  type OwnedTextEnginePublication,
  type PlanTarget,
  type RuntimeShaper,
  type TextEnginePublication,
  type SynchronousTextEngineSession,
} from '@pmndrs/glyph/core';

// The renderer-neutral core: a runtime shaper hosts one engine, sessions publish plans.
const shaper: Promise<RuntimeShaper> = createRuntimeShaper();
void shaper;

const runtime = await createTextRuntime();
const host: TextEngineHost = runtime.createTextEngineHost({ integration: 'core-api-test' });
declare const installedPolicy: HostPolicy;
declare const stackBinding: HostFontStackBinding;
declare const materialBinding: HostMaterialBinding;
declare const resourceBinding: HostResourceBinding;
declare const transformBinding: HostTransformBinding;
const target: PlanTarget = {
  delivery: 'borrowed',
  accept(candidate) {
    void candidate.plan.table('draws');
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

declare const publication: TextEnginePublication;

// Ownership protocol: borrows expire; owned copies do not.
declare const expiredError: TextEnginePublicationExpiredError;
const generations: readonly [number, number] = [expiredError.consumedGeneration, expiredError.latestGeneration];
void generations;
declare const ownedPublication: OwnedTextEnginePublication;
assertOwnedTextEnginePublication(ownedPublication);
// @ts-expect-error A borrowed publication does not carry package-private owned provenance.
const forgedOwnedPublication: OwnedTextEnginePublication = publication;
void forgedOwnedPublication;
void ownedPublication;
// @ts-expect-error Retained sessions expose no raw update protocol.
session.update(new Uint8Array());
// @ts-expect-error Retained sessions expose no caller-authored acceptance cursor.
void session.acknowledgedGeneration;

const plan = new TextEngineRenderPlanView().bind(publication);
const transferredPlan = new TextEngineRenderPlanView().bindBytes(ownedPublication.bytes);
void transferredPlan;
const draws = plan.table('draws');
void plan.record(draws, 0);
void readTextEngineMeasurements;
void readTextEngineLayouts;

declare const binding: FontBindingDescriptor;
const bindingBytes: Uint8Array = compileFontBinding(binding);
void bindingBytes;

// The runtime bridge is public: integrations reach the shaper without private access.
const bridged: RuntimeShaper = textRuntimeShaper(runtime);
void bridged;

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
void policyBytes;
void techniqueId;
void brandedTechniqueId;
void programContext;

// Paragraph content has one authority: plain text may carry explicit spans,
// while formatted text carries its own spans and cannot be combined with another array.
declare const paragraphFont: FontSelection<AnyRasterTechnique>;
declare const formattedText: FormattedText<AnyRasterTechnique>;
declare const paragraphSpans: readonly ParagraphSpan<AnyRasterTechnique>[];
const paragraph = new Paragraph({ font: paragraphFont, text: 'plain', spans: paragraphSpans });
const formattedParagraph = new Paragraph({ font: paragraphFont, text: formattedText });
void formattedParagraph;
// @ts-expect-error Formatted text already owns its spans.
const invalidFormattedParagraph = new Paragraph({ font: paragraphFont, text: formattedText, spans: paragraphSpans });
void invalidFormattedParagraph;
paragraph.update({ text: 'updated', spans: paragraphSpans });
paragraph.update({ text: formattedText });
// @ts-expect-error Updates cannot provide two span authorities either.
paragraph.update({ text: formattedText, spans: paragraphSpans });
