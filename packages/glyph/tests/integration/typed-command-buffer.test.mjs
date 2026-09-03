import assert from 'node:assert/strict';
import test from 'node:test';

import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';
import { TypedCommandBufferMapper } from '../../dist/internal/typed-command-buffer.js';

const drawLayout = textShaperAbi.layouts.engineDraw;
const primitiveLayout = textShaperAbi.layouts.enginePrimitive;

test('typed command buffers project the trusted group hierarchy lazily', () => {
  const mapper = new TypedCommandBufferMapper();
  const firstPlan = planFixture();
  const first = mapper.source(candidate(firstPlan.plan), new AbortController().signal);

  assert.equal(Object.isFrozen(first), true, 'package-created borrowed command buffers are immutable');
  assert.equal(firstPlan.recordReads(), 0, 'source construction must not visit a command record');
  assert.equal(first.group.kind, 'replace');
  assert.equal(first.group.value.children.length, 2);
  assert.equal(firstPlan.recordReads(), 0, 'reading sequence metadata must stay record-free');

  const batch = first.group.value.children.at(0);
  assert.equal(firstPlan.recordReads(), 1, 'one child lookup must visit only one draw record');
  assert.equal(batch.kind, 'batch');
  const firstBatchIdentity = batch.identity;
  assert.equal(mapper.batchDescriptor(first, firstBatchIdentity).offset, firstPlan.drawOffset(0));
  assert.equal(mapper.drawBindingDescriptor(first, firstBatchIdentity).buffers.length, 0);
  assert.equal(batch.instances.length, 2);
  assert.equal(firstPlan.recordReads(), 1, 'opening a batch range must not visit its instance records');

  const secondSpan = batch.instances.at(1);
  assert.equal(firstPlan.recordReads(), 2, 'one span lookup must visit only that primitive record');
  assert.deepEqual(
    {
      kind: secondSpan.kind,
      recordIndex: secondSpan.recordIndex,
      recordCount: secondSpan.recordCount,
      logicalOrder: secondSpan.logicalOrder,
    },
    { kind: 'decoration', recordIndex: 8, recordCount: 2, logicalOrder: 4 },
  );
  const firstSpanIdentity = secondSpan.identity;
  assert.equal(mapper.instanceSpanDescriptor(first, firstSpanIdentity).offset, firstPlan.primitiveOffset(1));

  const root = first.group.value.children.at(1);
  assert.equal(firstPlan.recordReads(), 3, 'the second child is projected only when requested');
  assert.equal(root.kind, 'instance');
  const firstRootIdentity = root.identity;
  assert.equal(mapper.instanceDescriptor(first, firstRootIdentity).offset, firstPlan.drawOffset(1));
  assert.equal(mapper.drawBindingDescriptor(first, firstRootIdentity).resources.length, 0);
  assert.equal(mapper.transformBinding(root.transform), firstPlan.transformBinding);

  mapper.settle(first, true);
  assert.throws(
    () => mapper.batchDescriptor(first, firstBatchIdentity),
    /does not belong to this mapper/u,
    'settlement expires source-local plan descriptors',
  );

  const acceptedPlan = planFixture();
  const accepted = mapper.source(
    candidate(acceptedPlan.plan, acceptedPlan.transformBinding),
    new AbortController().signal,
  );
  const acceptedBatch = accepted.group.value.children.at(0);
  const acceptedSpan = acceptedBatch.instances.at(1);
  const acceptedRoot = accepted.group.value.children.at(1);
  assert.equal(acceptedBatch.identity, firstBatchIdentity, 'accepted batch identities remain stable');
  assert.equal(acceptedSpan.identity, firstSpanIdentity, 'accepted span identities remain stable');
  assert.equal(acceptedRoot.identity, firstRootIdentity, 'accepted root identities remain stable');
  mapper.settle(accepted, true);

  const rejectedPlan = planFixture({ batchId: 99 });
  const rejected = mapper.source(
    candidate(rejectedPlan.plan, rejectedPlan.transformBinding),
    new AbortController().signal,
  );
  const rejectedIdentity = rejected.group.value.children.at(0).identity;
  mapper.settle(rejected, false);

  const retriedPlan = planFixture({ batchId: 99 });
  const retried = mapper.source(
    candidate(retriedPlan.plan, retriedPlan.transformBinding),
    new AbortController().signal,
  );
  assert.notEqual(
    retried.group.value.children.at(0).identity,
    rejectedIdentity,
    'rejected candidate-only identities must not seed retained identity state',
  );
  mapper.settle(retried, false);
  mapper.dispose();
});

