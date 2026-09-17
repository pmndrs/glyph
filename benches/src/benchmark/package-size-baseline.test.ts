import { describe, expect, it } from 'vitest';
import report from '../generated/package-sizes.json';

import { createPackageSizeBaseline, parsePackageSizeBaseline } from './package-size-baseline';

const commit = '1'.repeat(40);

describe('package-size baseline artifact', () => {
  it('binds a report to one exact commit', () => {
    const artifact = createPackageSizeBaseline(commit, report);
    expect(parsePackageSizeBaseline(artifact, commit)).toEqual(artifact);
  });

  it('rejects a baseline from another commit', () => {
    const artifact = createPackageSizeBaseline(commit, report);
    expect(() => parsePackageSizeBaseline(artifact, '2'.repeat(40))).toThrow(/does not describe commit/);
  });

  it('rejects invalid measurement bytes from a downloaded report', () => {
    const invalid = structuredClone(report);
    const entry = invalid.entries.find((entry) => entry.id === 'browser-core')!;
    entry.gzipBytes = -1;
    expect(() => createPackageSizeBaseline(commit, invalid)).toThrow(/positive measured gzip/);
  });

  it('rejects malformed commit identities and reports', () => {
    expect(() => createPackageSizeBaseline('main', report)).toThrow(/invalid/);
    expect(() => createPackageSizeBaseline(commit, {})).toThrow(/report with entries/);
  });
});
