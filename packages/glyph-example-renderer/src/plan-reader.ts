import {
  readRenderPlanBuffer,
  readRenderPlanDraw,
  readRenderPlanPatch,
  readRenderPlanPrimitive,
  readRenderPlanResource,
  readRenderPlanRetirement,
  type AsyncPlanCandidate,
  type PlanCandidate,
  type RenderPlanReader,
} from '@pmndrs/glyph/core';

import type { ExampleDrawList } from './draw-list.js';
import type { ExampleTableSnapshot } from './snapshot.js';

/** Decode a target candidate and own only the fields the returned list retains. */
export function readCandidate(candidate: PlanCandidate | AsyncPlanCandidate): ExampleDrawList {
  return readPlan(candidate.plan, candidate, candidate.plan.delivery === 'borrowed');
}

function readPlan(
  view: RenderPlanReader,
  publication: Readonly<{ engineRevision: number; planRevision: number; publicationGeneration: number }>,
  copyRetainedBytes: boolean,
): ExampleDrawList {
  const draws = view.table('draws');
  const decoded: ReturnType<typeof readRenderPlanDraw>[] = [];
  for (let index = 0; index < draws.count; index += 1) decoded.push(readRenderPlanDraw(view, draws, index));
  const resources = view.table('resources');
  const resourceRecords: ReturnType<typeof readRenderPlanResource>[] = [];
  for (let index = 0; index < resources.count; index += 1) {
    resourceRecords.push(readRenderPlanResource(view, resources, index));
  }
  const buffers = view.table('buffers');
  const bufferRecords: ReturnType<typeof readRenderPlanBuffer>[] = [];
  for (let index = 0; index < buffers.count; index += 1) {
    bufferRecords.push(readRenderPlanBuffer(view, buffers, index));
  }
  const primitives = view.table('primitives');
  const primitiveRecords: ReturnType<typeof readRenderPlanPrimitive>[] = [];
  for (let index = 0; index < primitives.count; index += 1) {
    primitiveRecords.push(readRenderPlanPrimitive(view, primitives, index));
  }
  const patches = view.table('patches');
  const patchRecords: ReturnType<typeof readRenderPlanPatch>[] = [];
  for (let index = 0; index < patches.count; index += 1) {
    const patch = readRenderPlanPatch(view, patches, index);
    patchRecords.push(
      copyRetainedBytes && patch.kind === 'write' ? { ...patch, payload: patch.payload.slice() } : patch,
    );
  }
  const retirements = view.table('retirements');
  const retirementRecords: ReturnType<typeof readRenderPlanRetirement>[] = [];
  for (let index = 0; index < retirements.count; index += 1) {
    retirementRecords.push(readRenderPlanRetirement(view, retirements, index));
  }
  return {
    engineRevision: publication.engineRevision,
    planRevision: publication.planRevision,
    publicationGeneration: publication.publicationGeneration,
    draws: decoded,
    resourceRecords,
    bufferRecords,
    primitiveRecords,
    patches: patchRecords,
    retirements: retirementRecords,
    resources: snapshot(view, 'resources', copyRetainedBytes),
    buffers: snapshot(view, 'buffers', copyRetainedBytes),
    primitives: snapshot(view, 'primitives', copyRetainedBytes),
    diagnostics: snapshot(view, 'diagnostics', copyRetainedBytes),
  };
}

/** Own borrowed bytes that escape target acceptance; preserve existing ownership otherwise. */
function snapshot(
  view: RenderPlanReader,
  name: 'resources' | 'buffers' | 'primitives' | 'diagnostics',
  copy: boolean,
): ExampleTableSnapshot {
  const table = view.table(name);
  const byteLength = table.count * table.stride;
  const records = byteLength === 0 ? new Uint8Array(0) : view.bytes(table.offset, byteLength);
  return {
    count: table.count,
    stride: table.stride,
    records: copy ? records.slice() : records,
  };
}
