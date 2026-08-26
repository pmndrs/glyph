/**
 * The ownership model of `@pmndrs/glyph/core`, asserted through the published surface.
 *
 * `/three` is the only integration we ship, so every relationship below was previously
 * only true by convention there. These tests pin the relationships themselves — what a
 * runtime, a host, a policy, and a session may be to one another — so a second renderer
 * (or a second copy of the first) cannot silently land in a shape the engine rejects.
 *
 * The cardinalities under test:
 *
 *   TextRuntime  1:1  RuntimeShaper    one Wasm instance, one shaping-font table
 *   RuntimeShaper 1:N TextEngineHost   permitted by construction; see the collision tests
 *   TextEngineHost 1:N Policy          how one host serves two renderers
 *   TextEngineHost 1:N TextEngineSession
 *   TextEngineSession N:1 Policy       bound on first publish, for the session's life
 *
 * A canvas appears nowhere: nothing in `/core` models one, which is itself asserted here.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import test from 'node:test';

import {
  compileTextEngineFrameUpdate,
  createRuntimeShaper,
  id,
  TextEngineHost,
  TextEngineStatusError,
  textRuntimeShaper,
} from '../../dist/core.js';
import { createTextRuntime } from '../../dist/index.js';
import { threeRenderPolicyBytes } from '../../dist/three/render-policy.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

const LIMITS = {
  maxParagraphs: 8,
  maxClusters: 64,
  maxLines: 16,
  maxRegions: 4,
  maxExclusions: 4,
  maxInlineObjects: 4,
  maxSlotsPerBand: 4,
  maxOutputBytes: 128 * 1024,
};

function frame(session, policyHandle, latest = { engineRevision: 0, planRevision: 0 }) {
  return compileTextEngineFrameUpdate({
    sessionId: session.handle,
    policyHandle,
    expectedEngineRevision: latest.engineRevision,
    consumedPlanRevision: latest.planRevision,
    acknowledgedPublicationGeneration: session.acknowledgedGeneration,
    limits: LIMITS,
  });
}

function openSession(host, name, policyHandle) {
  const session = host.createSession({
    handle: host.id('session', name),
    requestCapacity: 4096,
    resultCapacity: 128 * 1024,
  });
  return {
    session,
    publish(latest) {
      return session.update(frame(session, policyHandle, latest));
    },
  };
}

async function shaper() {
  return createRuntimeShaper({ wasm: await readFile(wasmUrl) });
}

function engineStatus(call) {
  try {
    call();
  } catch (error) {
    if (error instanceof TextEngineStatusError) return error.status;
    throw error;
  }
  return undefined;
}

test('a host is bound to one shaper for life and cannot be re-pointed at another runtime', async () => {
  const first = await shaper();
  const second = await shaper();
  const host = new TextEngineHost(first);

  // The published surface offers registration, session creation, and disposal. Nothing
  // hands the host a different shaper, so "can a host swap runtimes" is answered by shape.
  const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(host)).filter((name) => name !== 'constructor');
  assert.deepEqual(
    surface.filter((name) => /shaper|runtime|attach|rebind/i.test(name)),
    [],
    'no published member re-points a host at another shaper',
  );

  host.dispose();
  assert.throws(
    () => host.createSession({ handle: host.id('session', 'ownership/after-dispose'), requestCapacity: 64, resultCapacity: 64 }),
    /disposed/,
    'disposal is terminal; a host is never reattached',
  );

  first.dispose();
  second.dispose();
});

test('disposing a host leaves its shaper usable, so host lifetime is shorter than runtime lifetime', async () => {
  const runtime = await createTextRuntime({ wasm: await readFile(wasmUrl) });
  const policyHandle = id('policy', 'ownership/host-lifetime');

  const first = new TextEngineHost(textRuntimeShaper(runtime));
  first.registerPolicy(policyHandle, threeRenderPolicyBytes());
  first.dispose();

  // A second host over the same runtime is a legal successor once the first has released
  // its registrations: the runtime outlives any one host built on it.
  const second = new TextEngineHost(textRuntimeShaper(runtime));
  second.registerPolicy(policyHandle, threeRenderPolicyBytes());
  const { publish } = openSession(second, 'ownership/host-lifetime/session', policyHandle);
  assert.equal(publish().planRevision, 1, 'the successor host drives the same runtime');
  second.dispose();

  runtime.dispose();
  assert.throws(() => textRuntimeShaper(runtime), /disposed/, 'the runtime owns the shaper, not the host');
});

test('one host serves two renderers through two policies, each session bound to its own', async () => {
  const instance = await shaper();
  const host = new TextEngineHost(instance);

  const rendererA = id('policy', 'ownership/renderer-a');
  const rendererB = id('policy', 'ownership/renderer-b');
  host.registerPolicy(rendererA, threeRenderPolicyBytes());
  // A second policy with a distinct program set: this is the supported way to drive two
  // renderers from one runtime, and the reason a second *host* is never needed for it.
  host.registerPolicy(rendererB, threeRenderPolicyBytes(undefined, 'direct'));

  const a = openSession(host, 'ownership/renderer-a/session', rendererA);
  const b = openSession(host, 'ownership/renderer-b/session', rendererB);

  const firstA = a.publish();
  const firstB = b.publish();
  assert.equal(firstA.policyHandle, rendererA);
  assert.equal(firstB.policyHandle, rendererB);

  // Per-session arenas: one session publishing never invalidates another's borrow.
  assert.equal(a.session.isExpired(firstA), false, "session B's publish must not expire session A's borrow");
  assert.equal(b.session.isExpired(firstB), false);

  host.dispose();
  instance.dispose();
});

test('a session binds to one policy on first publish and refuses to change it', async () => {
  const instance = await shaper();
  const host = new TextEngineHost(instance);
  const bound = id('policy', 'ownership/bound');
  const other = id('policy', 'ownership/other');
  host.registerPolicy(bound, threeRenderPolicyBytes());
  host.registerPolicy(other, threeRenderPolicyBytes(undefined, 'direct'));

  const { session } = openSession(host, 'ownership/bound/session', bound);
  const first = session.update(frame(session, bound));
  assert.equal(first.policyHandle, bound);

  assert.equal(
    engineStatus(() => session.update(frame(session, other, first))),
    textShaperAbi.status.invalidRequest,
    'a session may not be re-pointed at another policy',
  );

  // The refusal is not a broken state: the session keeps publishing under its own policy.
  const next = session.update(frame(session, bound, first));
  assert.equal(next.planRevision, first.planRevision + 1, 'a rejected frame leaves the session live');

  host.dispose();
  instance.dispose();
});

test('two hosts on two runtimes are fully independent, even deriving identical handles', async () => {
  const first = await shaper();
  const second = await shaper();
  const hostA = new TextEngineHost(first);
  const hostB = new TextEngineHost(second);

  // IDs are content-derived from (kind, name), so both hosts derive the same u32 here.
  // Across runtimes that is harmless: the namespaces belong to separate Wasm instances.
  const policyHandle = id('policy', 'ownership/shared-name');
  const sessionName = 'ownership/shared-name/session';
  hostA.registerPolicy(policyHandle, threeRenderPolicyBytes());
  hostB.registerPolicy(policyHandle, threeRenderPolicyBytes());
  assert.equal(hostA.id('session', sessionName), hostB.id('session', sessionName), 'same name derives the same id');

  const a = openSession(hostA, sessionName, policyHandle);
  const b = openSession(hostB, sessionName, policyHandle);
  assert.equal(a.session.handle, b.session.handle, 'identical handles in two runtimes');
  assert.equal(a.publish().planRevision, 1);
  assert.equal(b.publish().planRevision, 1);

  // One runtime's teardown must not disturb the other.
  hostA.dispose();
  first.dispose();
  const laterB = b.publish({ engineRevision: 1, planRevision: 1 });
  assert.equal(laterB.planRevision, 2, 'the surviving runtime is unaffected');

  hostB.dispose();
  second.dispose();
});

test('a second runtime starts empty: shaping fonts are per runtime, never shared', async () => {
  const first = await shaper();
  const second = await shaper();

  assert.equal(first.memoryReport().fontCount, 0);
  assert.equal(second.memoryReport().fontCount, 0);
  assert.notEqual(
    first.memoryReport().wasmMemoryBytes,
    0,
    'each runtime carries its own Wasm heap, so duplicating a runtime duplicates its fonts',
  );

  first.dispose();
  second.dispose();
});

test('two hosts on ONE runtime share the engine handle namespace', async (t) => {
  const instance = await shaper();
  const hostA = new TextEngineHost(instance);
  const hostB = new TextEngineHost(instance);

  // Nothing claims the shaper, so a second host is constructible. This is the shape a
  // second integration reaches for when it cannot obtain the first one's host.
  const policyHandle = id('policy', 'ownership/contended');
  hostA.registerPolicy(policyHandle, threeRenderPolicyBytes());

  await t.test('differing policy bytes at one handle are refused', () => {
    assert.equal(
      engineStatus(() => hostB.registerPolicy(policyHandle, threeRenderPolicyBytes(undefined, 'direct'))),
      textShaperAbi.status.policyConflict,
    );
  });

  await t.test('a contended session handle is refused', () => {
    const handle = hostA.id('session', 'ownership/contended/session');
    hostA.createSession({ handle, requestCapacity: 4096, resultCapacity: 128 * 1024 });
    assert.equal(
      engineStatus(() => hostB.createSession({ handle, requestCapacity: 4096, resultCapacity: 128 * 1024 })),
      textShaperAbi.status.sessionConflict,
    );
  });

  // CHARACTERIZATION, not a guarantee. This pins today's outcome for silent double
  // ownership so the behaviour cannot drift unnoticed. If a host ever claims its shaper
  // — one live host per RuntimeShaper — the second construction above throws instead and
  // this case is replaced by that assertion rather than updated.
  await t.test('identical policy bytes are accepted, leaving both hosts believing they own the handle', () => {
    // Registration is idempotent when byte-identical, so the second host is admitted
    // silently. The conflict then surfaces at teardown, in whichever host disposes last.
    hostB.registerPolicy(policyHandle, threeRenderPolicyBytes());
    hostA.dispose();
    assert.equal(
      engineStatus(() => hostB.dispose()),
      textShaperAbi.status.policyMissing,
      'the surviving host fails to release a policy the other already disposed',
    );
  });

  instance.dispose();
});

test('/core publishes no way to obtain the host already driving a runtime', async () => {
  // `textRuntimeShaper` hands out the ingredient two integrations would collide over,
  // while nothing hands out the host that would let them compose. Until that exists,
  // the test above is the reachable outcome for a second integration on one runtime.
  const core = await import('../../dist/core.js');
  const accessors = Object.keys(core).filter((name) => /host/i.test(name));
  assert.deepEqual(
    accessors.sort(),
    ['TextEngineHost'],
    '/core exports the host constructor and no accessor for an existing host',
  );
  assert.equal(typeof core.textRuntimeShaper, 'function', 'the shaper, by contrast, is reachable from a runtime');
});

test('nothing in the /core ownership model names a canvas, renderer, or device', async () => {
  const core = await import('../../dist/core.js');
  const named = Object.keys(core).filter((name) => /canvas|renderer|device|webgl|webgpu/i.test(name));
  assert.deepEqual(named, [], '/core is renderer-neutral: a canvas is not part of the ownership model');
});
