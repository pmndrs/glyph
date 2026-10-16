import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createElement } from 'react';
import * as THREE from 'three/webgpu';

import { glyph, span, txt, bitmap } from '@pmndrs/glyph';
import { Text as R3fText } from '@pmndrs/glyph/react';
import { assertMatchesFreshBuild, createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';
import { PlanTransport } from '../../dist/internal/handle-state.js';

globalThis.self ??= globalThis;
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bitmap16 = bitmap({ strikes: [16] });
const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap16 } });
await glyph.init();
after(() => fonts.dispose());

const ACUTE = '́';
const constraints = { width: { mode: 'exact', size: 220 } };
const layout = { wrap: 'word' };
const style = [{ fontSize: 6, lineHeight: 1 }, { color: '#ffffff' }];

function rendererBytes(mounted) {
  const draws = [];
  mounted.scene.traverse((object) => {
    if (object.userData.pmndrsGlyphRunStart === undefined || object.geometry === undefined) return;
    draws.push({
      instances: object.geometry.instanceCount,
      attributes: Object.fromEntries(
        Object.entries(object.geometry.attributes ?? {})
          .filter(([, attribute]) => attribute instanceof THREE.InstancedBufferAttribute)
          .map(([name, attribute]) => [name, [...attribute.array]]),
      ),
    });
  });
  return draws;
}

function hasSemanticMutations(request) {
  return [
    request.paragraphMutations,
    request.paragraphOrderMutations,
    request.textMutations,
    request.styleMutations,
    request.constraints,
    request.regions,
    request.exclusions,
    request.inlineObjects,
  ].some((mutations) => mutations?.length > 0);
}

