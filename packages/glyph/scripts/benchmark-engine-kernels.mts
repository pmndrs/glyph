/* @workflow {
  "name": "glyph:kernel-lab",
  "summary": "Compares scalar, auto-vectorized, and explicit SIMD retained-engine kernels over real paragraph arrays.",
  "requirements": "Built package and glyph:kernel-lab-build artifacts. Accepts --json.",
  "writes": "stdout only, or the JSON report path passed to --json"
} */
import { readFile, writeFile } from 'node:fs/promises';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

import { captureKernelWorkloads } from './support/engine-kernel-fixture.mts';
import { benchmarkKernelArtifact } from './support/engine-kernel-runner.mjs';

const ARTIFACT_ROOT = new URL('../rust/shaper/target/kernel-lab/', import.meta.url);
const VARIANTS = ['scalar', 'auto', 'explicit'] as const;
const TARGET_GLYPHS = [22_000, 86_000] as const;
const WARMUP = 40;
const SAMPLES = 101;

const workloads = await captureKernelWorkloads(TARGET_GLYPHS);

const variants = [];
let oracleHashes: ReadonlyMap<string, string> | undefined;
for (const name of VARIANTS) {
  const wasm = await readFile(new URL(`${name}.wasm`, ARTIFACT_ROOT));
  const wat = await readFile(new URL(`${name}.wat`, ARTIFACT_ROOT), 'utf8');
  const workloadReports = [];
  const hashes = new Map<string, string>();
  for (const workload of workloads) {
    const report = await benchmarkKernelArtifact(wasm, name, workload, { warmup: WARMUP, samples: SAMPLES });
    workloadReports.push(report);
    hashes.set(workload.label, report.outputHash);
  }
  if (oracleHashes === undefined) oracleHashes = hashes;
  else {
    for (const [label, hash] of hashes) {
      if (hash !== oracleHashes.get(label)) {
        throw new Error(`${name} output ${hash} does not match scalar oracle ${oracleHashes.get(label)} for ${label}`);
      }
    }
  }
  variants.push({
    name,
    rawBytes: wasm.byteLength,
    brotliBytes: brotliCompressSync(wasm, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    instructions: {
      v128Loads: matches(wat, /\bv128\.load\b/g),
      v128Stores: matches(wat, /\bv128\.store\b/g),
      f32x4: matches(wat, /\bf32x4\.[a-z_]+\b/g),
      bitmasks: matches(wat, /\bi8x16\.bitmask\b/g),
      shuffles: matches(wat, /\bi8x16\.shuffle\b/g),
      i64x2: matches(wat, /\bi64x2\.[a-z_]+\b/g),
    },
    workloads: workloadReports,
  });
}

const report = {
  generatedBy: 'glyph:kernel-lab',
  environment: {
    runtime: `Node ${process.versions.node}`,
    platform: `${process.platform}/${process.arch}`,
    cpu: 'target machine; report with host inventory',
  },
  warmup: WARMUP,
  samples: SAMPLES,
  variants,
};
console.log(JSON.stringify(report, null, 2));
const jsonPath = readArgument('--json');
if (jsonPath !== undefined) await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

function matches(value: string, expression: RegExp): number {
  return value.match(expression)?.length ?? 0;
}

function readArgument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}
