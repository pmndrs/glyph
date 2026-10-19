/* @workflow {
  "name": "benchmark:application-memory-observe",
  "summary": "Observe complete Darwin physical-footprint sweeps for an installed-package Node bulk edit or an existing browser command family.",
  "requirements": "macOS, Xcode clang, pinned pnpm, one frozen Glyph .tgz, authenticated Labs fixtures, and an idle performance lane. Supply --artifact and --output; --mode browser forwards the command after -- (for example the existing benchmark:retained-uploads workflow).",
  "writes": "JSON and NDJSON evidence under --output, plus an isolated temporary installed consumer removed after verified child cleanup. This observer is untimed."
} */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installedPackageDependencies } from './support/package-labs-dependencies.mts';

const benchesRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = resolve(benchesRoot, '..');
const options = parse(process.argv.slice(2));
const output = resolve(options.output);
const archive = resolve(options.artifact);
const source = resolve(benchesRoot, 'scripts/support/darwin-family-footprint.c');
const temporary = await mkdtemp(resolve(tmpdir(), 'glyph-application-memory-'));
let safeToRemove = true;
let inputHashes: Record<string, string> | undefined;
const report: Record<string, unknown> = {
  format: 'glyph-application-physical-footprint-v1',
  mode: options.mode,
  status: 'started',
  temporaryConsumer: temporary,
};
try {
  if (process.platform !== 'darwin') throw new Error('Physical-footprint observer requires Darwin proc_pid_rusage V4');
  await mkdir(output, { recursive: true });
  const archiveSha256 = sha256(await readFile(archive));
  report.archive = { basename: basename(archive), sha256: archiveSha256 };
  const expectedPackage = resolve(temporary, 'archive/package');
  await mkdir(resolve(temporary, 'archive'), { recursive: true });
  await run('tar', ['-xzf', archive, '-C', resolve(temporary, 'archive')], temporary, process.env, true, 30_000);
  const packageFile: unknown = JSON.parse(await readFile(resolve(expectedPackage, 'package.json'), 'utf8'));
  if (!isObject(packageFile) || packageFile.name !== '@pmndrs/glyph') throw new Error('Archive is not @pmndrs/glyph');

  await writeFile(
    resolve(temporary, 'package.json'),
    `${JSON.stringify(
      {
        name: 'glyph-application-memory-observer',
        private: true,
        type: 'module',
        dependencies: installedPackageDependencies(`file:${archive}`),
      },
      null,
      2,
    )}\n`,
  );
  const pnpm = process.env.npm_execpath;
  if (pnpm === undefined)
    throw new Error('Invoke through repository-pinned pnpm so npm_execpath identifies the installer');
  safeToRemove = false;
  await run(
    pnpm,
    ['install', '--ignore-scripts', '--config.confirmModulesPurge=false'],
    temporary,
    process.env,
    true,
    120_000,
  );
  safeToRemove = true;
  const installedPackage = await realpath(resolve(temporary, 'node_modules/@pmndrs/glyph'));
  const expectedDist = await inventory(resolve(expectedPackage, 'dist'));
  const actualDist = await inventory(resolve(installedPackage, 'dist'));
  assert.deepStrictEqual(actualDist, expectedDist, 'every installed JS/Wasm byte must match the frozen archive');
  const peers = Object.fromEntries(
    await Promise.all(
      ['@pmndrs/glyph', 'react', 'three', 'typegpu'].map(async (name) => {
        const metadata: unknown = JSON.parse(
          await readFile(resolve(temporary, 'node_modules', name, 'package.json'), 'utf8'),
        );
        if (!isObject(metadata) || metadata.name !== name || typeof metadata.version !== 'string') {
          throw new Error(`Installed peer identity invalid: ${name}`);
        }
        return [name, metadata.version] as const;
      }),
    ),
  );
  report.installed = {
    packageRoot: installedPackage,
    distSha256ByPath: actualDist,
    peers,
    lockSha256: sha256(await readFile(resolve(temporary, 'pnpm-lock.yaml'))),
  };
  inputHashes = await inventoryInputs();
  report.harness = { inputHashes };
  const native = resolve(temporary, 'darwin-family-footprint');
  await run(
    'xcrun',
    ['--sdk', 'macosx', 'clang', '-std=c11', '-O2', '-Wall', '-Wextra', source, '-o', native],
    temporary,
    process.env,
    true,
    60_000,
  );
  const observations = resolve(output, 'physical-footprint.ndjson');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GLYPH_LABS_PACKAGE_ROOT: installedPackage,
    GLYPH_RETAINED_UPLOAD_PACKAGE_ROOT: installedPackage,
    GLYPH_BULK_MEMORY_OUTPUT: resolve(output, 'node-checkpoints.json'),
    ...(options.mode === 'browser'
      ? { GLYPH_RETAINED_UPLOAD_DELIVERY_PROOF: resolve(output, 'browser-delivery.json') }
      : {}),
    PORT: '0',
  };
  delete env.PORTLESS_URL;
  const command =
    options.mode === 'node'
      ? [process.execPath, '--expose-gc', resolve(benchesRoot, 'labs/package/bulk-memory.observe.mts')]
      : options.command;
  const stdout = resolve(output, 'command.stdout.log');
  const stderr = resolve(output, 'command.stderr.log');
  Object.assign(report, {
    command,
    observations,
    stdout,
    stderr,
    ...(options.mode === 'browser' ? { browserDeliveryProof: env.GLYPH_RETAINED_UPLOAD_DELIVERY_PROOF } : {}),
  });
  // Once launched, keep the consumer if the native observer cannot prove that its family is gone.
  safeToRemove = false;
  const nativeExit = await run(
    native,
    [observations, '25', '300000', '--', ...command],
    benchesRoot,
    env,
    false,
    320_000,
    { stdout, stderr },
  );
  report.nativeExit = nativeExit;
  const lines = (await readFile(observations, 'utf8')).trim().split('\n');
  const terminalLine = lines.at(-1) ?? '';
  report.nativeTerminalLine = terminalLine;
  const result: unknown = JSON.parse(terminalLine);
  if (!isTerminalResult(result)) {
    throw new Error('Native observer did not produce a terminal result');
  }
  report.result = result;
  safeToRemove =
    result.cleanupProven === true &&
    result.terminalIdentityCheckComplete === true &&
    result.survivingProcesses === 0 &&
    result.uncertainIdentities === 0 &&
    result.remainingIdentities.length === 0;
  const unchanged = await inventoryInputs();
  const unchangedAfterObservation = JSON.stringify(inputHashes) === JSON.stringify(unchanged);
  report.harness = { inputHashes, unchangedAfterObservation };
  report.limitations = [
    'The maximum complete 25 ms sweep sum is an estimate: processes were sampled non-atomically and short peaks or children may be missed.',
    'The sum is neither an exact simultaneous peak nor a strict lower bound; incomplete sweeps are retained in NDJSON and excluded from the reported maximum.',
    'The Node OS maximum covers the entire observed command lifetime, including fixture bootstrap, all 1,024 cold controls, and teardown. It is not a bulk-edit-only peak.',
    'Only the launched command family is followed. Detached descendants discovered before reparenting remain tracked by PID and OS start time; undiscovered children and unrelated system processes are excluded.',
    'PID identity check and signal delivery are separate syscalls; cleanup is bounded and best effort, not an atomic handle-based kill guarantee.',
    'Darwin physical footprint includes process charges and may double-count shared memory across processes; JS heap and Wasm capacity are separate diagnostics.',
    'The observer scans the process table and can perturb runtime; these observations are not latency evidence.',
  ];
  report.status = nativeExit === 0 && result.success === true && unchangedAfterObservation ? 'completed' : 'failed';
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'completed') {
    throw new Error(`Memory observation failed; inspect ${resolve(output, 'report.json')}`);
  }
  process.stdout.write(`Application memory observation: ${resolve(output, 'report.json')}\n`);
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? { name: error.name, message: error.message } : String(error);
  try {
    const raw = await readFile(resolve(output, 'physical-footprint.ndjson'), 'utf8');
    report.nativeTerminalLine = raw.trim().split('\n').at(-1) ?? '';
  } catch {
    /* The native process may have failed before opening its evidence file. */
  }
  if (inputHashes !== undefined) {
    try {
      report.harness = {
        inputHashes,
        unchangedAfterObservation: JSON.stringify(inputHashes) === JSON.stringify(await inventoryInputs()),
      };
    } catch {
      /* Preserve the original failure and the initial hashes. */
    }
  }
  try {
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  } catch (reportError) {
    process.stderr.write(`Could not persist failure report: ${String(reportError)}\n`);
  }
  throw error;
} finally {
  if (safeToRemove) {
    try {
      await rm(temporary, { recursive: true, force: true });
    } catch (cleanupError) {
      process.stderr.write(`Could not remove isolated consumer: ${String(cleanupError)}\n`);
    }
  } else process.stderr.write(`Family cleanup is unproven; preserved isolated consumer for inspection: ${temporary}\n`);
}