test('one transform binding resolves every root instance identity that shares it', () => {
  const mapper = new TypedCommandBufferMapper();
  const binding = Object.freeze({});
  for (const instanceId of [71, 72]) {
    const fixture = planFixture({ rootTransformId: instanceId });
    const source = mapper.source(candidate(fixture.plan, binding, [71, 72]), new AbortController().signal);
    const root = source.group.value.children.at(1);
    assert.equal(mapper.transformBinding(root.transform), binding);
    assert.equal(mapper.transformIndex(root.transform), 19);
    mapper.settle(source, true);
  }
  mapper.dispose();
});

function candidate(plan, transformBinding = plan.transformBinding, instanceIds) {
  return {
    origin: Object.freeze({}),
    plan,
    engineRevision: 1,
    revision: 1,
    publicationGeneration: 1,
    checkpoint: true,
    transforms: Object.freeze([{ transformIndex: 19, binding: transformBinding, instanceIds }]),
    acquirePayload() {
      throw new Error('fixture has no portable payloads');
    },
    resolveMaterial() {
      throw new Error('fixture has no material bindings');
    },
    resolveResource() {
      throw new Error('fixture has no resource bindings');
    },
  };
}

function planFixture({ batchId = 7, rootTransformId = 19 } = {}) {
  const drawOffset = 64;
  const primitiveOffset = drawOffset + drawLayout.size * 2;
  const byteLength = primitiveOffset + primitiveLayout.size * 3;
  const bytes = new Uint8Array(byteLength);
  const data = new DataView(bytes.buffer);
  const transformBinding = Object.freeze({});
  let reads = 0;

  writeDraw(data, drawOffset, {
    id: batchId,
    transformId: 0,
    primitiveStart: 0,
    primitiveCount: 2,
  });
  writeDraw(data, drawOffset + drawLayout.size, {
    id: 8,
    transformId: rootTransformId,
    primitiveStart: 2,
    primitiveCount: 1,
  });
  writePrimitive(data, primitiveOffset, {
    id: 31,
    kind: textShaperAbi.engine.primitiveKinds.glyph,
    recordIndex: 3,
    recordCount: 5,
    logicalOrder: 1,
  });
  writePrimitive(data, primitiveOffset + primitiveLayout.size, {
    id: 32,
    kind: textShaperAbi.engine.primitiveKinds.decoration,
    recordIndex: 8,
    recordCount: 2,
    logicalOrder: 4,
  });
  writePrimitive(data, primitiveOffset + primitiveLayout.size * 2, {
    id: 33,
    kind: textShaperAbi.engine.primitiveKinds.inlineObject,
    recordIndex: 10,
    recordCount: 1,
    logicalOrder: 6,
  });

  const tables = Object.freeze({
    resources: Object.freeze({ offset: 0, count: 0, stride: textShaperAbi.layouts.engineResource.size }),
    buffers: Object.freeze({ offset: 0, count: 0, stride: textShaperAbi.layouts.engineBuffer.size }),
    patches: Object.freeze({ offset: 0, count: 0, stride: textShaperAbi.layouts.enginePatch.size }),
    primitives: Object.freeze({ offset: primitiveOffset, count: 3, stride: primitiveLayout.size }),
    draws: Object.freeze({ offset: drawOffset, count: 2, stride: drawLayout.size }),
    retirements: Object.freeze({ offset: 0, count: 0, stride: textShaperAbi.layouts.engineRetirement.size }),
  });
  const plan = {
    transformBinding,
    table(name) {
      return tables[name];
    },
    record(table, index) {
      reads += 1;
      return table.offset + index * table.stride;
    },
    u8(offset) {
      return data.getUint8(offset);
    },
    u16(offset) {
      return data.getUint16(offset, true);
    },
    u32(offset) {
      return data.getUint32(offset, true);
    },
    f32(offset) {
      return data.getFloat32(offset, true);
    },
    bytes(offset, length) {
      return bytes.subarray(offset, offset + length);
    },
  };

  return {
    plan,
    transformBinding,
    recordReads: () => reads,
    drawOffset: (index) => drawOffset + index * drawLayout.size,
    primitiveOffset: (index) => primitiveOffset + index * primitiveLayout.size,
  };
}

function writeDraw(data, offset, values) {
  data.setUint32(offset + drawLayout.id, values.id, true);
  data.setUint32(offset + drawLayout.transformId, values.transformId, true);
  data.setUint32(offset + drawLayout.primitiveStart, values.primitiveStart, true);
  data.setUint32(offset + drawLayout.primitiveCount, values.primitiveCount, true);
}

function writePrimitive(data, offset, values) {
  data.setUint32(offset + primitiveLayout.id, values.id, true);
  data.setUint16(offset + primitiveLayout.kind, values.kind, true);
  data.setUint32(offset + primitiveLayout.recordIndex, values.recordIndex, true);
  data.setUint16(offset + primitiveLayout.recordCount, values.recordCount, true);
  data.setUint32(offset + primitiveLayout.logicalOrder, values.logicalOrder, true);
}
