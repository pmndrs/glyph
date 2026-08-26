import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = join(packageRoot, 'dist');

await rm(outputRoot, { recursive: true, force: true });
await run('pnpm', ['exec', 'tsc', '-p', join(packageRoot, 'tsconfig.build.json')]);

const typegpuOutput = join(packageRoot, 'dist/typegpu.js');
const { default: typegpuPlugin } = await import('unplugin-typegpu/rollup');
const plugin = typegpuPlugin();
const source = await readFile(typegpuOutput, 'utf8');
if (source.includes('use gpu')) {
  const transformed = await plugin.transform.handler.call({}, source, typegpuOutput);
  if (transformed && typeof transformed.code === 'string') await writeFile(typegpuOutput, transformed.code);
  const output = transformed?.code ?? source;
  if (output.includes('use gpu') && !output.includes('__TYPEGPU_META__')) {
    throw new Error('dist/typegpu.js contains untransformed TypeGPU directives without compiler metadata');
  }
}

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
