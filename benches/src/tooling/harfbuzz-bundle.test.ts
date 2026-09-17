import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  harfBuzzBundleTarget,
  harfBuzzReleases,
  installHarfBuzzBundle,
  verifyHarfBuzzBundle,
  type HarfBuzzVersion,
} from './harfbuzz-bundle';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('HarfBuzz vendor bundle', () => {
  it('selects only the checked platform and architecture combinations', () => {
    expect(harfBuzzBundleTarget('darwin', 'arm64')).toBe('darwin-arm64');
    expect(harfBuzzBundleTarget('linux', 'x64')).toBe('linux-x64');
    expect(() => harfBuzzBundleTarget('darwin', 'x64')).toThrow(/no vendored HarfBuzz utilities/u);
    expect(() => harfBuzzBundleTarget('linux', 'arm64')).toThrow(/no vendored HarfBuzz utilities/u);
    expect(() => harfBuzzBundleTarget('win32', 'x64')).toThrow(/no vendored HarfBuzz utilities/u);
  });

  it('verifies hashes and utility versions before installing the cache layout', async () => {
    const fixture = await createBundle();
    const cacheDirectory = resolve(fixture.root, 'cache', fixture.version);

    await expect(
      installHarfBuzzBundle({
        bundleRoot: fixture.bundleRoot,
        cacheDirectory,
        version: fixture.version,
        platform: 'linux',
        arch: 'x64',
      }),
    ).resolves.toMatchObject({ manifest: { harfBuzzVersion: fixture.version } });

    await expect(readFile(resolve(cacheDirectory, 'build/util/hb-shape'), 'utf8')).resolves.toContain(
      'hb-shape (HarfBuzz) 14.2.0',
    );
  });

  it('authenticates both checked bundles for the current supported platform', async () => {
    const bundleRoot = fileURLToPath(new URL('../../vendor/harfbuzz', import.meta.url));
    for (const version of ['13.0.0', '14.2.0'] as const) {
      await expect(verifyHarfBuzzBundle({ bundleRoot, version })).resolves.toMatchObject({
        manifest: { harfBuzzVersion: version },
      });
    }
  });

  it('rejects a manifest for a different HarfBuzz version', async () => {
    const fixture = await createBundle({ manifestVersion: '13.0.0' });

    await expect(
      verifyHarfBuzzBundle({
        bundleRoot: fixture.bundleRoot,
        version: fixture.version,
        platform: 'linux',
        arch: 'x64',
      }),
    ).rejects.toThrow(/version mismatch/u);
  });

  it('rejects missing and corrupt bundle assets', async () => {
    const missing = await createBundle({ omitUtility: 'hb-info' });
    await expect(
      verifyHarfBuzzBundle({
        bundleRoot: missing.bundleRoot,
        version: missing.version,
        platform: 'linux',
        arch: 'x64',
      }),
    ).rejects.toThrow(/missing HarfBuzz bundle file bin\/hb-info/u);

    const corrupt = await createBundle();
    await writeFile(resolve(corrupt.directory, 'bin/hb-subset'), 'corrupt');
    await expect(
      verifyHarfBuzzBundle({
        bundleRoot: corrupt.bundleRoot,
        version: corrupt.version,
        platform: 'linux',
        arch: 'x64',
      }),
    ).rejects.toThrow(/size mismatch|SHA-256 mismatch/u);
  });
});

async function createBundle(
  options: {
    readonly manifestVersion?: HarfBuzzVersion;
    readonly omitUtility?: 'hb-info' | 'hb-shape' | 'hb-subset';
  } = {},
) {
  const root = await mkdtemp(resolve(tmpdir(), 'glyph-harfbuzz-bundle-'));
  temporaryDirectories.push(root);
  const version = '14.2.0' as const;
  const bundleRoot = resolve(root, 'vendor');
  const directory = resolve(bundleRoot, version, 'linux-x64');
  await mkdir(resolve(directory, 'bin'), { recursive: true });
  await mkdir(resolve(directory, 'licenses'), { recursive: true });

  const files: Array<{ executable: boolean; path: string; sha256: string; size: number }> = [];
  for (const utility of ['hb-shape', 'hb-subset', 'hb-info'] as const) {
    const contents = `#!/bin/sh\nprintf '%s\\n' '${utility} (HarfBuzz) ${version}'\n`;
    const path = `bin/${utility}`;
    if (utility !== options.omitUtility) {
      await writeFile(resolve(directory, path), contents);
      await chmod(resolve(directory, path), 0o755);
    }
    files.push(fileRecord(path, contents, true));
  }
  const license = 'HarfBuzz test license';
  await writeFile(resolve(directory, 'licenses/HarfBuzz-COPYING.txt'), license);
  files.push(fileRecord('licenses/HarfBuzz-COPYING.txt', license, false));

  const manifestVersion = options.manifestVersion ?? version;
  await writeFile(
    resolve(directory, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        harfBuzzVersion: manifestVersion,
        target: { platform: 'linux', arch: 'x64' },
        source: {
          archiveSha256: harfBuzzReleases[manifestVersion].sourceArchiveSha256,
          commit: harfBuzzReleases[manifestVersion].sourceCommit,
        },
        files,
      },
      null,
      2,
    )}\n`,
  );
  return { bundleRoot, directory, root, version };
}

function fileRecord(path: string, contents: string, executable: boolean) {
  return {
    executable,
    path,
    sha256: createHash('sha256').update(contents).digest('hex'),
    size: Buffer.byteLength(contents),
  };
}
