/**
 * Sequence-level property gate for the retained text engine.
 *
 * Single-step tests fix one input and assert one output. The defects this engine has
 * actually shipped were pairings instead: a state reachable only after a particular
 * ORDER of edits, measures, and publishes. This harness drives randomized-but-seeded
 * interactive sequences through the public Three surface and asserts, after every step,
 * that valid input never fails to publish and that committed metrics never disagree with
 * themselves.
 *
 * Determinism is a requirement, not a convenience: the generator is a seeded PRNG with a
 * fixed seed list, so a failure names the seed and step that reproduce it exactly. There
 * is no wall-clock input, no Math.random, and no retry.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FontRegistry } from '@pmndrs/glyph';
import { createTextRuntime } from '@pmndrs/glyph/core';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { Text, TextGroup } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

const fixtures = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);
const shaperWasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

/** Fonts chosen for shaping behaviour that has broken the engine before. */
const FONT_FIXTURES = {
  // Applies `liga` to Latin f-pairs, so a ligature absorbs a grapheme cluster.
  amiri: 'amiri-bitmap-16.font.glb',
  // No Latin ligature substitution as baked; the plain one-glyph-per-grapheme control.
  inter: 'inter-bitmap-16.font.glb',
  // Dense script with no spaces, exercising break search without word boundaries.
  cjk: 'noto-sans-cjk-showcase-bitmap-16.font.glb',
};

/**
 * Seed corpus: the authored Advanced-shaping timeline, which drives text, width,
 * direction, language, and features together and is the sequence that found the
 * ligature and style-payload defects in the live app.
 */
const SEEDED_CASES = [
  {
    id: 'latin-features',
    font: 'inter',
    direction: 'ltr',
    language: 'en',
    features: [
      { tag: 'kern', value: 1 },
      { tag: 'liga', value: 1 },
    ],
    text: 'AVATAR office é ä ffl. Affinity, efficient files, and fine forms reveal where ligatures join and kerning pairs settle.',
  },
  {
    id: 'arabic-joining',
    font: 'amiri',
    direction: 'rtl',
    language: 'ar',
    features: [],
    text: 'النص العربي يتدفق بوضوح، وتتصل الحروف وتتغير أشكالها مع كل حرف جديد.',
  },
  {
    id: 'mixed-bidi',
    font: 'amiri',
    direction: 'rtl',
    language: 'ar',
    features: [{ tag: 'liga', value: 1 }],
    text: 'PMNDRS 2026 — النص العربي يتدفق بوضوح، while Latin words and 0123456789 keep their own direction. علامات الترقيم meet office ligatures.',
  },
  {
    id: 'cjk-line-breaks',
    font: 'cjk',
    direction: 'ltr',
    language: 'ja',
    features: [],
    text: '文字組版では、空白なしでも自然に改行します。新しい文字が一つずつ現れるたびに、禁則処理と句読点の位置を保ちながら段落が伸びていきます。',
  },
];

/** mulberry32: small, deterministic, and dependency-free. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick(random, values) {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

function integer(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

const dataUrl = (bytes) => `data:model/gltf-binary;base64,${bytes.toString('base64')}`;

async function loadFonts(runtime) {
  const entries = await Promise.all(
    Object.entries(FONT_FIXTURES).map(async ([name, file]) => [
      name,
      await runtime.loadFont({
        input: { baked: dataUrl(await readFile(new URL(file, fixtures))) },
        raster: { technique: bitmap, options: { strikes: [16] } },
      }),
    ]),
  );
  return Object.fromEntries(entries);
}

const MEASUREMENT_KEYS = [
  'width',
  'height',
  'contentWidth',
  'contentHeight',
  'firstBaseline',
  'lastBaseline',
  'overflowed',
  'glyphCount',
  'lineCount',
  'missingGlyphCount',
];

function summarize(metrics) {
  return MEASUREMENT_KEYS.map((key) => `${key}=${String(metrics[key])}`).join(' ');
}

/** One paragraph under test, plus the inputs last applied to it. */
class Subject {
  constructor(fonts, random) {
    this.fonts = fonts;
    this.fontKey = pick(random, Object.keys(fonts));
    this.text = pick(random, SEEDED_CASES).text.slice(0, integer(random, 0, 24));
    this.width = integer(random, 120, 900);
    this.fontSize = pick(random, [12, 16, 20, 28]);
    this.letterSpacing = 0;
    this.direction = pick(random, ['auto', 'ltr', 'rtl']);
    this.language = pick(random, ['en', 'ar', 'ja']);
    this.features = pick(random, [[], [{ tag: 'liga', value: 1 }], [{ tag: 'liga', value: 0 }]]);
    this.color = '#ffffff';
    this.node = undefined;
    this.attached = false;
  }

