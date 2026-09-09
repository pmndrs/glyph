import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// `vitexec --gpu` is deliberately not used. It passes `--enable-unsafe-webgpu`, which exposes
// `navigator.gpu` even where no adapter can back it; `WebGPURenderer` then believes WebGPU is
// available, never takes its supported WebGL2 fallback, and dies on the first allocation against a
// device that reports zeroed limits. Without the flag the renderer picks the backend it can
// actually use: WebGPU on a machine that has it, WebGL2 on a runner that does not. The probe
// reports which one it got, so the choice is stated rather than assumed.

/** `vitexec` exits 0 even after a browser exception, so each probe must print its `marker` as the last statement to prove success rather than mere completion. */
const applicationRoot = fileURLToPath(new URL('..', import.meta.url));
const probes = [
  { file: './scripts/live-check.probe.ts', marker: 'r3f-hello-world-live-ok', path: '/?example=r3f' },
  { file: './scripts/three-live-check.probe.ts', marker: 'three-hello-world-live-ok', path: '/?example=three' },
] as const;

for (const probe of probes) {
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
    process.stderr.write(`vitexec exited with ${String(code)} for ${probe.path}\n`);
    process.exit(code);
  }

  if (!output.includes(probe.marker)) {
    process.stderr.write(
      `live probe did not report ${probe.marker}; it threw or exited early, and vitexec reported success anyway\n`,
    );
    process.exit(1);
  }
}
