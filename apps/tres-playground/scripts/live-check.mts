import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// No `--gpu`: it exposes `navigator.gpu` where no adapter backs it and WebGPURenderer then skips its WebGL2 fallback.
// `vitexec` exits 0 even after a browser exception, so the probe prints a marker as its last statement.
const applicationRoot = fileURLToPath(new URL('..', import.meta.url));
const probe = { file: './scripts/live-check.probe.ts', marker: 'tres-playground-live-ok', path: '/' } as const;

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitexec', '--path', probe.path, probe.file, ...process.argv.slice(2)],
  { cwd: applicationRoot, stdio: ['inherit', 'pipe', 'inherit'] },
);

let output = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk: string) => {
  output += chunk;
  process.stdout.write(chunk);
});

const code = await new Promise<number>((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (value: number | null) => resolve(value ?? 1));
});

if (code !== 0) {
  process.stderr.write(`vitexec exited with ${String(code)}\n`);
  process.exit(code);
}

if (!output.includes(probe.marker)) {
  process.stderr.write(
    `live probe did not report ${probe.marker}; it threw or exited early, and vitexec reported success anyway\n`,
  );
  process.exit(1);
}
