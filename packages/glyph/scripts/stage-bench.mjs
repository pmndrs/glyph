/* @workflow { "name": "glyph:stage-bench", "summary": "Time the run-local geometry stage, the cluster build, positioning and measurement, the engine steps around them and the Unicode and bidi analysis inside the optimized wasm32+simd128 oracle probe.", "requirements": "Pinned Rust through mise and installed package dependencies for wasm-opt. Evidence for a rewrite, not a benchmark protocol: run one at a time on a quiet machine.", "writes": "packages/glyph/rust/shaper/target/stage-bench-wasm, or <CARGO_TARGET_DIR>/pmndrs-glyph/shaper/stage-bench-wasm when it is set; never dist." } */
// Usage:
//   node scripts/stage-bench.mjs [--iterations N] [--rounds N] [--only SUBSTRING] [--save FILE]
//                                [--suite stage|layout|analysis|sweep] [--probe LABEL=FILE]...
// `--suite layout` times positioning and measurement per change class (cold, edit, width change
// with and without moved breaks, alignment change) for each fixture, alignment and size.
// `--suite analysis` times the Unicode and bidi analysis of one paragraph per script, alone.
// `--suite sweep` times the browser headline width sweep (600 to 300 px and back in 4 px steps at
// 8 px type) per fixture and alignment; its rows are the median and the mean step, and
// --iterations is the number of sweeps each step's minimum is taken over.
// With no --probe the current source is built and timed. Each --probe names a saved probe; several are
// timed interleaved, round by round, so two builds can be compared in one session.
import { spawn } from 'node:child_process';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rustTargetDirectory, withRustTarget } from './support/rust-target.mjs';
import { shaperBuildEnvironment, shaperOptimizationArguments } from './support/shaper-build.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const shaperRoot = join(packageRoot, 'rust/shaper');
const probeTarget = rustTargetDirectory('shaper', 'stage-bench-wasm');
const optimizedProbe = join(probeTarget, 'stage-bench.wasm');
const fontRoots = {
  repository: join(workspaceRoot, 'benches/fixtures/fonts'),
  synthetic: join(shaperRoot, 'src/engine/adversarial-fonts'),
  adversarial: process.env.GLYPH_ADVERSARIAL_FONTS,
};
const fonts = [
  ['inter', 'latin'],
  ['fredoka', 'latin'],
  ['amiri', 'arabic'],
  ['devanagari', 'devanagari'],
  ['cjk-jp', 'cjk'],
  // A fallback stack: Inter has no Arabic, so every Arabic run shapes in the second font.
  ['inter+amiri', 'arabic'],
];
const sizes = [1000, 15000, 22000];
const layoutFixtures = ['inter', 'fredoka', 'amiri', 'bidi', 'cjk', 'dropcap', 'exclusion'];
const alignments = ['start', 'center', 'end', 'justify'];
const analysisScripts = [
  'latin',
  'code',
  'greek-cyrillic',
  'cjk',
  'hangul',
  'arabic',
  'hebrew',
  'mixed-bidi',
  'devanagari',
  'thai',
  'emoji',
];
// `<fixture> <align> <UTF-16 units>`: the headline rows first, then the other alignments.
const sweeps = [
  'latin start 15000',
  'latin start 22000',
  'bidi start 15000',
  'cjk start 15000',
  'fredoka start 15000',
  'latin center 15000',
  'latin end 15000',
  'latin justify 15000',
  'bidi justify 15000',
];

const options = { iterations: 40, rounds: 3, only: undefined, save: undefined, suite: 'stage', probes: [] };
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index += 2) {
  const [key, value] = [arguments_[index], arguments_[index + 1]];
  if (value === undefined) throw new Error(`${key} needs a value`);
  if (key === '--iterations') options.iterations = Number(value);
  else if (key === '--rounds') options.rounds = Number(value);
  else if (key === '--only') options.only = value;
  else if (key === '--save') options.save = value;
  else if (key === '--suite') options.suite = value;
  else if (key === '--probe') options.probes.push(value.split('='));
  else throw new Error(`unknown option ${key}`);
}

if (options.probes.length === 0) {
  await buildProbe();
  if (options.save !== undefined) await copyFile(optimizedProbe, options.save);
  options.probes.push(['current', optimizedProbe]);
}
const probes = [];
for (const [label, file] of options.probes) probes.push({ label, probe: await instantiateProbe(file) });

if (!['stage', 'layout', 'analysis', 'sweep'].includes(options.suite))
  throw new Error(`unknown suite ${options.suite}`);
