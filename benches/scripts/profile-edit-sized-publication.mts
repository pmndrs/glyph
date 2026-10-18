/* @workflow {
  "name": "benchmark:edit-sized-publication-profile",
  "summary": "Profile installed-package retained edits or width reflow, optionally with a named shaper Wasm artifact.",
  "requirements": "One packed @pmndrs/glyph .tgz artifact and the authenticated Labs font fixtures. Accepts --artifact, --output, --case, --boundary, --count, --position, --iterations, --warmups, and optional --wasm. prepared-read accepts 100 or 1000 labels; width-reflow and width-inspection use one 22k-glyph paragraph. Both accept preparation or publication boundaries.",
  "writes": "A CPU profile, summary, validation status, install lock and package manifests, harness source copies, and artifact manifest under --output (default .cache/edit-sized-publication-profile)."
} */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installedPackageDependencies } from './support/package-labs-dependencies.mts';

const benchesRoot = fileURLToPath(new URL('..', import.meta.url));
const options = parseOptions(process.argv.slice(2));
const artifact = resolve(process.cwd(), options.artifact);
const output = resolve(benchesRoot, options.output);
const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'glyph-edit-publication-profile-'));

try {
  await requireFile(artifact, '--artifact');
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(temporaryRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'glyph-edit-publication-profile',
        private: true,
        type: 'module',
        dependencies: installedPackageDependencies(`file:${artifact}`),
      },
      null,
      2,
    )}\n`,
  );
  await runPnpm(['install', '--ignore-scripts', '--config.confirmModulesPurge=false'], temporaryRoot);
  const packageRoot = resolve(temporaryRoot, 'node_modules/@pmndrs/glyph');
  if (options.wasm !== undefined) {
    const wasm = resolve(process.cwd(), options.wasm);
    await requireFile(wasm, '--wasm');
    await copyFile(wasm, resolve(packageRoot, 'dist/text-shaper.wasm'));
  }
  const workloadSource = resolve(benchesRoot, 'labs/package/edit-sized-publication.profile.mts');
  const wrapperSource = fileURLToPath(import.meta.url);
  await Promise.all([
    copyFile(resolve(temporaryRoot, 'package.json'), resolve(output, 'install-package.json')),
    copyFile(resolve(temporaryRoot, 'pnpm-lock.yaml'), resolve(output, 'install-pnpm-lock.yaml')),
    copyFile(wrapperSource, resolve(output, 'profile-wrapper.mts')),
    copyFile(workloadSource, resolve(output, 'profile-workload.mts')),
  ]);
  const digest = async (path: string) =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  const manifest = {
    artifact: { file: basename(artifact), sha256: await digest(artifact) },
    generatedAt: new Date().toISOString(),
    harness: {
      wrapperSha256: await digest(wrapperSource),
      workloadSha256: await digest(workloadSource),
    },
    installed: {
      packageSha256: await digest(resolve(output, 'install-package.json')),
      lockSha256: await digest(resolve(output, 'install-pnpm-lock.yaml')),
      textShaperWasmSha256: await digest(resolve(packageRoot, 'dist/text-shaper.wasm')),
    },
    runtime: {
      cpu: cpus()[0]?.model.trim(),
      arch: process.arch,
      platform: process.platform,
      node: process.versions.node,
    },
    namedWasm: options.wasm,
    options,
  };
  const writeManifest = async (status: 'pending' | 'accepted' | 'not-accepted', sampleBindings?: unknown) =>
    writeFile(
      resolve(output, 'manifest.json'),
      `${JSON.stringify({ ...manifest, ...(sampleBindings === undefined ? {} : { sampleBindings }), status }, null, 2)}\n`,
    );
  await writeManifest('pending');
  try {
    await run(process.execPath, ['--expose-gc', workloadSource], benchesRoot, {
      GLYPH_EDIT_PROFILE_CASE: options.profileCase,
      GLYPH_EDIT_PROFILE_BOUNDARY: options.boundary,
      GLYPH_EDIT_PROFILE_COUNT: String(options.count),
      GLYPH_EDIT_PROFILE_ITERATIONS: String(options.iterations),
      GLYPH_EDIT_PROFILE_OUTPUT: output,
      GLYPH_EDIT_PROFILE_POSITION: options.position,
      GLYPH_EDIT_PROFILE_WARMUPS: String(options.warmups),
      GLYPH_LABS_PACKAGE_ROOT: packageRoot,
    });
    let sampleBindings: unknown;
    if (options.profileCase === 'width-inspection') {
      const validation = JSON.parse(await readFile(resolve(output, 'validation.json'), 'utf8')) as { status?: string };
      if (validation.status !== 'passed') throw new Error('width-inspection cold oracle did not pass');
      const summary = JSON.parse(await readFile(resolve(output, 'summary.json'), 'utf8')) as {
        sampleBindings?: unknown;
      };
      if (summary.sampleBindings === undefined) throw new Error('installed inspection sample bindings are missing');
      sampleBindings = summary.sampleBindings;
    }
    if (
      (await digest(wrapperSource)) !== manifest.harness.wrapperSha256 ||
      (await digest(workloadSource)) !== manifest.harness.workloadSha256
    ) {
      throw new Error('profile harness source changed during capture');
    }
    await writeManifest('accepted', sampleBindings);
  } catch (error) {
    await writeManifest('not-accepted');
    throw error;
  }
  process.stdout.write(`Edit-sized publication profile: ${output}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

