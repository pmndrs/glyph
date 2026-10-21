import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertLabsResultHasNoErrors, assertLabsSamplingPolicy, type LabsSamplingPolicy } from './labs-result.mts';

const harnessPaths = [
  ':(top)benches/labs',
  ':(top)benches/labs.config.ts',
  ':(top)benches/fixtures',
  ':(top)benches/src',
  ':(top)benches/package.json',
  ':(top)benches/scripts/run-package-labs.mts',
  ':(top)benches/scripts/support/labs-result.mts',
  ':(top)benches/scripts/support/saved-package-labs.mts',
  ':(top)pnpm-lock.yaml',
  ':(top)pnpm-workspace.yaml',
  ':(top)patches/@pmndrs__labs@0.9.0.patch',
];
const inspectorPaths = new Set([
  'benches/labs/package/edit-sized-publication.profile.mts',
  'benches/labs/package/adapter-publication.profile.mts',
]);

/** Fingerprints actual timing inputs, including uncommitted edits and hydrated LFS fixtures. */
export function packageLabsHarnessDigest(): string {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const names = execFileSync(
    'git',
    ['ls-files', '--full-name', '--cached', '--others', '--exclude-standard', '-z', '--', ...harnessPaths],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const digest = createHash('sha256');
  const scratch = Buffer.allocUnsafe(64 * 1024);
  for (const path of [...new Set(names.split('\0'))].sort()) {
    if (path === '' || inspectorPaths.has(path)) continue;
    digest.update(`${path}\0`);
    let descriptor: number;
    try {
      descriptor = openSync(resolve(root, path), 'r');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        digest.update('missing\0');
        continue;
      }
      throw error;
    }
    try {
      digest.update('file\0');
      const content = createHash('sha256');
      let length: number;
      while ((length = readSync(descriptor, scratch)) !== 0) content.update(scratch.subarray(0, length));
      digest.update(content.digest());
    } finally {
      closeSync(descriptor);
    }
  }
  return digest.digest('hex');
}

/** Saved timings belong to an exact artifact, suite and environment, never just a package version. */
export function validateSavedPackageLabs(
  manifest: unknown,
  result: unknown,
  expected: {
    readonly version: string;
    readonly sha256?: string;
    readonly suite: string;
    readonly blocks: number;
    readonly samplingPolicy: LabsSamplingPolicy;
  },
): void {
  if (!isRecord(manifest) || !isRecord(manifest.candidate) || !isRecord(result)) {
    throw new Error('Saved candidate must include its original manifest and result');
  }
  if (Object.hasOwn(manifest, 'profiling')) {
    throw new Error('Diagnostic profiling results cannot be reused as ordinary performance timings');
  }
  if (
    manifest.labsVersion !== '0.9.0' ||
    manifest.suite !== expected.suite ||
    manifest.blocks !== expected.blocks ||
    manifest.samplingPolicy !== expected.samplingPolicy ||
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
  assertLabsSamplingPolicy(result, expected.samplingPolicy, expected.blocks);
  if (expected.samplingPolicy === 'single-call' && !Object.hasOwn(manifest, 'harnessDigest')) {
    throw new Error('Fixed-policy saved candidate requires a matching benchmark harness digest');
  }
  if (Object.hasOwn(manifest, 'harnessDigest')) {
    if (
      typeof manifest.harnessDigest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(manifest.harnessDigest) ||
      manifest.harnessDigest !== packageLabsHarnessDigest()
    )
      throw new Error('Benchmark harness digest changed since the saved candidate; timings are not comparable');
    return;
  }
  if (!isRecord(result.git) || typeof result.git.commit !== 'string' || !/^[a-f0-9]{40}$/u.test(result.git.commit)) {
    throw new Error('Saved candidate lacks an exact harness commit');
  }
  const changed = execFileSync('git', ['diff', '--name-only', result.git.commit, '--', ...harnessPaths], {
    encoding: 'utf8',
  });
  assertPackageLabsHarnessUnchanged(changed);
}

/** Standalone inspector entry points are not discovered or imported by the Labs benchmark suite. */
export function assertPackageLabsHarnessUnchanged(changed: string): void {
  const inputs = changed.split('\n').filter((path) => path !== '' && !inspectorPaths.has(path));
  if (inputs.length !== 0)
    throw new Error('Benchmark harness changed since the saved candidate; timings are not comparable');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
