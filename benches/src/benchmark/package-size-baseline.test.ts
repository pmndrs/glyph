import { describe, expect, it } from 'vitest';

import { createPackageSizeBaseline, parsePackageSizeBaseline } from './package-size-baseline';

const commit = '1'.repeat(40);
const report = {
  schemaVersion: 1,
  measurementHost: { platform: 'linux', architecture: 'x64' },
  entries: [{ id: 'browser-core', status: 'measured' }],
};

describe('package-size baseline artifact', () => {
  it('binds a report to one exact commit', () => {
    const artifact = createPackageSizeBaseline(commit, report);
    expect(parsePackageSizeBaseline(artifact, commit)).toEqual(artifact);
  });

  it('rejects a baseline from another commit', () => {
    const artifact = createPackageSizeBaseline(commit, report);
    expect(() => parsePackageSizeBaseline(artifact, '2'.repeat(40))).toThrow(/does not describe commit/);
  });

  it('rejects malformed commit identities and reports', () => {
    expect(() => createPackageSizeBaseline('main', report)).toThrow(/invalid/);
    expect(() => createPackageSizeBaseline(commit, {})).toThrow(/unknown schema/);
  });
});
