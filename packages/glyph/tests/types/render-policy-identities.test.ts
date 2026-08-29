import {
  createProgram,
  selectPolicyCapabilitySet,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  id,
} from '../../src/core/render-policy.js';
import { compilePlannerFrameUpdate, type PlannerFrameUpdate } from '../../src/core/frame-wire.js';
import type { ParagraphId, PlannerHandle } from '../../src/core/render-policy.js';
import { textShaperAbi } from '../../src/generated/text-shaper-abi.js';
import { defineRasterResourceId } from '../../src/raster-technique.js';

const technique = id.technique('vendor.example');
const program = id.program('vendor.example', 'renderer');
const resource = id.resource(defineRasterResourceId('vendor.example/resource'));
const buffer = id.buffer('vendor.example/value');
const generic = id('vendor.example/local');
const body = {
  inputs: [],
  operations: [
    { opcode: textShaperAbi.policy.opcodes.constantU32, target: 0, immediate0: 0 },
    { opcode: textShaperAbi.policy.opcodes.storeU32, operand0: 0, operand1: 0, immediate0: buffer },
  ],
  f32InputCount: 0,
  u32InputCount: 0,
};
const buffers = [{ id: buffer, scalar: 'u32' as const, vectorWidth: 1 }];
const semanticCapabilities = {
  capabilities: ['storage-buffers', 'ordered-direct'] as const,
  maxBufferBytes: 4096,
  updateAlignment: 4,
  coalesceGapBytes: 0,
  rangeCallPenaltyBytes: 0,
  maxBuffersPerDraw: 1,
  maxResourcesPerDraw: 1,
  maxIndirectDraws: 0,
  fragmentationBudget: 1,
  wholeBufferThresholdBasisPoints: 10_000,
} satisfies PolicyCapabilitySet;
void semanticCapabilities;

createProgram(technique, program, body, buffers, 'direct', 'ordered');
// @ts-expect-error Policy buffers name their scalar type; callers never author its ABI ordinal.
createProgram(technique, program, body, [{ id: buffer, scalar: 2, vectorWidth: 1 }], 'direct', 'ordered');
// @ts-expect-error Capability profiles name features; callers never author a raw flag mask.
const rawCapabilities: PolicyCapabilitySet = { ...semanticCapabilities, flags: 1 };
void rawCapabilities;

// @ts-expect-error Authored wire identities must come from the semantic helpers.
createProgram(1, program, body, buffers, 'direct', 'ordered');
// @ts-expect-error Program and technique identities are distinct even though both serialize as u32.
createProgram(program, technique, body, buffers, 'direct', 'ordered');
// @ts-expect-error Resource identities cannot stand in for technique identities.
createProgram(resource, program, body, buffers, 'direct', 'ordered');
// @ts-expect-error Policy buffer IDs cannot stand in for planner handles.
const planner: PlannerHandle = buffer;
void planner;

const paragraph = id.paragraph('vendor.example/body');
const style = id.style('vendor.example/body/root');
const flowThread = id.flowThread('vendor.example/article');
const region = id.region('vendor.example/page/1');
const frame: PlannerFrameUpdate = {
  plannerId: id.planner('vendor.example/scene'),
  policyHandle: id.policy('vendor.example/render'),
  expectedEngineRevision: 0,
  consumedPlanRevision: 0,
  acknowledgedPublicationGeneration: 0,
  limits: {
    maxParagraphs: 1,
    maxClusters: 16,
    maxLines: 4,
    maxRegions: 1,
    maxExclusions: 1,
    maxInlineObjects: 1,
    maxSlotsPerBand: 1,
    maxOutputBytes: 4096,
  },
  paragraphMutations: [{ opcode: 'upsert', paragraphId: paragraph, order: 0 }],
  styleMutations: [
    {
      opcode: 'upsert',
      paragraphId: paragraph,
      styleId: style,
      cascadeOrder: 0,
      start: 0,
      end: 0,
      root: true,
      value: { fontStackHandle: id.fontStack('vendor.example/body') },
    },
  ],
  constraints: [
    {
      paragraphId: paragraph,
      flowThreadId: flowThread,
      geometryRevision: 1,
      width: 100,
      height: 100,
      viewportBlockStart: 0,
      viewportBlockEnd: 100,
      resumeBlockOffset: 0,
      maxLines: 4,
      regionStart: 0,
      resumeCluster: 0,
      regionCount: 1,
      resumeRegion: 0,
      widthMode: 'exact',
      heightMode: 'exact',
      wrap: 'word',
      align: 'start',
      overflow: 'visible',
      blockAlign: 'start',
    },
  ],
  regions: [
    {
      id: region,
      geometryRevision: 1,
      transformIndex: 0,
      shape: 'rectangle',
      exclusionStart: 0,
      exclusionCount: 0,
      writingMode: 'horizontal-tb',
      textOrientation: 'mixed',
      inlineStart: 0,
      blockStart: 0,
      inlineEnd: 100,
      blockEnd: 100,
      clipInlineStart: 0,
      clipBlockStart: 0,
      clipInlineEnd: 100,
      clipBlockEnd: 100,
    },
  ],
};
compilePlannerFrameUpdate(frame);

declare const descriptor: PolicyDescriptor;
declare const capabilities: PolicyCapabilitySet;
compilePlannerFrameUpdate({
  ...frame,
  capabilitySet: selectPolicyCapabilitySet(frame.policyHandle, descriptor, capabilities),
});

// @ts-expect-error Caller-owned paragraph IDs must come from id.paragraph(name).
const rawParagraph: ParagraphId = 1;
void rawParagraph;
// @ts-expect-error Identity domains cannot be interchanged.
const wrongParagraph: ParagraphId = style;
void wrongParagraph;
// @ts-expect-error Domainless IDs cannot enter a paragraph protocol field.
const genericParagraph: ParagraphId = generic;
void genericParagraph;
// @ts-expect-error The old kind-string API is gone; domains are methods.
const oldIdArguments: Parameters<typeof id> = ['paragraph', 'vendor.example/body'];
void oldIdArguments;
// @ts-expect-error ID names are strings, never caller-authored numbers.
id.buffer(20);
// @ts-expect-error Frame planner IDs require the planner brand.
compilePlannerFrameUpdate({ ...frame, plannerId: 1 });
// @ts-expect-error Frame paragraph IDs require the paragraph brand.
compilePlannerFrameUpdate({ ...frame, paragraphMutations: [{ opcode: 'remove', paragraphId: 1 }] });
// @ts-expect-error Capability profiles are selected from their descriptor, never by authored ordinal.
compilePlannerFrameUpdate({ ...frame, capabilitySet: 1 });