  style() {
    return {
      fontSize: this.fontSize,
      lineHeight: 1.25,
      ...(this.letterSpacing === 0 ? {} : { letterSpacing: this.letterSpacing }),
      direction: this.direction,
      language: this.language,
      ...(this.features.length === 0 ? {} : { features: this.features }),
    };
  }

  create(group) {
    this.node = new Text({
      font: this.fonts[this.fontKey],
      text: this.text,
      style: this.style(),
      paint: { color: this.color },
      contentBox: { width: { mode: 'exact', size: this.width }, wrap: 'word' },
    });
    group.add(this.node);
    this.attached = true;
  }

  apply() {
    if (this.node === undefined) return;
    this.node.font = this.fonts[this.fontKey];
    this.node.text = this.text;
    this.node.style = this.style();
    this.node.paint = { color: this.color };
    this.node.contentBox = { width: { mode: 'exact', size: this.width }, wrap: 'word' };
  }
}

/**
 * The operation alphabet. Each entry mutates the subject's intended inputs; the runner
 * applies them and publishes. Weights favour the edit shapes that compose into the
 * pairings the engine has historically mishandled.
 */
const OPERATIONS = [
  {
    name: 'append-text',
    apply(subject, random) {
      const source = pick(random, SEEDED_CASES).text;
      subject.text += source.slice(0, integer(random, 1, 6));
    },
  },
  {
    name: 'truncate-text',
    apply(subject, random) {
      subject.text = subject.text.slice(0, Math.max(0, subject.text.length - integer(random, 1, 5)));
    },
  },
  {
    name: 'splice-text',
    apply(subject, random) {
      if (subject.text.length < 2) return;
      const at = integer(random, 0, subject.text.length - 1);
      const source = pick(random, SEEDED_CASES).text;
      subject.text = subject.text.slice(0, at) + source.slice(0, integer(random, 1, 4)) + subject.text.slice(at + 1);
    },
  },
  { name: 'clear-text', apply: (subject) => void (subject.text = '') },
  { name: 'resize', apply: (subject, random) => void (subject.width = integer(random, 80, 960)) },
  // A metrics restyle can equalize adjacent layout styles, which merges shaping runs and
  // invalidates retained per-run state; this is the shape that caused a live regression.
  { name: 'restyle-metrics', apply: (subject, random) => void (subject.fontSize = pick(random, [12, 16, 20, 28])) },
  {
    name: 'restyle-tracking',
    apply: (subject, random) => void (subject.letterSpacing = pick(random, [0, 0, 0.5, 2])),
  },
  // Paint-only: positioning re-runs over a committed flow, the valid pending pairing.
  {
    name: 'restyle-paint',
    apply: (subject, random) => void (subject.color = pick(random, ['#ffffff', '#ff8800', '#00c8ff'])),
  },
  {
    name: 'flip-direction',
    apply: (subject, random) => void (subject.direction = pick(random, ['auto', 'ltr', 'rtl'])),
  },
  { name: 'flip-language', apply: (subject, random) => void (subject.language = pick(random, ['en', 'ar', 'ja'])) },
  {
    name: 'flip-features',
    apply: (subject, random) =>
      void (subject.features = pick(random, [
        [],
        [{ tag: 'liga', value: 1 }],
        [{ tag: 'liga', value: 0 }],
        [
          { tag: 'kern', value: 1 },
          { tag: 'liga', value: 1 },
        ],
      ])),
  },
  { name: 'swap-font', apply: (subject, random) => void (subject.fontKey = pick(random, Object.keys(subject.fonts))) },
];

/** Lifecycle churn driving the retention layer rather than the paragraph inputs. */
const LIFECYCLE_OPERATIONS = ['detach', 'reattach', 'recreate'];