test('Rust resolves authored template ranges after fragments join into graphemes', { timeout }, async () => {
  const literal = txt`a${span({ color: '#ff2f00' })`${ACUTE}b`}`;
  assert.equal(literal.text, `a${ACUTE}b`);
  assert.deepEqual(
    literal.spans.map(({ start, end }) => [start, end]),
    [[1, 3]],
  );

  const font = await fonts.load('inter');
  const mounted = mount(font, [{ properties: { constraints, layout, style, text: literal } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    assert.equal(mounted.nodes[0].text, literal.text);
    assert.equal(mounted.nodes[0].error, undefined);
    assert.equal(mounted.nodes[0].measure().glyphCount, 2);
  } finally {
    unmount(mounted);
  }
});

test('nested structural spans preserve authored ranges until Rust resolves them', { timeout }, async () => {
  const inner = span({ color: '#00ff2f' })`${ACUTE}b`;
  const literal = txt`${span({ color: '#ff2f00' })`a${inner}`}c`;
  assert.equal(literal.text, `a${ACUTE}bc`);
  assert.deepEqual(
    literal.spans.map(({ start, end }) => [start, end]),
    [
      [0, 3],
      [1, 3],
    ],
  );
  const font = await fonts.load('inter');
  const mounted = mount(font, [{ properties: { constraints, layout, style, text: literal } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    assert.equal(mounted.nodes[0].error, undefined);
    assert.equal(mounted.nodes[0].measure().glyphCount, 3);
  } finally {
    unmount(mounted);
  }
});

test('a rejected authored mutation leaves the accepted planner usable for the next edit', { timeout }, async () => {
  const font = await fonts.load('inter');
  const initial = {
    constraints,
    layout,
    style: [{ fontSize: 6, lineHeight: 1, features: [{ tag: 'liga', start: 0, end: 1 }] }, { color: '#ffffff' }],
    text: 'A',
  };
  const mounted = mount(font, [{ properties: initial }]);
  const originalReset = PlanTransport.prototype.resetDerivedRoot;
  const originalPrepare = PlanTransport.prototype.prepareParagraph;
  let resetCount = 0;
  let prepareCount = 0;
  try {
    mounted.scene.updateMatrixWorld(true);
    const node = mounted.nodes[0];
    const accepted = node.measure();
    PlanTransport.prototype.prepareParagraph = function (...args) {
      prepareCount += 1;
      return originalPrepare.apply(this, args);
    };
    PlanTransport.prototype.resetDerivedRoot = function (...args) {
      resetCount += 1;
      return originalReset.apply(this, args);
    };

    assert.throws(
      () =>
        node.set({
          style: [{ fontSize: 6, lineHeight: 1, features: [{ tag: 'liga', start: 8 }] }, { color: '#ffffff' }],
        }),
      /must stay inside \[0, 1\)/u,
      'TypeScript rejects a caller-authored feature range before preparation',
    );
    assert.equal(node.text, initial.text, 'the rejected mutation never becomes accepted TypeScript state');
    assert.deepEqual(node.measure(), accepted, 'the accepted Rust measurement remains queryable');
    assert.equal(prepareCount, 0, 'invalid authored data never crosses into Rust');
    assert.equal(resetCount, 0, 'preflight rejection does not discard and rebuild the accepted planner');

    node.set({ text: 'B' });
    assert.equal(node.text, 'B');
    assert.equal(node.measure().glyphCount, 1, 'the same Rust root accepts the next valid edit');
    assert.equal(prepareCount, 1);
    assert.equal(resetCount, 0, 'the valid edit does not require a hidden recovery reset');
  } finally {
    PlanTransport.prototype.resetDerivedRoot = originalReset;
    PlanTransport.prototype.prepareParagraph = originalPrepare;
    unmount(mounted);
  }
});

test('bound edits prepare once and reads plus renderer publication reuse that revision', { timeout }, async () => {
  const font = await fonts.load('inter');
  const first = { constraints, layout, style, text: 'A' };
  const second = { constraints, layout, style, text: 'sibling' };
  const mounted = mount(font, [{ properties: first }, { properties: second }]);
  const originalPrepare = PlanTransport.prototype.prepareParagraph;
  const originalPublish = PlanTransport.prototype.consumeStagedUpdate;
  let preparations = 0;
  let queryMaterializations = 0;
  let publications = 0;
  let split;
  let overwrittenSplit;
  function recordPreparation(request, ...args) {
    if (hasSemanticMutations(request)) preparations += 1;
    else queryMaterializations += 1;
    return originalPrepare.call(this, request, ...args);
  }
  try {
    PlanTransport.prototype.prepareParagraph = recordPreparation;
    PlanTransport.prototype.consumeStagedUpdate = function (...args) {
      publications += 1;
      return originalPublish.apply(this, args);
    };

    mounted.nodes[0].set({ text: 'AB' });
    assert.equal(preparations, 1, 'one changed bound set crosses the Rust preparation boundary once');
    assert.equal(queryMaterializations, 0, 'the changed set does not count as summary materialization');
    mounted.nodes[0].set({ text: 'AB' });
    assert.equal(preparations, 1, 'setting the existing value reuses the prepared revision');

    const measurement = mounted.nodes[0].measure();
    assert.equal(queryMaterializations, 1, 'the first measurement materializes the requested summary once');
    const inspection = mounted.nodes[0].glyphs();
    assert.equal(measurement.glyphCount, 2);
    assert.equal(inspection.glyphCount, 2);
    assert.equal(mounted.nodes[0].measure().glyphCount, 2, 'repeated measurement reads the same prepared value');
    assert.equal(mounted.nodes[0].caretForOffset(2)?.offset, 2);
    assert.ok(mounted.nodes[0].selectionRects(0, 2)?.length);
    split = mounted.nodes[0].split()[0];
    assert.equal(split.count, 2);
    assert.equal(preparations, 1, 'measurement, inspection, caret, selection, and split do not reprepare');
    assert.equal(queryMaterializations, 1, 'subsequent reads reuse the materialized summary');

    mounted.nodes[0].set({ text: 'C' });
    assert.equal(preparations, 2, 'overwriting before publication prepares the replacement once');
    assert.equal(mounted.nodes[0].measure().glyphCount, 1);
    assert.equal(mounted.nodes[0].glyphs().glyphCount, 1);
    overwrittenSplit = mounted.nodes[0].split()[0];
    assert.equal(overwrittenSplit.count, 1);
    assert.equal(preparations, 2, 'reads after the overwrite reuse its prepared revision');
    assert.equal(queryMaterializations, 1, 'the overwritten value uses already requested summaries');

    mounted.scene.updateMatrixWorld(true);
    assert.equal(publications, 1, 'the batch publishes its accumulated dirty records once');
    assert.equal(preparations, 2, 'renderer publication does not repeat retained layout preparation');
    assert.equal(queryMaterializations, 1, 'renderer publication does not request another summary');
    assert.equal(mounted.nodes[0].commitState().status, 'committed');

    PlanTransport.prototype.prepareParagraph = originalPrepare;
    PlanTransport.prototype.consumeStagedUpdate = originalPublish;
    try {
      assertMatchesFreshBuild(
        font,
        mounted,
        [{ properties: { ...first, text: 'C' } }, { properties: second }],
        'edited batched publication',
      );
    } finally {
      PlanTransport.prototype.prepareParagraph = recordPreparation;
      PlanTransport.prototype.consumeStagedUpdate = function (...args) {
        publications += 1;
        return originalPublish.apply(this, args);
      };
    }

    mounted.nodes[0].renderOrder = 10;
    mounted.scene.updateMatrixWorld(true);
    assert.equal(preparations, 2, 'an order-only update leaves retained layout preparation intact');
    assert.equal(queryMaterializations, 1, 'an order-only update does not materialize text summaries');
    assert.equal(publications, 2, 'an order-only rank change crosses the renderer publication boundary once');
  } finally {
    PlanTransport.prototype.prepareParagraph = originalPrepare;
    PlanTransport.prototype.consumeStagedUpdate = originalPublish;
    split?.dispose();
    overwrittenSplit?.dispose();
    unmount(mounted);
  }

  const standalone = mount(font, [{ properties: first }]);
  try {
    standalone.nodes[0].set({ text: 'AB' });
    standalone.nodes[0].set({ text: 'C' });
    assert.equal(standalone.nodes[0].measure().glyphCount, 1);
    standalone.scene.updateMatrixWorld(true);
    assertMatchesFreshBuild(
      font,
      standalone,
      [{ properties: { ...first, text: 'C' } }],
      'standalone retained publication',
    );
  } finally {
    unmount(standalone);
  }
});

test(
  'a post-commit preparation failure invalidates Rust and rebuilds accepted authored text',
  { timeout },
  async () => {
    const font = await fonts.load('inter');
    const properties = { constraints, layout, style, text: 'A' };
    const mounted = mount(font, [{ properties }]);
    const original = PlanTransport.prototype.prepareParagraph;
    const injected = new Error('injected failure after Rust preparation commit');
    let committedCandidate = false;
    try {
      mounted.scene.updateMatrixWorld(true);
      const rendererBefore = rendererBytes(mounted);
      PlanTransport.prototype.prepareParagraph = function (...args) {
        original.apply(this, args);
        committedCandidate = true;
        throw injected;
      };
      assert.throws(
        () => mounted.nodes[0].set({ text: 'BBB' }),
        (error) => error === injected,
      );
      assert.equal(committedCandidate, true, 'the real shaping and Rust preparation commit completed');
      assert.equal(mounted.nodes[0].text, 'A', 'TypeScript-authored accepted text remains A');
      assert.deepEqual(rendererBytes(mounted), rendererBefore, 'renderer-owned in-flight bytes remain untouched');
      PlanTransport.prototype.prepareParagraph = original;

      const recovered = mounted.nodes[0].measure();
      assert.equal(recovered.glyphCount, 1, 'next explicit read rebuilt A instead of retaining BBB');
      assert.equal(mounted.nodes[0].text, 'A');
      mounted.scene.updateMatrixWorld(true);
      assertMatchesFreshBuild(font, mounted, [{ properties }], 'late preparation failure recovery');
    } finally {
      PlanTransport.prototype.prepareParagraph = original;
      unmount(mounted);
    }
  },
);

test('a failed create preparation leaves no accepted text and rebuilds the existing root', { timeout }, async () => {
  const font = await fonts.load('inter');
  const properties = { constraints, layout, style, text: 'A' };
  const mounted = mount(font, [{ properties }]);
  const original = PlanTransport.prototype.prepareParagraph;
  const injected = new Error('injected failure after Rust create preparation commit');
  let committedCandidate = false;
  try {
    const rendererBefore = rendererBytes(mounted);
    PlanTransport.prototype.prepareParagraph = function (...args) {
      original.apply(this, args);
      committedCandidate = true;
      throw injected;
    };
    assert.throws(
      () => mounted.handle.createText({ font, constraints, layout, style, text: 'BBB' }),
      (error) => error === injected,
    );
    assert.equal(committedCandidate, true, 'the real Rust create preparation completed');
    assert.equal(mounted.nodes[0].text, 'A');
    assert.deepEqual(rendererBytes(mounted), rendererBefore, 'the failed create did not touch renderer-owned bytes');
    PlanTransport.prototype.prepareParagraph = original;

    assert.equal(mounted.nodes[0].measure().glyphCount, 1, 'the next read rebuilt the previously accepted A');
    mounted.scene.updateMatrixWorld(true);
    assertMatchesFreshBuild(font, mounted, [{ properties }], 'failed create preparation recovery');
  } finally {
    PlanTransport.prototype.prepareParagraph = original;
    unmount(mounted);
  }
});

test('a failed multi-text recovery replays the full accepted root on the next read', { timeout }, async () => {
  const font = await fonts.load('inter');
  const properties = [
    { constraints, layout, style, text: 'A' },
    { constraints, layout, style, text: 'B' },
  ];
  const mounted = mount(
    font,
    properties.map((value) => ({ properties: value })),
  );
  const originalReset = PlanTransport.prototype.resetDerivedRoot;
  const originalPrepare = PlanTransport.prototype.prepareParagraph;
  const preparationFailure = new Error('injected failure after Rust preparation commit');
  const replayFailure = new Error('injected second-text replay failure');
  let preparationFailed = false;
  let resetCount = 0;
  let replayPrepareCount = 0;
  let replayQueryCount = 0;
  let failedSecondReplay = false;
  try {
    const rendererBefore = rendererBytes(mounted);
    mounted.nodes[0].set({ text: 'AA' });
    PlanTransport.prototype.prepareParagraph = function (...args) {
      originalPrepare.apply(this, args);
      preparationFailed = true;
      throw preparationFailure;
    };
    assert.throws(
      () => mounted.nodes[0].set({ text: 'AAA' }),
      (error) => error === preparationFailure,
    );
    assert.equal(preparationFailed, true, 'the real preparation completed before its result was discarded');
    assert.equal(mounted.nodes[0].text, 'AA', 'the prior authored edit remains accepted');
    PlanTransport.prototype.prepareParagraph = originalPrepare;

    PlanTransport.prototype.resetDerivedRoot = function (...args) {
      resetCount += 1;
      return originalReset.apply(this, args);
    };
    PlanTransport.prototype.prepareParagraph = function (request, ...args) {
      const semantic = hasSemanticMutations(request);
      const result = originalPrepare.call(this, request, ...args);
      if (resetCount > 0 && semantic) replayPrepareCount += 1;
      else if (resetCount > 0) replayQueryCount += 1;
      if (resetCount === 1 && semantic && replayPrepareCount === 2) {
        failedSecondReplay = true;
        throw replayFailure;
      }
      return result;
    };

    assert.throws(
      () => mounted.nodes[0].measure(),
      (error) => error === replayFailure,
    );
    assert.equal(failedSecondReplay, true, 'the second text failed after its replay preparation committed');
    assert.equal(resetCount, 1);
    assert.equal(replayPrepareCount, 2);
    assert.equal(replayQueryCount, 0, 'the failed replay has not materialized query-only summaries');
    assert.deepEqual(
      rendererBytes(mounted),
      rendererBefore,
      'partial derived recovery leaves the in-flight frame untouched',
    );

    assert.equal(mounted.nodes[0].measure().glyphCount, 2, 'retry restores the accepted first text');
    assert.equal(mounted.nodes[1].measure().glyphCount, 1, 'retry restores the accepted second text');
    assert.equal(resetCount, 2, 'the next explicit read resets and replays the entire root');
    assert.equal(replayPrepareCount, 4, 'both texts are prepared again after the partial replay failure');
    assert.equal(replayQueryCount, 2, 'retry materializes both summaries with zero-mutation frames');
    assert.deepEqual(rendererBytes(mounted), rendererBefore, 'measurement recovery does not publish renderer bytes');
  } finally {
    PlanTransport.prototype.resetDerivedRoot = originalReset;
    PlanTransport.prototype.prepareParagraph = originalPrepare;
    unmount(mounted);
  }
});

test('post-write recovery keeps flow revisions monotonic and restores keyed count changes', { timeout }, async () => {
  const font = await fonts.load('inter');
  const region = (inlineEnd) => ({
    key: 'body',
    shape: { kind: 'rectangle', bounds: [0, 0, inlineEnd, 80] },
  });
  const properties = (inlineEnd) => ({
    constraints,
    layout,
    style,
    text: 'A',
    flow: { regions: [region(inlineEnd)] },
  });
  const mounted = mount(font, [{ properties: properties(100) }]);
  const originalPrepare = PlanTransport.prototype.prepareParagraph;
  const originalReset = PlanTransport.prototype.resetDerivedRoot;
  const revisions = [];
  const completedRequests = [];
  const preparationFailure = new Error('force recovery after Rust preparation commits');
  let failPreparation = false;
  let resetCount = 0;
  let failedCountChange;
  try {
    PlanTransport.prototype.prepareParagraph = function (request, ...args) {
      revisions.push(...request.regions.map((entry) => entry.geometryRevision));
      const result = originalPrepare.call(this, request, ...args);
      const completed = {
        regions: request.regions.map(({ id, geometryRevision }) => ({ id, geometryRevision })),
        exclusions: request.exclusions.map(({ id, regionId, geometryRevision }) => ({
          id,
          regionId,
          geometryRevision,
        })),
      };
      completedRequests.push(completed);
      if (failPreparation) {
        failPreparation = false;
        if (completed.regions.length === 2 && completed.exclusions.length === 2) failedCountChange = completed;
        throw preparationFailure;
      }
      return result;
    };
    PlanTransport.prototype.resetDerivedRoot = function (...args) {
      resetCount += 1;
      return originalReset.apply(this, args);
    };
    mounted.nodes[0].set({ flow: { regions: [region(120)] } });
    failPreparation = true;
    assert.throws(
      () => mounted.nodes[0].set({ text: 'BBB' }),
      (error) => error === preparationFailure,
    );
    assert.equal(mounted.nodes[0].text, 'A', 'the failed preparation preserves accepted authored text');

    mounted.nodes[0].set({ text: 'CCCC' });
    assert.equal(mounted.nodes[0].measure().glyphCount, 4);
    assert.deepEqual(
      revisions.slice(-2),
      [3, 4],
      'the valid set uses flow revisions rebuilt from accepted geometry, without regressing them',
    );
    mounted.scene.updateMatrixWorld(true);
    const acceptedMeasurement = mounted.nodes[0].measure();
    const rendererBeforeCountChange = rendererBytes(mounted);
    assert.equal(rendererBeforeCountChange.length > 0, true, 'the accepted flow has renderer-owned draw bytes');
    const expandedFlow = {
      regions: [
        {
          ...region(120),
          exclusions: [{ key: 'body-hole', shape: { kind: 'rectangle', bounds: [24, 0, 34, 80] } }],
        },
        {
          key: 'aside',
          shape: { kind: 'rectangle', bounds: [120, 0, 220, 80] },
          exclusions: [{ key: 'aside-hole', shape: { kind: 'rectangle', bounds: [150, 0, 160, 80] } }],
        },
      ],
    };
    failPreparation = true;
    assert.throws(
      () => mounted.nodes[0].set({ flow: expandedFlow }),
      (error) => error === preparationFailure,
    );
    assert.deepEqual(
      [failedCountChange?.regions.length, failedCountChange?.exclusions.length],
      [2, 2],
      'real Rust preparation completed the count-changing candidate before the injected failure',
    );
    assert.deepEqual(
      failedCountChange.exclusions.map(({ regionId }) => regionId),
      failedCountChange.regions.map(({ id }) => id),
      'each candidate exclusion belongs to its keyed region',
    );
    assert.equal(mounted.nodes[0].text, 'CCCC', 'the failed flow did not replace accepted authored text');
    assert.deepEqual(
      rendererBytes(mounted),
      rendererBeforeCountChange,
      'the failed flow leaves renderer bytes untouched',
    );

    const resetsBeforeRecovery = resetCount;
    const requestsBeforeRecovery = completedRequests.length;
    assert.deepEqual(
      mounted.nodes[0].measure(),
      acceptedMeasurement,
      'the next read restores accepted one-region flow',
    );
    assert.equal(resetCount, resetsBeforeRecovery + 1, 'the next read resets the derived root after the late failure');
    const recoveryRequests = completedRequests.slice(requestsBeforeRecovery);
    const restoredFlow = recoveryRequests.find(
      ({ regions, exclusions }) => regions.length === 1 && exclusions.length === 0,
    );
    assert.equal(restoredFlow?.regions[0].id, failedCountChange.regions[0].id);
    assert.deepEqual(
      rendererBytes(mounted),
      rendererBeforeCountChange,
      'recovery read does not publish renderer bytes',
    );

    mounted.nodes[0].set({ flow: expandedFlow });
    const acceptedExpandedFlow = completedRequests.at(-1);
    assert.deepEqual(
      acceptedExpandedFlow?.regions.map(({ id }) => id),
      failedCountChange.regions.map(({ id }) => id),
      'the valid update keeps both keyed region identities',
    );
    assert.deepEqual(
      acceptedExpandedFlow?.exclusions.map(({ id }) => id),
      failedCountChange.exclusions.map(({ id }) => id),
      'the valid update keeps both keyed exclusion identities',
    );
    assert.equal(mounted.nodes[0].measure().glyphCount, 4);
    mounted.scene.updateMatrixWorld(true);
    const freshProperties = { ...properties(120), text: 'CCCC', flow: expandedFlow };
    const fresh = mount(font, [{ properties: freshProperties }]);
    try {
      assert.deepEqual(mounted.nodes[0].measure(), fresh.nodes[0].measure(), 'warm measurement matches fresh flow');
    } finally {
      unmount(fresh);
    }
    assertMatchesFreshBuild(
      font,
      mounted,
      [{ properties: freshProperties }],
      'count-changing flow preparation recovery',
    );
  } finally {
    PlanTransport.prototype.prepareParagraph = originalPrepare;
    PlanTransport.prototype.resetDerivedRoot = originalReset;
    unmount(mounted);
  }
});

test(
  'a failed staged publication rebuilds accepted text without changing renderer-owned bytes',
  { timeout },
  async () => {
    const font = await fonts.load('inter');
    const properties = { constraints, layout, style, text: 'A' };
    const mounted = mount(font, [{ properties }]);
    const original = PlanTransport.prototype.consumeStagedUpdate;
    const injected = new Error('injected staged publication failure');
    const errors = [];
    try {
      mounted.scene.updateMatrixWorld(true);
      const rendererBefore = rendererBytes(mounted);
      mounted.nodes[0].onError = (error) => errors.push(error);
      mounted.nodes[0].set({ text: 'BBB' });
      PlanTransport.prototype.consumeStagedUpdate = function (...args) {
        original.apply(this, args);
        throw injected;
      };
      mounted.scene.updateMatrixWorld(true);
      assert.deepEqual(errors, [injected], 'publication errors are attributed through the Text error callback');
      assert.deepEqual(rendererBytes(mounted), rendererBefore, 'failed publication preserves the in-flight frame');
      assert.equal(mounted.nodes[0].text, 'BBB', 'publication failure does not reject accepted authored state');
      PlanTransport.prototype.consumeStagedUpdate = original;

      assert.equal(mounted.nodes[0].measure().glyphCount, 3, 'the next explicit read rebuilt accepted text');
      mounted.scene.updateMatrixWorld(true);
      assertMatchesFreshBuild(
        font,
        mounted,
        [{ properties: { ...properties, text: 'BBB' } }],
        'staged publication recovery',
      );
    } finally {
      PlanTransport.prototype.consumeStagedUpdate = original;
      unmount(mounted);
    }
  },
);

test('equivalent authored ranges resolve to the same measurement in Rust', { timeout }, async () => {
  const text = `a${ACUTE}b`;
  const formatted = () => ({
    text,
    spans: [{ start: 1, end: 3, style: { color: '#ff2f00', decoration: { underline: true } } }],
  });
  const font = await fonts.load('inter');
  const mounted = mount(font, [{ properties: { constraints, layout, style, text: formatted() } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    const node = mounted.nodes[0];
    const accepted = node.measure();
    assert.equal(accepted.glyphCount, 2);
    node.set({ text: formatted() });
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(node.measure(), accepted, 'equivalent authored ranges must resolve to the same layout');
    node.set({
      text: {
        text,
        spans: [{ start: 2, end: 3, style: { color: '#ff2f00', decoration: { underline: true } } }],
      },
    });
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(node.measure(), accepted, 'a range already on the cluster grid has the same layout');
  } finally {
    unmount(mounted);
  }
});

test('raw span updates do not run JavaScript grapheme segmentation', { timeout }, async () => {
  const text = `a${ACUTE}fi`;
  const formatted = (color) => ({
    text,
    spans: [
      { start: 0, end: 2, style: { color } },
      { start: 2, end: 4, style: { color: '#ffffff' } },
    ],
  });
  const font = await fonts.load('inter');
  const mounted = mount(font, [{ properties: { constraints, layout, style, text: formatted('#ff2f00') } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    const node = mounted.nodes[0];
    const accepted = node.measure();
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'isWellFormed');
    assert.ok(descriptor);
    let wellFormedChecks = 0;
    // Test instrumentation: an unchanged text value must not be segmented in the JS adapter.
    // oxlint-disable-next-line no-extend-native
    Object.defineProperty(String.prototype, 'isWellFormed', {
      ...descriptor,
      value: function () {
        wellFormedChecks += 1;
        return descriptor.value.call(this);
      },
    });
    try {
      const originalStructuredClone = globalThis.structuredClone;
      let structuredCloneCalls = 0;
      globalThis.structuredClone = (...arguments_) => {
        structuredCloneCalls += 1;
        return originalStructuredClone(...arguments_);
      };
      try {
        assert.doesNotThrow(() => node.set({ text: formatted('#2f7fff') }));
      } finally {
        globalThis.structuredClone = originalStructuredClone;
      }
      assert.equal(
        structuredCloneCalls,
        1,
        'Three snapshots the changed caller style once before Rust prepares the authored ranges',
      );
      assert.equal(wellFormedChecks, 0, 'a paint-only update must not scan or segment unchanged text in JS');
      assert.deepEqual(node.measure(), accepted, 'a paint-only update preserves shaping and placement');
      assert.throws(
        () =>
          node.set({
            text: {
              text,
              spans: [
                { start: 0, end: 2, style: { features: [{ tag: 'liga', start: 0, end: 3 }] } },
                { start: 2, end: 4, style: { color: '#ffffff' } },
              ],
            },
          }),
        /must stay inside \[0, 2\)/u,
        'changed caller features revalidate scope while retaining the unchanged Unicode grid',
      );
      node.set({
        text: {
          text,
          spans: [
            { start: 1, end: 2, style: { color: '#2f7fff' } },
            { start: 2, end: 4, style: { color: '#ffffff' } },
          ],
        },
      });
    } finally {
      // oxlint-disable-next-line no-extend-native
      Object.defineProperty(String.prototype, 'isWellFormed', descriptor);
    }
    node.set({ text: { ...formatted('#2f7fff'), text: `b${ACUTE}fi` } });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.error, undefined);
    assert.equal(node.text, `b${ACUTE}fi`, 'Rust re-resolves retained authored ranges after a text edit');
  } finally {
    unmount(mounted);
  }
});

test('seeded retained formatted batches match a cold full publication after sparse edits', { timeout }, async () => {
  const font = await fonts.load('inter');
  const base = { constraints, layout, style };
  let units = Array.from({ length: 36 }, (_value, index) => String.fromCharCode(97 + (index % 26)));
  let widths = [6, 6, 6, 6, 6, 6];
  let phase = 0;
  const palette = ['#ff2f00', '#2f7fff', '#00bf63', '#f2c94c'];
  const formatted = () => {
    const text = units.join('');
    const spans = [{ start: 0, end: text.length, style: { opacity: 0.95 } }];
    let unitStart = 0;
    for (const [index, width] of widths.entries()) {
      const start = units.slice(0, unitStart).join('').length;
      unitStart += width;
      const end = units.slice(0, unitStart).join('').length;
      spans.push({
        start,
        end,
        style: {
          color: palette[(index + phase) % palette.length],
          opacity: 0.65 + ((index + phase) % 3) * 0.15,
        },
      });
    }
    return { text, spans };
  };

  let current = formatted();
  const mounted = mount(font, [{ properties: { ...base, text: current } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    assertMatchesFreshBuild(font, mounted, [{ properties: { ...base, text: current } }], 'initial retained batch');

    const steps = [
      () => {
        units[2] = 'z';
        units[31] = 'q';
        phase += 1;
      },
      () => {
        units[5] = `a${ACUTE}`;
        units[28] = '😀';
        phase += 1;
      },
      () => {
        widths = [3, 3, 9, 3, 6, 12];
        phase += 1;
      },
      () => {
        units[5] = 'é';
        units[28] = 'x';
        widths = [12, 6, 6, 6, 6];
        phase += 1;
      },
    ];
    for (const [index, mutate] of steps.entries()) {
      mutate();
      current = formatted();
      mounted.nodes[0].set({ text: current });
      mounted.scene.updateMatrixWorld(true);
      assert.equal(mounted.nodes[0].error, undefined, `step ${index} publishes`);
      assertMatchesFreshBuild(
        font,
        mounted,
        [{ properties: { ...base, text: current } }],
        `retained formatted step ${index}`,
      );
    }
  } finally {
    unmount(mounted);
  }
});

test('nested React Text crossing a joining boundary mounts and publishes', { timeout }, async () => {
  const { create } = await import('../support/r3f-test-renderer.mjs');
  const font = await fonts.load('inter');
  const nodes = [];
  const errors = [];
  const renderer = await create(
    createElement(
      R3fText,
      {
        font,
        style,
        constraints,
        layout,
        onError: (error) => void errors.push(error),
        ref: (node) => void (node !== undefined && nodes.push(node)),
      },
      createElement(R3fText, { style: { color: '#ff2f00' } }, 'a'),
      `${ACUTE}bc`,
    ),
  );
  try {
    const node = nodes.at(-1);
    assert.ok(node !== undefined);
    assert.equal(node.text, `a${ACUTE}bc`);
    assert.equal(node.error, undefined);
    assert.deepEqual(errors, []);
  } finally {
    await renderer.unmount();
  }
});

test('nested React Text rejects box-only props before constructing a paragraph', { timeout }, async () => {
  const { create } = await import('../support/r3f-test-renderer.mjs');
  const font = await fonts.load('inter');
  await assert.rejects(
    async () =>
      create(
        createElement(
          R3fText,
          { font, style, constraints, layout },
          createElement(R3fText, { position: [1, 2, 3] }, 'invalid inline box'),
        ),
      ),
    /nested R3F Text cannot use the box property position/,
  );
});
