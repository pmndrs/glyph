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
    // One read prepares the edit; reading `glyphCount` positions it through one more.
    assert.equal(prepareCount, 2);
    assert.equal(resetCount, 0, 'the valid edit does not require a hidden recovery reset');
  } finally {
    PlanTransport.prototype.resetDerivedRoot = originalReset;
    PlanTransport.prototype.prepareParagraph = originalPrepare;
    unmount(mounted);
  }
});

test(
  'bound edits prepare at their first read and later reads plus publication reuse that revision',
  { timeout },
  async () => {
    const font = await fonts.load('inter');
    const first = { constraints, layout, style, text: 'A' };
    const second = { constraints, layout, style, text: 'sibling' };
    const mounted = mount(font, [{ properties: first }, { properties: second }]);
    const originalPrepare = PlanTransport.prototype.prepareParagraph;
    const originalPublish = PlanTransport.prototype.consumeStagedUpdate;
    const originalBatch = PlanTransport.prototype.consumeStagedPreparation;
    let batchPreparations = 0;
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
      PlanTransport.prototype.consumeStagedPreparation = function (...args) {
        batchPreparations += 1;
        return originalBatch.apply(this, args);
      };

      mounted.nodes[0].set({ text: 'AB' });
      mounted.nodes[0].set({ text: 'AB' });
      assert.equal(preparations, 0, 'a changed bound set does not cross the Rust preparation boundary');
      assert.equal(queryMaterializations, 0, 'a setter materializes no summary');

      const measurement = mounted.nodes[0].measure();
      assert.equal(preparations, 1, 'the first read crosses the Rust preparation boundary once');
      assert.equal(queryMaterializations, 0, 'the preparing read returns its summary from the same call');
      mounted.nodes[0].set({ text: 'AB' });
      mounted.nodes[0].measure();
      assert.equal(preparations, 1, 'setting the prepared value again reuses the prepared revision');
      const inspection = mounted.nodes[0].glyphs();
      assert.equal(measurement.glyphCount, 2);
      assert.equal(inspection.glyphCount, 2);
      assert.equal(mounted.nodes[0].measure().glyphCount, 2, 'repeated measurement reads the same prepared value');
      assert.equal(mounted.nodes[0].caret({ offset: 2, affinity: 'upstream' }).line, 0);
      assert.ok(mounted.nodes[0].rangeRects(0, 2).length);
      split = mounted.nodes[0].split()[0];
      assert.equal(split.count, 2);
      assert.equal(preparations, 1, 'measurement, inspection, caret, selection, and split do not reprepare');
      assert.equal(queryMaterializations, 1, 'only the first glyph-fact read positions; later reads reuse it');

      mounted.nodes[0].set({ text: 'overwritten before any read' });
      mounted.nodes[0].set({ text: 'C' });
      assert.equal(preparations, 1, 'overwriting before publication prepares nothing at the setter');
      assert.equal(mounted.nodes[0].measure().glyphCount, 1);
      assert.equal(preparations, 2, 'the read after the overwrite prepares the replacement once');
      assert.equal(mounted.nodes[0].glyphs().glyphCount, 1);
      overwrittenSplit = mounted.nodes[0].split()[0];
      assert.equal(overwrittenSplit.count, 1);
      assert.equal(preparations, 2, 'reads after the overwrite reuse its prepared revision');
      assert.equal(
        queryMaterializations,
        2,
        'the overwritten value uses already requested summaries; its glyph facts took one read',
      );

      mounted.scene.updateMatrixWorld(true);
      assert.equal(publications, 1, 'the batch publishes its accumulated dirty records once');
      assert.equal(preparations, 2, 'renderer publication does not repeat retained layout preparation');
      assert.equal(queryMaterializations, 2, 'renderer publication does not request another summary');
      assert.equal(batchPreparations, 0, 'the frame batch-prepares nothing a read already prepared');
      assert.equal(mounted.nodes[0].commitState().status, 'committed');

      PlanTransport.prototype.prepareParagraph = originalPrepare;
      PlanTransport.prototype.consumeStagedUpdate = originalPublish;
      PlanTransport.prototype.consumeStagedPreparation = originalBatch;
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
        PlanTransport.prototype.consumeStagedPreparation = function (...args) {
          batchPreparations += 1;
          return originalBatch.apply(this, args);
        };
      }

      mounted.nodes[0].renderOrder = 10;
      mounted.scene.updateMatrixWorld(true);
      assert.equal(preparations, 2, 'an order-only update leaves retained layout preparation intact');
      assert.equal(queryMaterializations, 2, 'an order-only update does not materialize text summaries');
      assert.equal(batchPreparations, 0, 'an order-only update is not a preparation');
      assert.equal(publications, 2, 'an order-only rank change crosses the renderer publication boundary once');

      mounted.nodes[0].set({ text: 'unread' });
      mounted.nodes[1].set({ text: 'unread sibling' });
      mounted.scene.updateMatrixWorld(true);
      assert.equal(preparations, 2, 'unread edits are not prepared one paragraph at a time');
      assert.equal(batchPreparations, 1, 'the frame prepares every unread edit of the root in one batch');
      assert.equal(publications, 3);
      assert.equal(mounted.nodes[0].commitState().status, 'committed');
      assert.equal(mounted.nodes[1].commitState().status, 'committed');
    } finally {
      PlanTransport.prototype.prepareParagraph = originalPrepare;
      PlanTransport.prototype.consumeStagedUpdate = originalPublish;
      PlanTransport.prototype.consumeStagedPreparation = originalBatch;
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
  },
);

