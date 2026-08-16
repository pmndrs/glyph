import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const executeFile = promisify(execFile);

/** Builds the replay inspector before parallel test files can contend with its first compilation. */
export default async function prepareBenchmarkUnitTests(): Promise<void> {
  await executeFile('cargo', [
    'build',
    '--manifest-path',
    fileURLToPath(new URL('../../packages/glyph/rust/font-baker/Cargo.toml', import.meta.url)),
    '--bin',
    'inspect-font-fixture',
    '--features',
    'oracle',
    '--locked',
    '--quiet',
  ]);
}
