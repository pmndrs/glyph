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
const portlessUrl = process.env.PORTLESS_URL;
let routeCheck: Promise<string | undefined> | undefined;
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk: string) => {
  output += chunk;
  process.stdout.write(chunk);
  if (portlessUrl !== undefined && routeCheck === undefined && output.includes('[log] msdf:')) {
    // The first format has settled, so Vitexec's Vite server is listening while this request runs.
    routeCheck = checkPortlessRoute(portlessUrl).then(
      () => undefined,
      (error: unknown) => String(error),
    );
  }
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

if (portlessUrl !== undefined) {
  if (routeCheck === undefined) {
    process.stderr.write('Portless route was not checked before the live probe finished\n');
    process.exit(1);
  }
  const routeError = await routeCheck;
  if (routeError !== undefined) {
    process.stderr.write(`Portless route did not serve the Tres playground: ${routeError}\n`);
    process.exit(1);
  }
  process.stdout.write(`portless-route-ok ${portlessUrl}\n`);
}

async function checkPortlessRoute(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !(await response.text()).includes('<div id="app"></div>')) {
    throw new Error(`unexpected response from ${url} (${String(response.status)})`);
  }
}