interface Options {
  readonly artifact: string;
  readonly output: string;
  readonly mode: 'node' | 'browser';
  readonly command: readonly string[];
}

function parse(args: readonly string[]): Options {
  const separator = args.indexOf('--');
  const own = separator < 0 ? args : args.slice(0, separator);
  const command = separator < 0 ? [] : args.slice(separator + 1);
  const values = new Map<string, string>();
  for (let index = 0; index < own.length; index += 2) {
    const key = own[index];
    const value = own[index + 1];
    if (!['--artifact', '--output', '--mode'].includes(key ?? '') || value === undefined || values.has(key!)) {
      throw new Error('Use --artifact PATH --output DIR --mode node|browser [-- COMMAND...]');
    }
    values.set(key!, value);
  }
  const artifact = values.get('--artifact');
  const outputOption = values.get('--output');
  const mode = values.get('--mode');
  if (artifact === undefined || outputOption === undefined || (mode !== 'node' && mode !== 'browser')) {
    throw new Error('Use --artifact PATH --output DIR --mode node|browser [-- COMMAND...]');
  }
  if ((mode === 'browser') !== command.length > 0)
    throw new Error('Browser mode requires -- COMMAND; Node mode owns its command');
  return { artifact, output: outputOption, mode, command };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isTerminalResult(value: unknown): value is {
  readonly type: 'result';
  readonly success: boolean;
  readonly cleanupProven?: boolean;
  readonly terminalIdentityCheckComplete: boolean;
  readonly survivingProcesses: number;
  readonly uncertainIdentities: number;
  readonly remainingIdentities: readonly unknown[];
} {
  return (
    isObject(value) &&
    value.type === 'result' &&
    typeof value.success === 'boolean' &&
    typeof value.terminalIdentityCheckComplete === 'boolean' &&
    typeof value.survivingProcesses === 'number' &&
    Number.isSafeInteger(value.survivingProcesses) &&
    typeof value.uncertainIdentities === 'number' &&
    Number.isSafeInteger(value.uncertainIdentities) &&
    Array.isArray(value.remainingIdentities)
  );
}

async function inventory(root: string): Promise<Record<string, string>> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(?:js|wasm)$/u.test(entry.name)) files.push(path);
    }
  }
  await visit(root);
  files.sort();
  return Object.fromEntries(
    await Promise.all(files.map(async (path) => [relative(root, path), sha256(await readFile(path))] as const)),
  );
}