function checkSubject(subject, context) {
  if (!subject.attached || subject.node === undefined) return;
  const { node } = subject;
  assert.equal(node.error, undefined, `${context}: paragraph reported ${String(node.error?.message)}`);

  const measured = node.layout();
  assert.notEqual(measured, undefined, `${context}: committed layout metrics went missing`);

  // Re-measuring without an intervening mutation must answer identically. A retained
  // query that disagrees with itself is the observable form of desynchronized state.
  const again = node.layout();
  assert.equal(summarize(again), summarize(measured), `${context}: repeated measurement disagreed with itself`);

  // Dual derivation: the per-glyph inspection lane and the line-level measurement lane
  // are computed by different code paths and must agree on the glyph totals.
  const inspected = node.glyphs();
  assert.notEqual(inspected, undefined, `${context}: layout inspection went missing`);
  assert.equal(
    inspected.glyphCount,
    measured.glyphCount,
    `${context}: inspected glyph count disagreed with measurement`,
  );
  assert.equal(
    inspected.glyphIds.length,
    measured.glyphCount,
    `${context}: glyph lane length disagreed with glyph count`,
  );
  assert.equal(inspected.lineCount, measured.lineCount, `${context}: inspected line count disagreed with measurement`);
  assert.ok(Number.isFinite(measured.contentWidth), `${context}: content width was not finite`);
  assert.ok(measured.contentWidth >= 0, `${context}: content width was negative`);
}

async function runSequence({ seed, steps, paragraphs, fonts }) {
  const random = seededRandom(seed);
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  const subjects = Array.from({ length: paragraphs }, () => new Subject(fonts, random));
  const journal = [];

  const sync = (label) => {
    journal.push(label);
    scene.updateMatrixWorld(true);
  };

  try {
    for (const subject of subjects) subject.create(group);
    sync('create');
    for (const [index, subject] of subjects.entries()) checkSubject(subject, `seed ${seed} create p${index}`);

    for (let step = 0; step < steps; step += 1) {
      const index = integer(random, 0, subjects.length - 1);
      const subject = subjects[index];

      // Lifecycle churn is rarer than editing, but must interleave with it.
      if (random() < 0.08) {
        const churn = pick(random, LIFECYCLE_OPERATIONS);
        journal.push(`p${index}:${churn}`);
        if (churn === 'detach' && subject.attached) {
          group.remove(subject.node);
          subject.attached = false;
        } else if (churn === 'reattach' && !subject.attached) {
          group.add(subject.node);
          subject.attached = true;
        } else if (churn === 'recreate') {
          if (subject.attached) group.remove(subject.node);
          subject.node.dispose();
          subject.create(group);
        }
      } else {
        const operation = pick(random, OPERATIONS);
        journal.push(`p${index}:${operation.name}`);
        operation.apply(subject, random);
        subject.apply();
      }

      // Layout queries between mutations open speculative transactions that the next
      // publish either adopts or drops; interleaving them is the point of the harness.
      if (random() < 0.5) {
        for (const [candidateIndex, candidate] of subjects.entries()) {
          if (!candidate.attached || candidate.node === undefined) continue;
          try {
            candidate.node.layout();
          } catch (error) {
            error.message = `p${candidateIndex} measurement: ${error.message}`;
            throw error;
          }
        }
        journal.push('layout');
      }

      sync(`step ${step}`);
      for (const [subjectIndex, candidate] of subjects.entries()) {
        checkSubject(candidate, `seed ${seed} step ${step} (${journal.slice(-3).join(' -> ')}) p${subjectIndex}`);
      }
    }
  } catch (error) {
    error.message = `${error.message}\n  seed=${seed} paragraphs=${paragraphs}\n  journal: ${journal.join(', ')}`;
    throw error;
  } finally {
    for (const subject of subjects) subject.node?.dispose();
    group.dispose();
  }
}

test('randomized interactive sequences never fail to publish valid input', async () => {
  const runtime = await createTextRuntime({
    registry: new FontRegistry(),
    wasm: await readFile(shaperWasmUrl),
  });
  const fonts = await loadFonts(runtime);
  try {
    // A fixed seed list keeps the gate deterministic. Widen it deliberately when a new
    // defect class appears, and add the reproducing seed here rather than re-rolling.
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
      await runSequence({ seed, steps: 24, paragraphs: 3, fonts });
    }
  } finally {
    runtime.dispose();
  }
});

