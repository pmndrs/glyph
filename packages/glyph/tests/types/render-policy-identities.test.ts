import {
  compileTextEngineFrameUpdate,
  createProgram,
  id,
  programId,
  resourceId,
  selectPolicyCapabilitySet,
  techniqueId,
  textShaperAbi,
  type ParagraphId,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  type TextEngineFrameUpdate,
} from '../../dist/core.js';
import { defineRasterResourceId } from '../../dist/index.js';

const technique = techniqueId('vendor.example');
const program = programId('vendor.example', 'renderer');
const resource = resourceId(defineRasterResourceId('vendor.example/resource'));
const buffer = id('buffer', 'vendor.example/value');
const body = {
  inputs: [],
  operations: [
    { opcode: textShaperAbi.policy.opcodes.constantU32, target: 0, immediate0: 0 },
    { opcode: textShaperAbi.policy.opcodes.storeU32, operand0: 0, operand1: 0, immediate0: buffer },
  ],
  f32InputCount: 0,
  u32InputCount: 0,
};
const buffers = [{ id: buffer, scalar: textShaperAbi.policy.scalarTypes.u32, vectorWidth: 1 }];

createProgram(technique, program, body, buffers, 'direct', 'ordered');

// @ts-expect-error Authored wire identities must come from the semantic helpers.
createProgram(1, program, body, buffers, 'direct', 'ordered');
// @ts-expect-error Program and technique identities are distinct even though both serialize as u32.
createProgram(program, technique, body, buffers, 'direct', 'ordered');
// @ts-expect-error Resource identities cannot stand in for technique identities.
createProgram(resource, program, body, buffers, 'direct', 'ordered');
// @ts-expect-error Policy buffer IDs cannot stand in for session handles.
const session: import('../../dist/core.js').TextEngineSessionHandle = buffer;
void session;

const paragraph = id('paragraph', 'vendor.example/body');
const style = id('style', 'vendor.example/body/root');
const flowThread = id('flow-thread', 'vendor.example/article');
const region = id('region', 'vendor.example/page/1');
const frame: TextEngineFrameUpdate = {
  sessionId: id('session', 'vendor.example/scene'),
  policyHandle: id('policy', 'vendor.example/render'),
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
      value: { fontStackHandle: id('font-stack', 'vendor.example/body') },
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
compileTextEngineFrameUpdate(frame);

declare const descriptor: PolicyDescriptor;
declare const capabilities: PolicyCapabilitySet;
compileTextEngineFrameUpdate({ ...frame, capabilitySet: selectPolicyCapabilitySet(descriptor, capabilities) });

// @ts-expect-error Caller-owned paragraph IDs must come from id('paragraph', name).
const rawParagraph: ParagraphId = 1;
void rawParagraph;
// @ts-expect-error Identity domains cannot be interchanged.
const wrongParagraph: ParagraphId = style;
void wrongParagraph;
// @ts-expect-error Frame session IDs require the session brand.
compileTextEngineFrameUpdate({ ...frame, sessionId: 1 });
// @ts-expect-error Frame paragraph IDs require the paragraph brand.
compileTextEngineFrameUpdate({ ...frame, paragraphMutations: [{ opcode: 'remove', paragraphId: 1 }] });
// @ts-expect-error Capability profiles are selected from their descriptor, never by authored ordinal.
compileTextEngineFrameUpdate({ ...frame, capabilitySet: 1 });
