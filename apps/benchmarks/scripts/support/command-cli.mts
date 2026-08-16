import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const applicationRoot = fileURLToPath(new URL('../..', import.meta.url));

export function isMainModule(metaUrl: string): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && metaUrl === pathToFileURL(entryPath).href;
}

export async function runNodeScript(script: string, arguments_: readonly string[] = []): Promise<void> {
  await run(process.execPath, [script, ...arguments_]);
}

export async function runVitexec(arguments_: readonly string[]): Promise<void> {
  await runNodeScript('node_modules/vitexec/dist/cli.js', arguments_);
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
