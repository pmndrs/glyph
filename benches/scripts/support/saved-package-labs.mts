import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';

import { assertLabsResultHasNoErrors } from './labs-result.mts';

/** Saved timings belong to an exact artifact, suite and environment, never just a package version. */
export function validateSavedPackageLabs(
  manifest: unknown,
  result: unknown,
  expected: { readonly version: string; readonly sha256?: string; readonly suite: string; readonly blocks: number },
): void {
  if (!isRecord(manifest) || !isRecord(manifest.candidate) || !isRecord(result)) {
    throw new Error('Saved candidate must include its original manifest and result');
  }
  if (
    manifest.labsVersion !== '0.9.0' ||
    manifest.suite !== expected.suite ||
    manifest.blocks !== expected.blocks ||
    result.blocks !== expected.blocks ||
    manifest.candidate.version !== expected.version ||
    expected.sha256 === undefined ||
    manifest.candidate.sha256 !== expected.sha256
  ) {
    throw new Error('Saved candidate artifact, suite, blocks or Labs version does not match');
  }
  if (
    !isRecord(result.hardware) ||
    !isRecord(result.context) ||
    result.hardware.cpu !== cpus()[0]?.model.trim() ||
    result.hardware.arch !== `${process.arch}-${process.platform}` ||
    result.hardware.runtime !== 'node' ||
    result.context.version !== process.versions.node
  ) {
    throw new Error('Saved candidate CPU, architecture or Node version differs; do not compare cross-machine timings');
  }
  assertLabsResultHasNoErrors(result);
  if (!isRecord(result.git) || typeof result.git.commit !== 'string' || !/^[a-f0-9]{40}$/u.test(result.git.commit)) {
    throw new Error('Saved candidate lacks an exact harness commit');
  }
  const changed = execFileSync(
    'git',
    [
      'diff',
      '--name-only',
      result.git.commit,
      '--',
      ':(top)benches/labs',
      ':(top)benches/labs.config.ts',
      ':(top)benches/fixtures',
      ':(top)benches/src',
      ':(top)benches/package.json',
      ':(top)pnpm-lock.yaml',
    ],
    { encoding: 'utf8' },
  );
  if (changed.trim() !== '')
    throw new Error('Benchmark harness changed since the saved candidate; timings are not comparable');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