test('same-length bound roundtrip keeps each prepared read and the first split independent', { timeout }, async () => {
  const font = await fonts.load('inter');
  const first = 'ticker 000';
  const quote = 'quote! 000';
  const properties = { constraints, layout, style, text: first };
  const mounted = mount(font, [{ properties }]);
  const node = mounted.nodes[0];
  let firstCopy;
  let firstSnapshot;
  const copySnapshot = (copy) => ({
    glyphs: Array.from({ length: copy.count }, (_, index) => copy.glyphAt(index)),
    measurements: copy.measurements.map(({ anchorPoint, ...measurement }) => ({
      ...measurement,
      center: anchorPoint('center'),
    })),
  });
  const readPrepared = (source, text, retainCopy = false) => {
    const measurement = source.measure();
    const glyphs = source.glyphs();
    const [copy, decorations] = source.split();
    const snapshot = {
      measure: {
        glyphCount: measurement.glyphCount,
        lineCount: measurement.lineCount,
        width: measurement.width,
        height: measurement.height,
      },
      glyphs: {
        glyphIds: [...glyphs.glyphIds],
        x: [...glyphs.x],
        y: [...glyphs.y],
      },
      caret: source.caret({ offset: text.length, affinity: 'upstream' }),
      split: copySnapshot(copy),
    };
    decorations?.dispose();
    if (retainCopy) firstCopy = copy;
    else copy.dispose();
    return snapshot;
  };
  try {
    // A cold mount synchronizes its own scene. Capture those independent outputs before
    // the retained source enters a pending publication, so the oracle cannot settle it.
    const coldSnapshots = [first, quote, first].map((text) => {
      const cold = mount(font, [{ properties: { ...properties, text } }]);
      try {
        return readPrepared(cold.nodes[0], text);
      } finally {
        unmount(cold);
      }
    });
    for (const [index, text] of [first, quote, first].entries()) {
      if (index !== 0) node.set({ text });
      const warm = readPrepared(node, text, index === 0);
      if (index === 0) firstSnapshot = warm.split;
      assert.deepEqual(warm, coldSnapshots[index], `prepared state ${index} matches independent cold output`);
      if (index !== 0) {
        assert.equal(node.commitState().status, 'pending', `state ${index} awaits renderer publication`);
        assert.deepEqual(copySnapshot(firstCopy), firstSnapshot, 'later edits cannot mutate the first split');
      }
    }

    const originalPublish = PlanTransport.prototype.consumeStagedUpdate;
    let publications = 0;
    try {
      PlanTransport.prototype.consumeStagedUpdate = function (...args) {
        publications += 1;
        return originalPublish.apply(this, args);
      };
      mounted.scene.updateMatrixWorld(true);
    } finally {
      PlanTransport.prototype.consumeStagedUpdate = originalPublish;
    }
    assert.equal(publications, 1, 'the two bound replacements publish once');
    assert.equal(node.commitState().status, 'committed');
    assertMatchesFreshBuild(font, mounted, [{ properties }], 'same-length roundtrip publication');

    node.dispose();
    assert.deepEqual(copySnapshot(firstCopy), firstSnapshot, 'the first split survives source disposal');
  } finally {
    firstCopy?.dispose();
    unmount(mounted);
  }
});

