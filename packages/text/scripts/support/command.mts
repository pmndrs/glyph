import { spawn } from 'node:child_process';
import { globSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

export function isMainModule(metaUrl: string): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && metaUrl === pathToFileURL(entryPath).href;
}

export function commandArguments(
  arguments_: readonly string[],
  name: string,
): {
  readonly command: string;
  readonly rest: readonly string[];
} {
  const command = arguments_[0];
  if (command === undefined) throw new Error(`${name} requires a command; run pnpm run ${name} --help`);
  return { command, rest: arguments_.slice(1) };
}

export async function run(command: string, arguments_: readonly string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd: packageRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${String(code)}`));
    });
  });
}

export function runNode(script: string, arguments_: readonly string[] = []): Promise<void> {
  return run(process.execPath, [script, ...arguments_]);
}

export function runNodeTests(patterns: readonly string[]): Promise<void> {
  const files = patterns.flatMap((pattern) => globSync(pattern)).sort();
  if (files.length === 0) throw new Error(`No test files matched: ${patterns.join(', ')}`);
  return run(process.execPath, ['--test', ...files]);
}

export function runPnpm(arguments_: readonly string[]): Promise<void> {
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', arguments_);
}

export function runCargo(arguments_: readonly string[]): Promise<void> {
  return run(process.platform === 'win32' ? 'cargo.exe' : 'cargo', arguments_);
}