test('the authored shaping timeline types, wraps, and restyles without desynchronizing', async () => {
  // The seed corpus replayed exactly: every case typed one grapheme at a time under an
  // oscillating width, with the case switch changing font, direction, language, and
  // features together. This is the live Advanced-shaping workload's sequence.
  const runtime = await createTextRuntime({
    registry: new FontRegistry(),
    wasm: await readFile(shaperWasmUrl),
  });
  const fonts = await loadFonts(runtime);
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  const nodes = Array.from({ length: 4 }, () => {
    const node = new Text({
      font: fonts.inter,
      text: '',
      style: { fontSize: 20, lineHeight: 1.25 },
      contentBox: { width: { mode: 'exact', size: 400 }, wrap: 'word' },
    });
    group.add(node);
    return node;
  });
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  try {
    for (const shapingCase of SEEDED_CASES) {
      const units = [...segmenter.segment(shapingCase.text)].map((entry) => entry.segment);
      for (const [index, node] of nodes.entries()) {
        node.font = fonts[shapingCase.font];
        node.style = {
          fontSize: 20,
          lineHeight: 1.25,
          direction: shapingCase.direction,
          language: shapingCase.language,
          ...(shapingCase.features.length === 0 ? {} : { features: shapingCase.features }),
        };
        node.text = '';
        node.contentBox = { width: { mode: 'exact', size: 600 - index * 7 }, wrap: 'word' };
      }
      scene.updateMatrixWorld(true);

      for (let tick = 1; tick <= units.length; tick += 1) {
        const content = units.slice(0, tick).join('');
        for (const [index, node] of nodes.entries()) {
          node.text = content;
          node.contentBox = {
            width: { mode: 'exact', size: 240 + ((tick * 37 + index * 11) % 420) },
            wrap: 'word',
          };
        }
        for (const node of nodes) node.layout();
        scene.updateMatrixWorld(true);
        for (const [index, node] of nodes.entries()) {
          assert.equal(
            node.error,
            undefined,
            `${shapingCase.id} tick ${tick} p${index}: ${String(node.error?.message)}`,
          );
          const metrics = node.layout();
          assert.equal(
            metrics.missingGlyphCount,
            0,
            `${shapingCase.id} tick ${tick} p${index} produced .notdef glyphs`,
          );
        }
      }
    }
  } finally {
    for (const node of nodes) node.dispose();
    group.dispose();
    runtime.dispose();
  }
});

test('teardown is total, idempotent, and non-throwing while paragraphs still hold leases', async () => {
  // Disposal runs in `finally` blocks and unmount paths that are often already unwinding
  // an earlier failure. A throw there destroys the original error and strands the Wasm
  // instance, so outstanding leases are reported and force-released instead of refused.
  // A TextGroup deliberately does not dispose its children -- Three's ownership rule --
  // so this is the ordinary shape of an application shutting down.
  const runtime = await createTextRuntime({
    registry: new FontRegistry(),
    wasm: await readFile(shaperWasmUrl),
  });
  const fonts = await loadFonts(runtime);
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  for (let index = 0; index < 4; index += 1) {
    group.add(
      new Text({
        font: fonts.inter,
        text: 'retained',
        style: { fontSize: 20, lineHeight: 1.25 },
        contentBox: { width: { mode: 'exact', size: 400 }, wrap: 'word' },
      }),
    );
  }
  scene.updateMatrixWorld(true);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => void warnings.push(args.join(' '));
  try {
    group.dispose();
    runtime.dispose();
    // Repeating every teardown must be a no-op, not a second failure.
    group.dispose();
    runtime.dispose();
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(
    warnings.some((line) => line.includes('live paragraph lease')),
    `force-released leases must be reported; saw ${JSON.stringify(warnings)}`,
  );
  assert.equal(fonts.inter.disposed, true, 'the font must actually be disposed, not left half-torn-down');
});

test('teardown order does not matter, including a paragraph disposed after its runtime', async () => {
  // react-three-fiber defers dispose to idle priority (disposeOnIdle), so a Text routinely
  // disposes AFTER the runtime an application tore down on unmount. Ownership assertions
  // that hold for a live font are meaningless once it is disposed: the ledger is closed,
  // and a late release is not a double release. r3f swallows dispose errors, so a throw
  // here would be invisible in React and fatal in plain Three.
  const runtime = await createTextRuntime({
    registry: new FontRegistry(),
    wasm: await readFile(shaperWasmUrl),
  });
  const fonts = await loadFonts(runtime);
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  const texts = Array.from({ length: 3 }, () => {
    const node = new Text({
      font: fonts.inter,
      text: 'deferred',
      style: { fontSize: 20, lineHeight: 1.25 },
      contentBox: { width: { mode: 'exact', size: 400 }, wrap: 'word' },
    });
    group.add(node);
    return node;
  });
  scene.updateMatrixWorld(true);

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    // Deliberately the wrong order: the runtime goes first, the paragraphs afterwards.
    runtime.dispose();
    for (const text of texts) text.dispose();
    group.dispose();
    // And again, because idle callbacks can also fire more than the paragraph count.
    for (const text of texts) text.dispose();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(fonts.inter.disposed, true);
});
