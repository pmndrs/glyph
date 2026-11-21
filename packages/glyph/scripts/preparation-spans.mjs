/* @workflow { "name": "glyph:preparation-spans", "summary": "Time setter, setter + read and setter + frame for the many-label, typing, colour and mount operations against one built package, with the engine crossings of each span.", "requirements": "A built package at --package-root <absolute directory> (its dist and node_modules). A spike probe, not a benchmark protocol: alternate the package roots to compare and run one at a time.", "writes": "Only --json <file> when given." } */
// Times the three spans of every setter-ending operation (setter; setter + read; setter + frame)
// against one built package, and counts the engine crossings each span makes.
//
//   node scripts/preparation-spans.mjs --package-root <absolute package directory> [--json <file>]
//
// It is a spike probe, not a benchmark harness: medians of a few repetitions on whatever the machine
// is doing. Run the package roots to compare in alternation and read the shape, not the last digit.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const packageRoot = args.get('--package-root');
if (packageRoot === undefined) throw new Error('--package-root <absolute package directory> is required');
const from = (path) => pathToFileURL(`${packageRoot}/${path}`).href;

const { crossingsOf } = await import(new URL('../tests/support/wasm-crossings.mjs', import.meta.url).href);
const { bitmap, glyph } = await import(from('dist/index.js'));
const { ThreeConfig } = await import(from('dist/three.js'));
const { loadFont } = await import(from('dist/loader.js'));
const THREE = await import(pathToFileURL(createRequire(`${packageRoot}/`).resolve('three/webgpu')).href);

