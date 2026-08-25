import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { embedTypeGpuMetadataFiles } from '../../glyph/scripts/support/embed-typegpu-metadata.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = join(packageRoot, 'dist');

await rm(outputRoot, { recursive: true, force: true });
await run('pnpm', ['exec', 'tsc', '-p', join(packageRoot, 'tsconfig.build.json')]);

const typegpuOutput = join(packageRoot, 'dist/typegpu.js');
await embedTypeGpuMetadataFiles([typegpuOutput]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: packageRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}
