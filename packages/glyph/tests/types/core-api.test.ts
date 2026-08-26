import {
  createTextRuntime,
  type AnyRasterTechnique,
  type FontSelection,
  type FormattedText,
  type ParagraphSpan,
} from '@pmndrs/glyph';
import {
  assertOwnedTextEnginePublication,
  compileFontBinding,
  compileTextEngineFrameUpdate,
  createRuntimeShaper,
  id,
  Paragraph,
  readTextEngineLayouts,
  readTextEngineMeasurements,
  TextEngineHost,
  TextEnginePublicationExpiredError,
  TextEngineRenderPlanView,
  TextEngineStatusError,
  textRuntimeShaper,
  textShaperAbi,
  type FontBindingDescriptor,
  type OwnedTextEnginePublication,
  type RuntimeShaper,
  type TextEngineFrameUpdate,
  type TextEnginePublication,
  type TextEngineSession,
} from '@pmndrs/glyph/core';

// The renderer-neutral core: a runtime shaper hosts one engine, sessions publish plans.
const shaper: Promise<RuntimeShaper> = createRuntimeShaper();
void shaper;

declare const runtimeShaper: RuntimeShaper;
const host = new TextEngineHost(runtimeShaper);
const policyHandle = id('policy', 'core-api-test/default');
host.registerPolicy(policyHandle, new Uint8Array(8));
host.disposePolicy(policyHandle);
const session: TextEngineSession = host.createSession({
  handle: host.id('session', 'core-api-test/session'),
  requestCapacity: 4096,
  resultCapacity: textShaperAbi.layouts.engineResult.size,
});
host.createSession({
  // @ts-expect-error Host ID domains remain distinct even though every value serializes as a number.
  handle: host.id('paragraph', 'core-api-test/not-a-session'),
  requestCapacity: 4096,
  resultCapacity: textShaperAbi.layouts.engineResult.size,
});
// @ts-expect-error Raw numbers cannot bypass host-scoped provenance.
host.createSession({ handle: 1, requestCapacity: 4096, resultCapacity: textShaperAbi.layouts.engineResult.size });

declare const frame: TextEngineFrameUpdate;
const request: Uint8Array = compileTextEngineFrameUpdate(frame);
const publication: TextEnginePublication = session.update(request);

// Ownership protocol: borrows expire; owned copies do not.
declare const expiredError: TextEnginePublicationExpiredError;
const generations: readonly [number, number] = [expiredError.consumedGeneration, expiredError.latestGeneration];
void generations;
const ownedPublication: OwnedTextEnginePublication = session.copyPublication(publication);
assertOwnedTextEnginePublication(ownedPublication);
// @ts-expect-error A borrowed publication does not carry package-private owned provenance.
const forgedOwnedPublication: OwnedTextEnginePublication = publication;
void forgedOwnedPublication;
void ownedPublication;
const live: boolean = session.isExpired(publication);
void live;
// @ts-expect-error Copying is explicit ownership, not retain/release reference counting.
session.retain(publication);
// @ts-expect-error Borrow checks are internal to ownership-boundary operations.
session.assertLive(publication);
// @ts-expect-error Renderer acceptance is carried by the next frame's revision fields.
session.acknowledge(publication);
// @ts-expect-error Copying bytes must not expose an early-advancing acceptance counter.
void session.acknowledgedGeneration;

const plan = new TextEngineRenderPlanView().bind(publication);
const draws = plan.table('draws');
void plan.record(draws, 0);
void readTextEngineMeasurements;
void readTextEngineLayouts;

declare const binding: FontBindingDescriptor;
const bindingBytes: Uint8Array = compileFontBinding(binding);
void bindingBytes;

// The runtime bridge is public: integrations reach the shaper without private access.
const runtime = await createTextRuntime();
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
