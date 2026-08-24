import {
  readTextEnginePatch,
  readTextEngineResource,
  readTextEngineRetirement,
  retainedPublicationBrand,
  TextEngineRenderPlanView,
  type RetainedTextEnginePublication,
} from '@pmndrs/glyph/core';

import { decodeDraw, decodePrimitive, type ExampleDrawList } from './draw-list.js';
import type { ExampleTableSnapshot } from './snapshot.js';

/**
 * Reads one retained publication into the host's draw-list structures.
 *
 * The parameter demands `RetainedTextEnginePublication`, not a plain publication: a
 * draw list is built to be held across frames, and a borrowed publication expires at
 * the session's next call. The brand makes passing a live-but-doomed borrow a compile
 * error instead of a latent read of freed memory.
 */
export function readDrawList(
  publication: RetainedTextEnginePublication,
  view: TextEngineRenderPlanView = new TextEngineRenderPlanView(),
): ExampleDrawList {
  // The brand is checked again at runtime because plain JavaScript callers bypass the types.
  if (!(retainedPublicationBrand in publication)) {
    throw new TypeError('readDrawList needs a retained publication: borrow expires, retain first');
  }
  view.bind(publication);
  const draws = view.table('draws');
  const decoded: ReturnType<typeof decodeDraw>[] = [];
  for (let index = 0; index < draws.count; index += 1) decoded.push(decodeDraw(view, view.record(draws, index)));
  const resources = view.table('resources');
  const resourceRecords: ReturnType<typeof readTextEngineResource>[] = [];
  for (let index = 0; index < resources.count; index += 1) {
    resourceRecords.push(readTextEngineResource(view, resources, index));
  }
  const primitives = view.table('primitives');
  const primitiveRecords: ReturnType<typeof decodePrimitive>[] = [];
  for (let index = 0; index < primitives.count; index += 1) {
    primitiveRecords.push(decodePrimitive(view, view.record(primitives, index)));
  }
  const patches = view.table('patches');
  const patchRecords: ReturnType<typeof readTextEnginePatch>[] = [];
  for (let index = 0; index < patches.count; index += 1) patchRecords.push(readTextEnginePatch(view, patches, index));
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
    primitiveRecords,
    patches: patchRecords,
    retirements: retirementRecords,
    resources: snapshot(view, 'resources'),
    buffers: snapshot(view, 'buffers'),
    primitives: snapshot(view, 'primitives'),
    diagnostics: snapshot(view, 'diagnostics'),
  };
}

/** A window into the retained bytes — no second copy. */
function snapshot(
  view: TextEngineRenderPlanView,
  name: 'resources' | 'buffers' | 'primitives' | 'diagnostics',
): ExampleTableSnapshot {
  const table = view.table(name);
  const byteLength = table.count * table.stride;
  return {
    count: table.count,
    stride: table.stride,
    records: byteLength === 0 ? new Uint8Array(0) : view.bytes(table.offset, byteLength),
  };
}