async function inventoryInputs(): Promise<Record<string, string>> {
  const paths = [
    'pnpm-lock.yaml',
    'benches/scripts/observe-application-memory.mts',
    'benches/scripts/support/darwin-family-footprint.c',
    'benches/scripts/support/package-labs-dependencies.mts',
    'benches/scripts/support/project-chromium.mts',
    'benches/scripts/verify-retained-uploads.mts',
    'benches/scripts/workflows.mts',
    'benches/package.json',
    'benches/vite.config.ts',
    'benches/scripts/font-notices.mts',
    'benches/fixtures/fonts/inter-v4.1/LICENSE.txt',
    'benches/fixtures/fonts/amiri-1.002/OFL.txt',
    'benches/fixtures/fonts/noto-sans-devanagari/OFL.txt',
    'benches/fixtures/fonts/noto-sans-cjk-showcase-v0/LICENSE.txt',
    'benches/fixtures/fonts/dot-gothic-16/OFL.txt',
    'benches/fixtures/fonts/source-serif-4.005/OFL.md',
    'benches/fixtures/fonts/dancing-script-3.000/OFL.txt',
    'benches/retained-upload.html',
    'benches/src/retained-upload-proof.ts',
    'benches/src/three-root.ts',
    'benches/labs/package/bulk-memory.observe.mts',
    'benches/labs/package/fixture.ts',
    'benches/fixtures/rendering/inter-bitmap-16.font.glb',
    'benches/fixtures/rendering/dot-gothic-16-bitmap-16-32.font.glb',
    'benches/fixtures/rendering/fredoka-issue-216-bitmap-16.font.glb',
  ];
  return Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, sha256(await readFile(resolve(workspaceRoot, path)))] as const)),
  );
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env = process.env,
  requireSuccess = true,
  maxMs = 120_000,
  capture?: { readonly stdout: string; readonly stderr: string },
): Promise<number> {
  const status = await new Promise<number>((accept, reject) => {
    const stdoutFile = capture === undefined ? undefined : createWriteStream(capture.stdout);
    const stderrFile = capture === undefined ? undefined : createWriteStream(capture.stderr);
    const child = spawn(command, args, { cwd, env, stdio: capture === undefined ? 'inherit' : 'pipe' });
    stdoutFile?.once('error', (error) => {
      child.kill('SIGTERM');
      reject(error);
    });
    stderrFile?.once('error', (error) => {
      child.kill('SIGTERM');
      reject(error);
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      stdoutFile?.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderrFile?.write(chunk);
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, maxMs);
    const force = setTimeout(() => {
      if (timedOut) child.kill('SIGKILL');
    }, maxMs + 5_000);
    const hard = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      stdoutFile?.end();
      stderrFile?.end();
      reject(new Error(`${command} did not close within ${maxMs + 10_000} ms`));
    }, maxMs + 10_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      clearTimeout(force);
      clearTimeout(hard);
      stdoutFile?.end();
      stderrFile?.end();
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(force);
      clearTimeout(hard);
      const flush = (file: ReturnType<typeof createWriteStream> | undefined) =>
        new Promise<void>((done) => {
          if (file === undefined) done();
          else file.end(done);
        });
      void Promise.all([flush(stdoutFile), flush(stderrFile)]).then(() => {
        if (timedOut) reject(new Error(`${command} exceeded ${maxMs} ms`));
        else accept(signal === null ? (code ?? 1) : 1);
      }, reject);
    });
  });
  if (requireSuccess && status !== 0) throw new Error(`${command} exited ${status}`);
  return status;
}
