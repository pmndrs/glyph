import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * `vitexec` prints a browser exception and still exits 0, so a throwing probe passes the gate it
 * exists to enforce. The probe reports success by printing this marker as its last statement;
 * requiring it turns "the probe ran" into "the probe succeeded".
 */
const successMarker = 'r3f-hello-world-live-ok';
const applicationRoot = fileURLToPath(new URL('..', import.meta.url));

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitexec', '--gpu', './scripts/live-check.probe.ts', ...process.argv.slice(2)],
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

if (!output.includes(successMarker)) {
  process.stderr.write(
    `live probe did not report ${successMarker}; it threw or exited early, and vitexec reported success anyway\n`,
  );
  process.exit(1);
}
