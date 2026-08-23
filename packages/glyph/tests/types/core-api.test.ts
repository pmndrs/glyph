import { createTextRuntime } from '@pmndrs/glyph';
import {
  compileFontBinding,
  compileTextEngineFrameUpdate,
  createRuntimeShaper,
  readTextEngineLayouts,
  readTextEngineMeasurements,
  TextEngineHost,
  TextEnginePublicationExpiredError,
  TextEngineRenderPlanView,
  TextEngineStatusError,
  textRuntimeShaper,
  textShaperAbi,
  type FontBindingDescriptor,
  type RetainedTextEnginePublication,
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
host.registerPolicy(1, new Uint8Array(8));
const session: TextEngineSession = host.createSession({
  handle: 1,
  requestCapacity: 4096,
  resultCapacity: textShaperAbi.layouts.engineResult.size,
});

declare const frame: TextEngineFrameUpdate;
const request: Uint8Array = compileTextEngineFrameUpdate(frame);
const publication: TextEnginePublication = session.update(request);

// Retention protocol: borrows expire loudly, retained copies never do.
declare const expiredError: TextEnginePublicationExpiredError;
const generations: readonly [number, number] = [expiredError.consumedGeneration, expiredError.latestGeneration];
void generations;
const retainedPublication: RetainedTextEnginePublication = session.retain(publication);
void retainedPublication;
session.assertLive(publication);
const live: boolean = session.isExpired(publication);
const acknowledged: number = session.acknowledgedGeneration;
void live;
void acknowledged;

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
  techniqueWireIds,
  programContext,
  renderWireId,
  RenderWireIdentityRegistry,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  type PolicyProgram,
} from '@pmndrs/glyph/core';

const techniqueId: number = renderWireId('example.technique');
void techniqueWireIds.decoration;
const registry = new RenderWireIdentityRegistry();
void registry;

declare const capability: PolicyCapabilitySet;
declare const program: PolicyProgram;
const descriptor: PolicyDescriptor = { capabilitySets: [capability], programs: [program] };
const policyBytes: Uint8Array = compileRenderPolicy(descriptor);
void policyBytes;
void techniqueId;
void programContext;