test(
  'a read failing after the Rust preparation commit invalidates Rust and the next read restates the authored text',
  { timeout },
  async () => {
    const font = await fonts.load('inter');
    const properties = { constraints, layout, style, text: 'A' };
    const mounted = mount(font, [{ properties }]);
    const original = PlanTransport.prototype.prepareParagraph;
    const originalReset = PlanTransport.prototype.resetDerivedRoot;
    const injected = new Error('injected failure after Rust preparation commit');
    let committedCandidates = 0;
    let resetCount = 0;
    try {
      mounted.scene.updateMatrixWorld(true);
      const rendererBefore = rendererBytes(mounted);
      PlanTransport.prototype.prepareParagraph = function (...args) {
        original.apply(this, args);
        committedCandidates += 1;
        throw injected;
      };
      PlanTransport.prototype.resetDerivedRoot = function (...args) {
        resetCount += 1;
        return originalReset.apply(this, args);
      };
      mounted.nodes[0].set({ text: 'BBB' });
      assert.equal(committedCandidates, 0, 'the setter does not prepare, so it cannot fail for an engine reason');
      assert.throws(
        () => mounted.nodes[0].measure(),
        (error) => error === injected,
        'the read that prepares reports the failure',
      );
      assert.equal(committedCandidates, 1, 'the real shaping and Rust preparation commit completed');
      assert.equal(mounted.nodes[0].text, 'BBB', 'the failed read keeps the authored text the setter accepted');
      assert.deepEqual(rendererBytes(mounted), rendererBefore, 'renderer-owned in-flight bytes remain untouched');
      PlanTransport.prototype.prepareParagraph = function (...args) {
        committedCandidates += 1;
        return original.apply(this, args);
      };

      const recovered = mounted.nodes[0].measure();
      assert.equal(committedCandidates, 2, 'recovery is one restatement of the paragraph that was read');
      assert.equal(resetCount, 1, 'the late failure discards the derived Rust root exactly once');
      assert.equal(recovered.glyphCount, 3, 'the next read restates the current authored BBB');
      assert.equal(mounted.nodes[0].text, 'BBB');
      assert.deepEqual(rendererBytes(mounted), rendererBefore, 'a recovery read does not publish renderer bytes');
      mounted.scene.updateMatrixWorld(true);
      assert.equal(mounted.nodes[0].commitState().status, 'committed');
      assertMatchesFreshBuild(
        font,
        mounted,
        [{ properties: { ...properties, text: 'BBB' } }],
        'late preparation failure recovery',
      );

      mounted.nodes[0].set({ text: 'A' });
      mounted.scene.updateMatrixWorld(true);
      assertMatchesFreshBuild(font, mounted, [{ properties }], 'a later setter after recovery');
    } finally {
      PlanTransport.prototype.prepareParagraph = original;
      PlanTransport.prototype.resetDerivedRoot = originalReset;
      unmount(mounted);
    }
  },
);

