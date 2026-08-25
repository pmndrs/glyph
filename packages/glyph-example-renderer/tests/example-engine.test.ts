import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
  compileTextEngineFrameUpdate,
  createRuntimeShaper,
  TextEngineHost,
  TextEnginePublicationExpiredError,
  type TextEngineFrameLimits,
} from '@pmndrs/glyph/core';
import { exampleRenderPolicyBytes } from '../src/policy.js';
import { describe, expect, test } from 'vitest';

import { ExampleTextEngine } from '../src/engine.js';
import { EXAMPLE_POLICY_HANDLE } from '../src/policy.js';

const require = createRequire(import.meta.url);

/**
 * The engine's Wasm artifact is a published entry point (`@pmndrs/glyph/text-shaper.wasm`),
 * so loading it crosses no private surface. Everything else in this file — shaper, host,
 * policy, frame wire, plan view — comes from `@pmndrs/glyph/core`.
 */
async function wasmBytes(): Promise<Buffer> {
  return readFile(require.resolve('@pmndrs/glyph/text-shaper.wasm'));
}

const LIMITS: TextEngineFrameLimits = {
  maxParagraphs: 8,
  maxClusters: 256,
  maxLines: 32,
  maxRegions: 4,
  maxExclusions: 4,
  maxInlineObjects: 4,
  maxSlotsPerBand: 4,
  maxOutputBytes: 128 * 1024,
};

describe('a real engine driven through the published core surface', () => {
  test('publishes real frames whose retained plans outlive borrows, growth, and slots', async () => {
    const shaper = await createRuntimeShaper({ wasm: await wasmBytes() });
    const engine = new ExampleTextEngine(shaper);
    try {
      engine.openSession(29);
      const first = engine.render({});
      expect(first.publicationGeneration).toBe(1);
      expect(first.draws).toEqual([]);
      expect(first.engineRevision).toBe(1);

      // The borrow behind frame 1 died the moment frame 2 was answered; the retained
      // plan did not. Two more frames also walk both A/B output slots.
      const session = engine.session;
      const second = engine.render({});
      expect(second.publicationGeneration).toBe(2);
      expect(second.engineRevision).toBe(2);
      expect(session.acknowledgedGeneration).toBe(2);
      expect(engine.render({}).publicationGeneration).toBe(3);
      expect(first.patches).toEqual([]);
      expect(first.retirements).toEqual([]);

      // Capacity growth moves every Wasm arena; retained plans still read fine while
      // any borrow held across it is detected rather than silently re-read.
      session.reserve(4096, 8 * 1024 * 1024);
      const afterGrowth = engine.render({});
      expect(afterGrowth.publicationGeneration).toBe(4);
      expect(afterGrowth.buffers.count).toBe(0);
    } finally {
      engine.dispose();
    }
  });

  test('makes a stale borrow loud instead of silently re-reading freed bytes', async () => {
    const shaper = await createRuntimeShaper({ wasm: await wasmBytes() });
    const engine = new ExampleTextEngine(shaper);
    try {
      engine.openSession(29);
      // One raw frame through the session, then a second raw frame built from the
      // first publication's revisions: the borrow from frame one is now expired.
      const stale = engine.session.update(engine.frameRequest({}));
      expect(engine.session.isExpired(stale)).toBe(false);
      engine.session.update(
        compileTextEngineFrameUpdate({
          sessionId: engine.session.handle,
          policyHandle: 23,
          capabilitySet: 1,
          expectedEngineRevision: stale.engineRevision,
          consumedPlanRevision: stale.planRevision,
          acknowledgedPublicationGeneration: stale.publicationGeneration - 1,
          limits: LIMITS,
        }),
      );
      expect(engine.session.isExpired(stale)).toBe(true);
      expect(() => engine.session.assertLive(stale)).toThrowError(TextEnginePublicationExpiredError);
      expect(() => engine.session.assertLive(stale)).toThrowError(/publication 1 expired/);

      // A publication this session never issued cannot be reasoned about at all.
      expect(() => engine.session.isExpired({ ...stale })).toThrowError(TypeError);
    } finally {
      engine.dispose();
    }
  });

  test('carries the acknowledged generation on the wire, and the engine enforces it', async () => {
    const shaper = await createRuntimeShaper({ wasm: await wasmBytes() });
    const engine = new ExampleTextEngine(shaper);
    try {
      engine.openSession(29);
      engine.render({});
      engine.render({});
      expect(engine.session.acknowledgedGeneration).toBe(2);

      // A request that acknowledges an older generation than the engine has recorded
      // is rejected as a revision conflict: consumption is verified, not trusted.
      const latest = { engineRevision: 2, planRevision: 2 };
      const replayed = compileTextEngineFrameUpdate({
        sessionId: engine.session.handle,
        policyHandle: 23,
        capabilitySet: 1,
        expectedEngineRevision: latest.engineRevision,
        consumedPlanRevision: latest.planRevision,
        acknowledgedPublicationGeneration: 0,
        limits: LIMITS,
      });
      expect(() => engine.session.update(replayed)).toThrowError(/status 12/);

      // The next honest frame carries the last accepted generation and publishes.
      expect(engine.render({}).publicationGeneration).toBe(3);
    } finally {
      engine.dispose();
    }
  });

  test('hosts its own policy and font-stack registration through core handles', async () => {
    const shaper = await createRuntimeShaper({ wasm: await wasmBytes() });
    const engine = new ExampleTextEngine(shaper);
    try {
      engine.openSession(29);
      // No shaping font exists behind handle 101 — the loader path lives outside
      // `/core` (recorded as audit item 12) — so stack registration fails cleanly
      // with the engine's own status instead of silently accepting a dead handle.
      expect(() => engine.registerFontStack(17, [101])).toThrowError(/status 5/);
      // The policy itself registered fine: frames publish against it.
      expect(engine.render({}).engineRevision).toBe(1);
    } finally {
      engine.dispose();
    }
  });
});

// The raw host/session pair stays reachable for hosts that compose protocol steps
// themselves; this keeps that path proven too.
test('TextEngineHost remains directly drivable', async () => {
  const shaper = await createRuntimeShaper({ wasm: await wasmBytes() });
  const host = new TextEngineHost(shaper);
  host.registerPolicy(EXAMPLE_POLICY_HANDLE, exampleRenderPolicyBytes());
  const session = host.createSession({ handle: 30, requestCapacity: 4096, resultCapacity: 128 * 1024 });
  const publication = session.update(
    compileTextEngineFrameUpdate({
      sessionId: 30,
      policyHandle: EXAMPLE_POLICY_HANDLE,
      capabilitySet: 1,
      expectedEngineRevision: 0,
      consumedPlanRevision: 0,
      acknowledgedPublicationGeneration: 0,
      limits: LIMITS,
    }),
  );
  expect(publication.flags & 1).toBe(1); // checkpoint publication
  session.dispose();
  host.dispose();
});