const cases = (
  options.suite === 'sweep'
    ? sweeps.map((sweep) => `sweep ${sweep}`)
    : options.suite === 'analysis'
      ? analysisScripts.flatMap((script) => [1000, 15000].map((size) => `analysis ${script} ${size}`))
      : options.suite === 'layout'
        ? layoutFixtures.flatMap((fixture) =>
            alignments.flatMap((align) => sizes.map((size) => `layout ${fixture} ${align} ${size}`)),
          )
        : [
            ...fonts.flatMap(([font, script]) => sizes.map((size) => `paragraph ${font} ${script} ${size}`)),
            'labels inter latin 200',
          ]
).filter((name) => options.only === undefined || name.includes(options.only));

for (const name of cases) {
  /** metric -> label -> [median, minimum, per glyph] of the round with the lowest minimum. */
  const best = new Map();
  let shape = '';
  for (let round = 0; round < options.rounds; round += 1) {
    for (const { label, probe } of probes) {
      const { status, body } = probe.command(`bench ${name} ${options.iterations}`);
      if (status !== 'ok') throw new Error(`${label}: ${name}: ${body}`);
      for (const line of body.split('\n').filter(Boolean)) {
        const [metric, ...values] = line.split('\t');
        if (metric === 'shape') {
          shape = values.join(' ');
          continue;
        }
        const numbers = values.map(Number);
        const byLabel = best.get(metric) ?? new Map();
        const previous = byLabel.get(label);
        if (previous === undefined || numbers[1] < previous[1]) byLabel.set(label, numbers);
        best.set(metric, byLabel);
      }
    }
  }
  process.stdout.write(`\n${name} (${shape})\n`);
  for (const [metric, byLabel] of best) {
    const cells = probes.map(({ label }) => {
      const [median, minimum, perGlyph] = byLabel.get(label);
      return `${label} ${median.toFixed(1)} / ${minimum.toFixed(1)} µs (${perGlyph.toFixed(2)} ns/glyph)`;
    });
    process.stdout.write(`  ${metric.padEnd(30)} ${cells.join('   ')}\n`);
  }
}

async function buildProbe() {
  await run(
    'cargo',
    [
      'build',
      '--manifest-path',
      'rust/shaper/Cargo.toml',
      '--target',
      'wasm32-unknown-unknown',
      '--release',
      '--locked',
      // The shipped shaper's flags make panics trap in place, which needs core and alloc rebuilt.
      '-Zbuild-std=core,alloc',
      '--no-default-features',
      '--features',
      'simd128,stage-bench',
    ],
    withRustTarget(shaperBuildEnvironment(workspaceRoot, probeTarget, true), probeTarget),
  );
  const wasmOpt = join(packageRoot, 'node_modules/.bin', process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt');
  await run(wasmOpt, [
    ...shaperOptimizationArguments(true),
    join(probeTarget, 'wasm32-unknown-unknown/release/pmndrs_glyph_shaper.wasm'),
    '-o',
    optimizedProbe,
  ]);
}

async function instantiateProbe(file) {
  const { instance } = await WebAssembly.instantiate(await readFile(file), {
    env: { pmndrs_glyph_stage_bench_now: () => performance.now() },
  });
  const wasm = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const give = (bytes) => {
    const pointer = wasm.pmndrs_glyph_oracle_alloc(bytes.length) >>> 0;
    new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
    return [pointer, bytes.length];
  };
  const probe = {
    command(line) {
      const pointer = wasm.pmndrs_glyph_oracle_command(...give(encoder.encode(line)), 0, 0) >>> 0;
      const answer = decoder.decode(
        new Uint8Array(wasm.memory.buffer, pointer, wasm.pmndrs_glyph_oracle_answer_length()),
      );
      const split = answer.indexOf('\n');
      return { status: answer.slice(0, split), body: answer.slice(split + 1) };
    },
  };
  for (const line of probe.command('fonts').body.split('\n').filter(Boolean)) {
    const [key, root, path] = line.split(' ');
    const directory = fontRoots[root];
    const bytes = directory === undefined ? undefined : await readFile(join(directory, path)).catch(() => undefined);
    if (bytes === undefined) continue;
    if (wasm.pmndrs_glyph_oracle_font(...give(encoder.encode(key)), ...give(bytes)) !== 0) {
      throw new Error(`the probe rejected font ${key}`);
    }
  }
  return probe;
}

function run(executable, commandArguments, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, commandArguments, { cwd: packageRoot, env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited with ${code ?? signal}`));
    });
  });
}