test(
  'a failed first read of a created text keeps the text restatable and leaves the existing root intact',
  { timeout },
  async () => {
    const font = await fonts.load('inter');
    const properties = { constraints, layout, style, text: 'A' };
    const mounted = mount(font, [{ properties }]);
    const original = PlanTransport.prototype.prepareParagraph;
    const injected = new Error('injected failure after Rust create preparation commit');
    let committedCandidates = 0;
    let created;
    try {
      const rendererBefore = rendererBytes(mounted);
      const acceptedMeasurement = mounted.nodes[0].measure();
      PlanTransport.prototype.prepareParagraph = function (...args) {
        original.apply(this, args);
        committedCandidates += 1;
        throw injected;
      };
      created = mounted.handle.createText({ font, constraints, layout, style, text: 'BBB' });
      assert.equal(committedCandidates, 0, 'creation does not prepare, so it cannot fail for an engine reason');
      assert.throws(
        () => created.measure(),
        (error) => error === injected,
        'the first read of the created text reports the failure',
      );
      assert.equal(committedCandidates, 1, 'the real Rust create preparation completed');
      assert.equal(created.text, 'BBB');
      assert.equal(mounted.nodes[0].text, 'A');
      assert.deepEqual(rendererBytes(mounted), rendererBefore, 'the failed create did not touch renderer-owned bytes');
      PlanTransport.prototype.prepareParagraph = original;

      assert.deepEqual(mounted.nodes[0].measure(), acceptedMeasurement, 'the published A stays readable');
      assert.equal(created.measure().glyphCount, 3, 'the next read restates the created text');
      assert.deepEqual(rendererBytes(mounted), rendererBefore, 'recovery reads do not publish renderer bytes');
      created.dispose();
      created = undefined;
      mounted.scene.updateMatrixWorld(true);
      assertMatchesFreshBuild(font, mounted, [{ properties }], 'failed create preparation recovery');
    } finally {
      PlanTransport.prototype.prepareParagraph = original;
      created?.dispose();
      unmount(mounted);
    }
  },
);

