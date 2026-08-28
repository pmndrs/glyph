import {
  assertOwnedTextEnginePublication,
  readTextEngineBuffer,
  readTextEnginePatch,
  readTextEngineResource,
  readTextEngineRetirement,
  TextEngineRenderPlanView,
  type AsyncPlanCandidate,
  type OwnedTextEnginePublication,
  type PlanCandidate,
  type TextEnginePublication,
  type TextEngineRenderPlanReader,
} from '@pmndrs/glyph/core';

import { decodeDraw, decodePrimitive, type ExampleDrawList } from './draw-list.js';
import type { ExampleTableSnapshot } from './snapshot.js';

/**
 * Reads one owned publication into the host's draw-list structures.
 *
 * The parameter demands `OwnedTextEnginePublication`, not a plain publication: a
 * draw list is built to be held across frames, and a borrowed publication expires at
 * the session's next call. The brand makes passing a live-but-doomed borrow a compile
 * error instead of a latent read of freed memory.
 */
export function readDrawList(
  publication: OwnedTextEnginePublication,
  view: TextEngineRenderPlanView = new TextEngineRenderPlanView(),
): ExampleDrawList {
  assertOwnedTextEnginePublication(publication);
  return readPublication(publication, view);
}

/** @internal Pure plan decoding seam used by fixture tests; public callers use `readDrawList`. */
export function readPublication(
  publication: TextEnginePublication,
  view: TextEngineRenderPlanView = new TextEngineRenderPlanView(),
): ExampleDrawList {
  view.bind(publication);
  return readPlan(view, publication, false);
}

/** Decode a target candidate and own only the fields the returned list retains. */
export function readCandidate(candidate: PlanCandidate | AsyncPlanCandidate): ExampleDrawList {
  return readPlan(candidate.plan, candidate, candidate.plan.delivery === 'borrowed');
}

function readPlan(
  view: TextEngineRenderPlanReader,
  publication: Readonly<{ engineRevision: number; planRevision: number; publicationGeneration: number }>,
  copyRetainedBytes: boolean,
): ExampleDrawList {
  const draws = view.table('draws');
  const decoded: ReturnType<typeof decodeDraw>[] = [];
  for (let index = 0; index < draws.count; index += 1) decoded.push(decodeDraw(view, view.record(draws, index)));
  const resources = view.table('resources');
  const resourceRecords: ReturnType<typeof readTextEngineResource>[] = [];
  for (let index = 0; index < resources.count; index += 1) {
    resourceRecords.push(readTextEngineResource(view, resources, index));
  }
  const buffers = view.table('buffers');
  const bufferRecords: ReturnType<typeof readTextEngineBuffer>[] = [];
  for (let index = 0; index < buffers.count; index += 1) {
    bufferRecords.push(readTextEngineBuffer(view, buffers, index));
  }
  const primitives = view.table('primitives');
  const primitiveRecords: ReturnType<typeof decodePrimitive>[] = [];
  for (let index = 0; index < primitives.count; index += 1) {
    primitiveRecords.push(decodePrimitive(view, view.record(primitives, index)));
  }
  const patches = view.table('patches');
  const patchRecords: ReturnType<typeof readTextEnginePatch>[] = [];
  for (let index = 0; index < patches.count; index += 1) {
    const patch = readTextEnginePatch(view, patches, index);
    patchRecords.push(copyRetainedBytes ? { ...patch, payload: patch.payload?.slice() } : patch);
  }
  const retirements = view.table('retirements');
  const retirementRecords: ReturnType<typeof readTextEngineRetirement>[] = [];
  for (let index = 0; index < retirements.count; index += 1) {
    retirementRecords.push(readTextEngineRetirement(view, retirements, index));
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
  view: TextEngineRenderPlanReader,
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