interface Options {
  readonly artifact: string;
  readonly boundary: 'preparation' | 'publication';
  readonly count: number;
  readonly iterations: number;
  readonly output: string;
  readonly position: 'first' | 'last';
  readonly profileCase:
    | 'same-length'
    | 'length-changing'
    | 'color-only'
    | 'interleaved-read'
    | 'prepared-read'
    | 'width-reflow'
    | 'width-inspection';
  readonly warmups: number;
  readonly wasm?: string;
}

function parseOptions(arguments_: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error('Arguments must be supplied as --name value pairs');
    }
    values.set(name.slice(2), value);
  }
  const artifactOption = values.get('artifact');
  if (artifactOption === undefined) throw new Error('--artifact is required');
  const profileCase = values.get('case') ?? 'same-length';
  if (
    ![
      'same-length',
      'length-changing',
      'color-only',
      'interleaved-read',
      'prepared-read',
      'width-reflow',
      'width-inspection',
    ].includes(profileCase)
  ) {
    throw new Error(`Unknown --case: ${profileCase}`);
  }
  const position = values.get('position') ?? 'first';
  if (position !== 'first' && position !== 'last') throw new Error(`Unknown --position: ${position}`);
  const boundary = values.get('boundary') ?? 'publication';
  if (boundary !== 'preparation' && boundary !== 'publication') throw new Error(`Unknown --boundary: ${boundary}`);
  if (
    boundary === 'preparation' &&
    profileCase !== 'prepared-read' &&
    profileCase !== 'width-reflow' &&
    profileCase !== 'width-inspection'
  ) {
    throw new Error('--boundary preparation requires --case prepared-read, width-reflow, or width-inspection');
  }
  const widthCase = profileCase === 'width-reflow' || profileCase === 'width-inspection';
  const count = positiveInteger(values.get('count') ?? (widthCase ? '1' : '1000'), 'count');
  if (widthCase && count !== 1) {
    throw new RangeError('--case width-reflow and width-inspection require --count 1');
  }
  if (profileCase === 'prepared-read' && count !== 100 && count !== 1000) {
    throw new RangeError('--case prepared-read requires --count 100 or 1000');
  }
  if (profileCase === 'interleaved-read' && count < 100) {
    throw new RangeError('--case interleaved-read requires at least 100 labels');
  }
  return {
    artifact: artifactOption,
    boundary,
    count,
    iterations: positiveInteger(values.get('iterations') ?? '100', 'iterations'),
    output: values.get('output') ?? '.cache/edit-sized-publication-profile',
    position,
    profileCase: profileCase as Options['profileCase'],
    warmups: positiveInteger(values.get('warmups') ?? '10', 'warmups'),
    ...(values.has('wasm') ? { wasm: values.get('wasm')! } : {}),
  };
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new RangeError(`--${label} must be a positive integer`);
  return parsed;
}

async function requireFile(path: string, label: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label} must identify one file`);
}

async function runPnpm(arguments_: readonly string[], cwd: string): Promise<void> {
  const pnpm = process.env.npm_execpath;
  if (pnpm === undefined) throw new Error('Run this workflow through pnpm so it uses the repository-pinned pnpm');
  await run(pnpm, arguments_, cwd);
}

async function run(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: { ...process.env, ...environment },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${basename(command)} exited with ${String(code)}`));
    });
  });
}