test(
  'a failed multi-text recovery restates each text at its own next read, never its siblings',
  { timeout },
  async () => {
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
    const restatementFailure = new Error('injected restatement failure');
    let preparationFailed = false;
    let resetCount = 0;
    let restatementCount = 0;
    let restatementQueryCount = 0;
    let failedRestatement = false;
    try {
      const rendererBefore = rendererBytes(mounted);
      mounted.nodes[0].set({ text: 'AA' });
      assert.equal(mounted.nodes[0].measure().glyphCount, 2);
      mounted.nodes[0].set({ text: 'AAA' });
      PlanTransport.prototype.prepareParagraph = function (...args) {
        originalPrepare.apply(this, args);
        preparationFailed = true;
        throw preparationFailure;
      };
      assert.throws(
        () => mounted.nodes[0].measure(),
        (error) => error === preparationFailure,
      );
      assert.equal(preparationFailed, true, 'the real preparation completed before its result was discarded');
      assert.equal(mounted.nodes[0].text, 'AAA', 'the failed read keeps the authored edit');
      PlanTransport.prototype.prepareParagraph = originalPrepare;

      PlanTransport.prototype.resetDerivedRoot = function (...args) {
        resetCount += 1;
        return originalReset.apply(this, args);
      };
      PlanTransport.prototype.prepareParagraph = function (request, ...args) {
        const semantic = hasSemanticMutations(request);
        const result = originalPrepare.call(this, request, ...args);
        if (semantic) restatementCount += 1;
        else restatementQueryCount += 1;
        if (semantic && restatementCount === 1) {
          failedRestatement = true;
          throw restatementFailure;
        }
        return result;
      };

      assert.throws(
        () => mounted.nodes[0].measure(),
        (error) => error === restatementFailure,
      );
      assert.equal(failedRestatement, true, 'the restatement failed after its preparation committed');
      assert.equal(resetCount, 1);
      assert.equal(restatementCount, 1, 'the failed recovery read restated only the paragraph it read');
      assert.equal(restatementQueryCount, 0);
      assert.deepEqual(
        rendererBytes(mounted),
        rendererBefore,
        'partial derived recovery leaves the in-flight frame untouched',
      );

      assert.equal(mounted.nodes[0].measure().glyphCount, 3, 'retry restates the current first text');
      assert.equal(resetCount, 2, 'the next read resets the derived root again after the second late failure');
      assert.equal(restatementCount, 2, 'the retry restates the first text alone, not its sibling');
      assert.equal(mounted.nodes[1].measure().glyphCount, 1, 'the sibling is restated by its own read');
      assert.equal(restatementCount, 3, 'the sibling read restates the sibling once');
      assert.equal(mounted.nodes[0].measure().glyphCount, 3);
      assert.equal(mounted.nodes[1].measure().glyphCount, 1);
      assert.equal(resetCount, 2, 'restated texts need no further reset');
      assert.equal(restatementCount, 3, 'restated texts are not prepared again');
      assert.equal(restatementQueryCount, 2, 'each restatement returned its summary; its glyph facts took one read');
      assert.deepEqual(rendererBytes(mounted), rendererBefore, 'measurement recovery does not publish renderer bytes');

      let batchPreparations = 0;
      const originalBatch = PlanTransport.prototype.consumeStagedPreparation;
      PlanTransport.prototype.consumeStagedPreparation = function (...args) {
        batchPreparations += 1;
        return originalBatch.apply(this, args);
      };
      try {
        mounted.scene.updateMatrixWorld(true);
      } finally {
        PlanTransport.prototype.consumeStagedPreparation = originalBatch;
      }
      assert.equal(batchPreparations, 0, 'the frame prepares nothing the recovery reads restated');
      assert.equal(restatementCount, 3);
      assert.equal(mounted.nodes[0].commitState().status, 'committed');
      assert.equal(mounted.nodes[1].commitState().status, 'committed');
      assertMatchesFreshBuild(
        font,
        mounted,
        [{ properties: { ...properties[0], text: 'AAA' } }, { properties: properties[1] }],
        'multi-text recovery publication',
      );
    } finally {
      PlanTransport.prototype.resetDerivedRoot = originalReset;
      PlanTransport.prototype.prepareParagraph = originalPrepare;
      unmount(mounted);
    }
  },
);

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
  const freshProperties = { ...properties(120), text: 'CCCC', flow: expandedFlow };
  // A cold mount runs a frame for every root, so the oracle is read before the subject has anything pending.
  const fresh = mount(font, [{ properties: freshProperties }]);
  const freshMeasurement = fresh.nodes[0].measure();
  unmount(fresh);
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
    assert.equal(mounted.nodes[0].measure().glyphCount, 1);
    mounted.nodes[0].set({ text: 'BBB' });
    assert.equal(completedRequests.length, 2, 'setters do not prepare (the read and its glyph facts made two)');
    failPreparation = true;
    assert.throws(
      () => mounted.nodes[0].measure(),
      (error) => error === preparationFailure,
    );
    assert.equal(mounted.nodes[0].text, 'BBB', 'the failed read keeps the authored text the setter accepted');

    mounted.nodes[0].set({ text: 'CCCC' });
    assert.equal(mounted.nodes[0].measure().glyphCount, 4);
    assert.equal(resetCount, 1, 'the read after the late failure resets the derived root once');
    assert.deepEqual(
      revisions,
      [2, 3],
      'the restatement after the reset carries a later flow revision than the one the engine had prepared',
    );
    mounted.scene.updateMatrixWorld(true);
    const acceptedMeasurement = mounted.nodes[0].measure();
    const rendererBeforeCountChange = rendererBytes(mounted);
    assert.equal(rendererBeforeCountChange.length > 0, true, 'the accepted flow has renderer-owned draw bytes');
    mounted.nodes[0].set({ flow: expandedFlow });
    failPreparation = true;
    assert.throws(
      () => mounted.nodes[0].measure(),
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
    assert.equal(mounted.nodes[0].text, 'CCCC', 'the failed flow read did not disturb authored text');
    assert.deepEqual(
      rendererBytes(mounted),
      rendererBeforeCountChange,
      'the failed flow leaves renderer bytes untouched',
    );

    const resetsBeforeRecovery = resetCount;
    const requestsBeforeRecovery = completedRequests.length;
    assert.deepEqual(
      mounted.nodes[0].measure(),
      freshMeasurement,
      'the next read restates the current two-region flow as a fresh build lays it out',
    );
    assert.equal(resetCount, resetsBeforeRecovery + 1, 'the next read resets the derived root after the late failure');
    const recoveryRequests = completedRequests.slice(requestsBeforeRecovery);
    // Comparing the whole summary reads its glyph facts: one restatement, then one read that positions it.
    assert.equal(recoveryRequests.length, 2, 'recovery is one restatement of the paragraph that was read');
    assert.deepEqual(
      recoveryRequests[0].regions.map(({ id }) => id),
      failedCountChange.regions.map(({ id }) => id),
      'the restatement keeps both keyed region identities',
    );
    assert.deepEqual(
      recoveryRequests[0].exclusions.map(({ id, regionId }) => ({ id, regionId })),
      failedCountChange.exclusions.map(({ id, regionId }) => ({ id, regionId })),
      'the restatement keeps both keyed exclusion identities and their regions',
    );
    assert.deepEqual(
      rendererBytes(mounted),
      rendererBeforeCountChange,
      'recovery read does not publish renderer bytes',
    );

    mounted.nodes[0].set({ flow: { regions: [region(120)] } });
    assert.deepEqual(
      mounted.nodes[0].measure(),
      acceptedMeasurement,
      'a keyed count decrease after recovery restores the one-region layout',
    );
    // The last request read the summary's glyph facts; the one before it restored the flow.
    const restoredFlow = completedRequests.at(-2);
    assert.deepEqual(
      [restoredFlow.regions.map(({ id }) => id), restoredFlow.exclusions],
      [[failedCountChange.regions[0].id], []],
      'the surviving region keeps its keyed identity',
    );
    assert.deepEqual(
      rendererBytes(mounted),
      rendererBeforeCountChange,
      'reads of unpublished flow do not publish renderer bytes',
    );

    mounted.nodes[0].set({ flow: expandedFlow });
    assert.equal(completedRequests.at(-2), restoredFlow, 'the setter does not prepare');
    assert.deepEqual(mounted.nodes[0].measure(), freshMeasurement);
    const acceptedExpandedFlow = completedRequests.at(-2);
    assert.deepEqual(
      acceptedExpandedFlow.regions.map(({ id }) => id),
      failedCountChange.regions.map(({ id }) => id),
      'the valid update keeps both keyed region identities',
    );
    assert.deepEqual(
      acceptedExpandedFlow.exclusions.map(({ id }) => id),
      failedCountChange.exclusions.map(({ id }) => id),
      'the valid update keeps both keyed exclusion identities',
    );
    const latestRevision = new Map();
    for (const { regions, exclusions } of completedRequests) {
      for (const { id, geometryRevision } of [...regions, ...exclusions]) {
        assert.ok(
          geometryRevision >= (latestRevision.get(id) ?? 0),
          `flow record ${String(id)} regressed to revision ${String(geometryRevision)}`,
        );
        latestRevision.set(id, geometryRevision);
      }
    }
    mounted.scene.updateMatrixWorld(true);
    assert.equal(mounted.nodes[0].commitState().status, 'committed');
    assert.deepEqual(mounted.nodes[0].measure(), freshMeasurement, 'warm measurement matches fresh flow');
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
    let segmenters = 0;
    const Segmenter = Intl.Segmenter;
    // Test instrumentation: span boundaries are resolved in Rust, so no setter, read or frame may segment in JS.
    Intl.Segmenter = class extends Segmenter {
      constructor(...arguments_) {
        super(...arguments_);
        segmenters += 1;
      }
    };
    // Test instrumentation: the lone-surrogate repair is the only scan of text a setter may make.
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
        0,
        'Three snapshots the changed plain caller style without entering the structured-clone serializer',
      );
      assert.equal(wellFormedChecks, 0, 'a paint-only update does not scan its unchanged text');
      assert.deepEqual(node.measure(), accepted, 'a paint-only update preserves shaping and placement');
      assert.equal(wellFormedChecks, 0, 'a read does not scan text in JS');
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
      // oxlint-disable-next-line no-extend-native
      Object.defineProperty(String.prototype, 'isWellFormed', descriptor);
      const edited = { ...formatted('#2f7fff'), text: `b${ACUTE}fi` };
      node.set({ text: edited });
      assert.ok(node.measure().glyphCount > 0);
      mounted.scene.updateMatrixWorld(true);
      assert.equal(node.error, undefined);
      assert.equal(node.text, `b${ACUTE}fi`, 'Rust re-resolves retained authored ranges after a text edit');
      assert.equal(segmenters, 0, 'no setter, read or frame constructed a JavaScript segmenter');
      assertMatchesFreshBuild(
        font,
        mounted,
        [{ properties: { constraints, layout, style, text: edited } }],
        'ranges re-resolved in Rust after a text edit',
      );
    } finally {
      Intl.Segmenter = Segmenter;
      // oxlint-disable-next-line no-extend-native
      Object.defineProperty(String.prototype, 'isWellFormed', descriptor);
    }
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
