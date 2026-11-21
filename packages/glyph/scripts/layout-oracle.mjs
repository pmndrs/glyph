/* @workflow { "name": "glyph:layout-oracle", "summary": "Run the layout correctness oracle: frozen stage reference and seeded incremental-versus-cold differential, natively or inside the optimized wasm32+simd128 build.", "requirements": "Pinned Rust through mise; the wasm probe also needs installed package dependencies for wasm-opt. GLYPH_ADVERSARIAL_FONTS names the fetched adversarial font set; cases whose fonts are absent are skipped and reported.", "writes": "packages/glyph/rust/shaper/target (native) and packages/glyph/rust/shaper/target/oracle-wasm (probe); never dist." } */
// Usage:
//   node scripts/layout-oracle.mjs native <layout-oracle arguments>     e.g. native check --tier quick
//   node scripts/layout-oracle.mjs wasm [--tier quick|full] [--case NAME]... [--set exact] [--seeds N] [--steps N]
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shaperBuildEnvironment, shaperOptimizationArguments } from './support/shaper-build.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const shaperRoot = join(packageRoot, 'rust/shaper');
const probeTarget = join(shaperRoot, 'target/oracle-wasm');
const optimizedProbe = join(probeTarget, 'layout-oracle.wasm');
const fontRoots = {
  repository: join(workspaceRoot, 'benches/fixtures/fonts'),
  synthetic: join(shaperRoot, 'src/engine/adversarial-fonts'),
  adversarial: process.env.GLYPH_ADVERSARIAL_FONTS,
};
// Seeds and requests per run, matching the native tool's tiers.
const tiers = { quick: { seeds: 1, steps: 24 }, full: { seeds: 4, steps: 60 } };

/** How each option's value is stored. */
const optionSetters = {
  '--tier': (parsed, value) => {
    if (!(value in tiers)) throw new Error(`unknown tier ${value}`);
    parsed.tier = value;
  },
  '--case': (parsed, value) => parsed.cases.push(value),
  '--set': (parsed, value) => {
    parsed.set = value;
  },
  '--seeds': (parsed, value) => {
    parsed.seeds = Number(value);
  },
  '--steps': (parsed, value) => {
    parsed.steps = Number(value);
  },
};

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'native') {
  await run('cargo', [
    'run',
    '--manifest-path',
    'rust/shaper/Cargo.toml',
    '--release',
    '--locked',
    '--features',
    'oracle',
    '--bin',
    'layout-oracle',
    '--',
    ...rest,
  ]).catch(() => {
    // The tool has already printed what differed.
    process.exitCode = 1;
  });
} else if (mode === 'wasm') {
  process.exitCode = (await runProbe(options(rest))) ? 0 : 1;
} else {
  throw new Error('usage: layout-oracle.mjs native <arguments> | wasm [--tier quick|full] [--case NAME]...');
}

function options(arguments_) {
  const parsed = { tier: 'quick', cases: [], set: 'exact', seeds: undefined, steps: undefined };
  for (let index = 0; index < arguments_.length; index += 2) {
    const set = optionSetters[arguments_[index]];
    const value = arguments_[index + 1];
    if (set === undefined) throw new Error(`unknown option ${arguments_[index]}`);
    if (value === undefined) throw new Error(`${arguments_[index]} needs a value`);
    set(parsed, value);
  }
  return parsed;
}

/** Builds the probe with the shipped shaper's flags plus the oracle feature, into its own target directory. */
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
      '--no-default-features',
      '--features',
      'simd128,oracle',
    ],
    shaperBuildEnvironment(workspaceRoot, probeTarget, true),
  );
  const wasmOpt = join(packageRoot, 'node_modules/.bin', process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt');
  await run(wasmOpt, [
    ...shaperOptimizationArguments(true),
    join(probeTarget, 'wasm32-unknown-unknown/release/pmndrs_glyph_shaper.wasm'),
    '-o',
    optimizedProbe,
  ]);
}

/** Instantiates the optimized probe and wraps its exports: give bytes, register by name, run a command. */
async function instantiateProbe() {
  const { instance } = await WebAssembly.instantiate(await readFile(optimizedProbe), {});
  const wasm = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  /** Copies bytes into a buffer the probe owns and returns [pointer, length]. */
  const give = (bytes) => {
    const pointer = wasm.pmndrs_glyph_oracle_alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
    return [pointer, bytes.length];
  };
  const register = (kind, exported) => (name, bytes) => {
    if (exported(...give(encoder.encode(name)), ...give(bytes)) !== 0) {
      throw new Error(`the probe rejected ${kind} ${name}`);
    }
  };
  return {
    font: register('font', wasm.pmndrs_glyph_oracle_font),
    file: register('reference file', wasm.pmndrs_glyph_oracle_file),
    command(line, payload = '') {
      const pointer = wasm.pmndrs_glyph_oracle_command(...give(encoder.encode(line)), ...give(encoder.encode(payload)));
      const answer = decoder.decode(
        new Uint8Array(wasm.memory.buffer, pointer, wasm.pmndrs_glyph_oracle_answer_length()),
      );
      const split = answer.indexOf('\n');
      return { status: answer.slice(0, split), body: answer.slice(split + 1) };
    },
  };
}

/** Hands the probe every font it lists that exists on disk; the probe skips and reports the cases of the rest. */
async function loadFonts(probe) {
  for (const line of probe.command('fonts').body.split('\n').filter(Boolean)) {
    const [key, root, path] = line.split(' ');
    const directory = fontRoots[root];
    const bytes = directory === undefined ? undefined : await readFile(join(directory, path)).catch(() => undefined);
    if (bytes !== undefined) probe.font(key, bytes);
  }
}

async function loadReferenceSet(probe, set) {
  const directory = join(shaperRoot, 'tests/oracle/reference', set);
  for (const name of await readdir(directory)) probe.file(name, await readFile(join(directory, name)));
}

async function runProbe({ tier, cases, set, seeds, steps }) {
  await buildProbe();
  const probe = await instantiateProbe();
  await loadFonts(probe);
  await loadReferenceSet(probe, set);
  const budget = `${seeds ?? tiers[tier].seeds} ${steps ?? tiers[tier].steps}`;
  let passed = true;
  for (const [label, line] of [
    ['references', `references ${tier}`],
    ['differential', `differential ${tier} ${budget}`],
  ]) {
    const started = performance.now();
    const { status, body } = probe.command(line, cases.join('\n'));
    process.stdout.write(body);
    process.stdout.write(`wasm32+simd128 ${label}: ${((performance.now() - started) / 1000).toFixed(1)}s\n`);
    passed &&= status === 'ok';
  }
  return passed;
}

function run(executable, arguments_, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { cwd: packageRoot, env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited with ${code ?? signal}`));
    });
  });
}
