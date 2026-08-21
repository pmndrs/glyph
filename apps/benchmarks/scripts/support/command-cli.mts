import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hasVitexecFailure } from '../workflow-output.mts';

const applicationRoot = fileURLToPath(new URL('../..', import.meta.url));

export function isMainModule(metaUrl: string): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && metaUrl === pathToFileURL(entryPath).href;
}

export async function runNodeScript(script: string, arguments_: readonly string[] = []): Promise<void> {
  await run(process.execPath, [script, ...arguments_]);
}

export async function runVitexec(arguments_: readonly string[]): Promise<void> {
  const probe = arguments_.find((value) => value.endsWith('.probe.ts')) ?? 'probe';
  const output = await runCapturing(process.execPath, ['node_modules/vitexec/dist/cli.js', ...arguments_]);
  // Vitexec exits 0 even when the injected module throws, so the exit status alone passes a probe
  // that never ran to completion.
  if (hasVitexecFailure(output)) throw new Error(`${probe} reported a browser error`);
}

export async function runCapturing(command: string, arguments_: readonly string[]): Promise<string> {
  return await new Promise<string>((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd: applicationRoot, stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        output += chunk;
        process.stdout.write(chunk);
      });
    }
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) resolveRun(output);
      else reject(new Error(`${command} exited with ${String(code)}`));
    });
  });
}

export async function buildRuntimePackages(): Promise<void> {
  await runPnpm(['--filter', '@pmndrs/glyph', 'build']);
}

export async function runPnpm(arguments_: readonly string[]): Promise<void> {
  await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', arguments_);
}

export async function run(command: string, arguments_: readonly string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd: applicationRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${String(code)}`));
    });
  });
}
