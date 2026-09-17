import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  harfBuzzReleases,
  installHarfBuzzBundle,
  isPinnedHarfBuzzExecutable,
  type HarfBuzzUtility,
  type HarfBuzzVersion,
} from '../src/tooling/harfbuzz-bundle.ts';

const versionArgument = process.argv.find((argument) => argument.startsWith('--version='));
const requestedVersion = versionArgument?.slice('--version='.length) ?? '13.0.0';
if (!(requestedVersion in harfBuzzReleases)) {
  throw new Error(`unsupported HarfBuzz utility version ${requestedVersion}`);
}
const version = requestedVersion as HarfBuzzVersion;
const cacheDirectory = resolve('.cache/harfbuzz', version);
const utilityDirectory = resolve(cacheDirectory, 'build/util');
const executable = resolve(utilityDirectory, 'hb-shape');

if (await hasPinnedUtilities(utilityDirectory, version)) {
  process.stdout.write(`${executable}\n`);
  process.exit(0);
}
if (process.argv.includes('--check')) {
  throw new Error(`pinned HarfBuzz ${version} utilities are not provisioned under ${cacheDirectory}`);
}
await installHarfBuzzBundle({
  bundleRoot: fileURLToPath(new URL('../vendor/harfbuzz', import.meta.url)),
  cacheDirectory,
  version,
});
process.stdout.write(`${executable}\n`);

async function hasPinnedUtilities(directory: string, expectedVersion: HarfBuzzVersion): Promise<boolean> {
  return (
    await Promise.all(
      (['hb-shape', 'hb-subset', 'hb-info'] as const satisfies readonly HarfBuzzUtility[]).map((utility) =>
        isPinnedHarfBuzzExecutable(resolve(directory, utility), utility, expectedVersion),
      ),
    )
  ).every(Boolean);
}
/* @workflow { "name": "fixture:harfbuzz:provision", "summary": "Provision authenticated vendored HarfBuzz command-line tools. Pass --version=<13.0.0|14.2.0>; the default is 13.0.0.", "requirements": "A supported Linux or macOS platform and Git LFS assets.", "writes": "Ignored HarfBuzz tool cache." } */
/* @workflow { "name": "fixture:harfbuzz:check", "summary": "Verify the provisioned HarfBuzz command-line tools.", "requirements": "Previously provisioned HarfBuzz tools.", "writes": "Nothing.", "args": ["--check"] } */
