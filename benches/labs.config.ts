import { defineConfig } from '@pmndrs/labs';

const cpuProfileOutput = process.env.GLYPH_LABS_CPU_PROFILE_OUTPUT;
const samplingPolicy = process.env.GLYPH_LABS_SAMPLING_POLICY;
const warmupPolicy = process.env.GLYPH_LABS_WARMUP_POLICY;
if (warmupPolicy !== undefined && warmupPolicy !== 'conditional' && warmupPolicy !== 'fixed-20') {
  throw new Error(`Invalid GLYPH_LABS_WARMUP_POLICY: ${warmupPolicy}`);
}
if (samplingPolicy !== undefined && samplingPolicy !== 'adaptive' && samplingPolicy !== 'single-call') {
  throw new Error(`Invalid GLYPH_LABS_SAMPLING_POLICY: ${samplingPolicy}`);
}

export default defineConfig({
  benchDir: './labs',
  resultsDir: '.cache/labs-store',
  blocks: 8,
  blockTime: 0.5,
  minSamples: 20,
  samplingPolicy: samplingPolicy ?? 'adaptive',
  warmupPolicy: warmupPolicy ?? 'conditional',
  alpha: 0.05,
  minDelta: 0.05,
  ...(cpuProfileOutput === undefined
    ? {}
    : { nodeFlags: ['--allow-natives-syntax', '--expose-gc', '--cpu-prof', `--cpu-prof-dir=${cpuProfileOutput}`] }),
});
