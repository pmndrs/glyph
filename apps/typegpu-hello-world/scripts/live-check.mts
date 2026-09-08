/* @workflow {
  "name": "typegpu:live-check",
  "summary": "Verify raster rendering, GPU callbacks, bind groups, depth, updates and disposal on WebGPU.",
  "requirements": "Workspace dependencies, built Glyph, project Chromium and WebGPU.",
  "writes": "Vite cache and stdout"
} */
import { spawn, execFileSync } from 'node:child_process';
execFileSync('pnpm', ['build'], { stdio: 'inherit' });
const child = spawn(
  'pnpm',
  ['exec', 'vitexec', '--gpu', '--path', '/', './scripts/live-check.probe.ts', ...process.argv.slice(2)],
  { stdio: ['inherit', 'pipe', 'pipe'] },
);
let output = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (data: Buffer) => {
    const chunk = data.toString();
    output += chunk;
    process.stdout.write(chunk);
  });
const code = await new Promise<number>((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (value) => resolve(value ?? 1));
});
if (code !== 0 || output.includes('[error]') || !output.includes('typegpu-hello-world-live-ok')) process.exit(1);
