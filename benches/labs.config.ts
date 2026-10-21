import { defineConfig } from '@pmndrs/labs';

const cpuProfileOutput = process.env.GLYPH_LABS_CPU_PROFILE_OUTPUT;
const samplingPolicy = process.env.GLYPH_LABS_SAMPLING_POLICY;
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
  alpha: 0.05,
  minDelta: 0.05,
  ...(cpuProfileOutput === undefined
    ? {}
    : { nodeFlags: ['--allow-natives-syntax', '--expose-gc', '--cpu-prof', `--cpu-prof-dir=${cpuProfileOutput}`] }),
});