await glyph.init();
const fontBytes = await readFile(
  new URL('../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url),
);
const font = await loadFont({ baked: { bytes: fontBytes } }, bitmap({ strikes: [16] }));
let nextHandle = 1;

function mount(texts, properties = {}) {
  const handle = glyph.handle(`three:preparation-spans:${String(nextHandle++)}`, ThreeConfig);
  const scene = new THREE.Scene();
  const group = handle.createTextGroup();
  scene.add(group);
  const nodes = texts.map((text) => {
    const node = handle.createText({ font, style: { fontSize: 6 }, text, ...properties });
    group.add(node);
    return node;
  });
  return { handle, scene, group, nodes, frame: () => scene.updateMatrixWorld(true), dispose: () => handle.dispose() };
}

const labels = (count, prefix) => Array.from({ length: count }, (_, index) => `${prefix} ${String(index)}`);
const median = (values) => values.toSorted((left, right) => left - right)[values.length >> 1];
const rows = [];

/**
 * Times `operation(step)` over `repetitions` after `reset(step)` ran untimed. `step` alternates so every
 * repetition changes something. Crossings are counted on one extra repetition.
 */
function measure(name, span, repetitions, reset, operation) {
  for (let step = 0; step < 3; step += 1) {
    reset(step);
    operation(step);
  }
  const samples = [];
  for (let step = 3; step < repetitions + 3; step += 1) {
    reset(step);
    const start = performance.now();
    operation(step);
    samples.push(performance.now() - start);
  }
  reset(repetitions + 3);
  const crossings = crossingsOf(() => operation(repetitions + 3));
  rows.push({ name, span, microseconds: Math.round(median(samples) * 1000 * 10) / 10, crossings });
}

/** Registers the three spans of one setter-ending operation over one mounted root. */
function spans(name, repetitions, mounted, set, read) {
  const settle = () => {
    mounted.frame();
  };
  measure(name, 'setter', repetitions, settle, (step) => set(step));
  measure(name, 'setter + read', repetitions, settle, (step) => {
    set(step);
    read();
  });
  measure(name, 'setter + frame', repetitions, settle, (step) => {
    set(step);
    mounted.frame();
  });
}

for (const count of [1, 100, 1_000]) {
  const mounted = mount(labels(count, 'Label'));
  mounted.frame();
  spans(
    `first set, ${String(count)} labels`,
    31,
    mounted,
    (step) => {
      mounted.nodes[0].text = `Value ${String(step)}`;
    },
    () => mounted.nodes[0].measure(),
  );
  spans(
    `overwrite before publication, ${String(count)} labels`,
    31,
    mounted,
    (step) => {
      mounted.nodes[0].text = `Discarded ${String(step)}`;
      mounted.nodes[0].text = `Kept ${String(step)}`;
    },
    () => mounted.nodes[0].measure(),
  );
  mounted.dispose();
}

for (const count of [64, 256, 512, 1_024]) {
  const mounted = mount(labels(count, 'Label'));
  mounted.frame();
  spans(
    count === 1_024 ? 'publish 1,024 labels' : `rewrite ${String(count)} labels`,
    count >= 512 ? 9 : 15,
    mounted,
    (step) => {
      for (let index = 0; index < count; index += 1) mounted.nodes[index].text = `R${String(step)} ${String(index)}`;
    },
    () => {
      for (const node of mounted.nodes) node.measure();
    },
  );
  mounted.dispose();
}

for (const count of [10, 100, 1_000]) {
  const mounted = mount(labels(count, 'Label'));
  mounted.frame();
  spans(
    `colour only, ${String(count)} labels`,
    31,
    mounted,
    (step) => {
      mounted.nodes[0].style = { fontSize: 6, color: step % 2 === 0 ? '#ff0000' : '#00ff00' };
    },
    () => mounted.nodes[0].measure(),
  );
  mounted.dispose();
}

{
  const sentence = 'The quick brown fox jumps over the lazy dog. ';
  const base = sentence.repeat(110);
  const middle = base.length >> 1;
  const inserted = `${base.slice(0, middle)}x${base.slice(middle)}`;
  const mounted = mount([base], { constraints: { width: { mode: 'exact', size: 400 } } });
  const [node] = mounted.nodes;
  const direction = (name, before, after) => {
    const reset = () => {
      node.text = before;
      mounted.frame();
      node.measure();
    };
    measure(name, 'setter', 15, reset, () => {
      node.text = after;
    });
    measure(name, 'setter + read', 15, reset, () => {
      node.text = after;
      node.measure();
    });
    measure(name, 'setter + frame', 15, reset, () => {
      node.text = after;
      mounted.frame();
    });
  };
  direction(`type one character, insert (${String(base.length)} units)`, base, inserted);
  direction(`type one character, restore (${String(base.length)} units)`, inserted, base);
  mounted.dispose();
}

{
  const mounted = mount(labels(1_000, 'Label'));
  mounted.frame();
  const edits = 100;
  const settle = () => mounted.frame();
  measure('interleaved edit-read-publish, 1,000 labels, 100 edits', 'setter', 9, settle, (step) => {
    for (let index = 0; index < edits; index += 1) mounted.nodes[index].text = `E${String(step)} ${String(index)}`;
  });
  measure('interleaved edit-read-publish, 1,000 labels, 100 edits', 'setter + read', 9, settle, (step) => {
    for (let index = 0; index < edits; index += 1) {
      mounted.nodes[index].text = `E${String(step)} ${String(index)}`;
      mounted.nodes[index].measure();
    }
  });
  measure('interleaved edit-read-publish, 1,000 labels, 100 edits', 'setter + frame', 9, settle, (step) => {
    for (let index = 0; index < edits; index += 1) {
      mounted.nodes[index].text = `E${String(step)} ${String(index)}`;
      glyph.shape();
      mounted.nodes[index].measureGlyphs();
    }
  });
  mounted.dispose();
}

for (const count of [100, 200, 400, 800, 1_600, 2_000]) {
  const repetitions = count >= 800 ? 3 : 7;
  let mounted;
  const reset = () => {
    mounted?.dispose();
    mounted = undefined;
  };
  const texts = labels(count, 'Label');
  measure(`mount ${String(count)} labels`, 'setter', repetitions, reset, () => {
    mounted = mount(texts);
  });
  measure(`mount ${String(count)} labels`, 'setter + read', repetitions, reset, () => {
    mounted = mount(texts);
    for (const node of mounted.nodes) node.measure();
  });
  measure(`mount ${String(count)} labels`, 'setter + frame', repetitions, reset, () => {
    mounted = mount(texts);
    mounted.frame();
  });
  reset();
}

const json = args.get('--json');
if (json !== undefined) await writeFile(json, JSON.stringify(rows, undefined, 2));
for (const row of rows) {
  process.stdout.write(
    `${row.name.padEnd(58)} ${row.span.padEnd(15)} ${String(row.microseconds).padStart(11)} us  ${JSON.stringify(row.crossings)}\n`,
  );
}
