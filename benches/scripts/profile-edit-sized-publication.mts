/* @workflow {
  "name": "benchmark:edit-sized-publication-profile",
  "summary": "Profile one installed-package edit-sized publication lane, optionally with a named shaper Wasm artifact.",
  "requirements": "One packed @pmndrs/glyph .tgz artifact and the authenticated Labs font fixtures. Accepts --artifact, --output, --case, --boundary, --count, --position, --iterations, --warmups, and optional --wasm. One-label, prepared-read and bulk-write cases support setter+read preparation or setter+read+publication. Prepared-read accepts 100 or 1000 labels; interleaved-read requires publication.",
  "writes": "A CPU profile, summary, and artifact manifest under --output (default .cache/edit-sized-publication-profile)."
} */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { authenticateNamedShaper, sha256 } from '../../packages/glyph/scripts/support/named-shaper.mjs';

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
  let namedWasm;
  if (options.wasm !== undefined) {
    const wasm = resolve(process.cwd(), options.wasm);
    await requireFile(wasm, '--wasm');
    const releasePath = resolve(packageRoot, 'dist/text-shaper.wasm');
    const release = await readFile(releasePath);
    const override = await readFile(wasm);
    const proof = authenticateNamedShaper(release, override);
    namedWasm = {
      file: wasm,
      sha256: sha256(override),
      releaseSha256: sha256(release),
      executableSha256: proof.executableSha256,
      functions: proof.functions,
    };
    // Write the authenticated bytes, avoiding a second path read after validation.
    await writeFile(releasePath, override);
  }
  await run(
    process.execPath,
    ['--expose-gc', resolve(benchesRoot, 'labs/package/edit-sized-publication.profile.mts')],
    benchesRoot,
    {
      GLYPH_EDIT_PROFILE_CASE: options.profileCase,
      GLYPH_EDIT_PROFILE_BOUNDARY: options.boundary,
      GLYPH_EDIT_PROFILE_COUNT: String(options.count),
      GLYPH_EDIT_PROFILE_ITERATIONS: String(options.iterations),
      GLYPH_EDIT_PROFILE_OUTPUT: output,
      GLYPH_EDIT_PROFILE_POSITION: options.position,
      GLYPH_EDIT_PROFILE_WARMUPS: String(options.warmups),
      GLYPH_LABS_PACKAGE_ROOT: packageRoot,
    },
  );
  const artifactBytes = await readFile(artifact);
  await writeFile(
    resolve(output, 'manifest.json'),
    `${JSON.stringify(
      {
        artifact: {
          file: basename(artifact),
          sha256: createHash('sha256').update(artifactBytes).digest('hex'),
        },
        generatedAt: new Date().toISOString(),
        ...(namedWasm === undefined ? {} : { namedWasm }),
        options,
      },
      null,
      2,
    )}\n`,
  );
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
    | 'bulk-write';
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
    !['same-length', 'length-changing', 'color-only', 'interleaved-read', 'prepared-read', 'bulk-write'].includes(
      profileCase,
    )
  ) {
    throw new Error(`Unknown --case: ${profileCase}`);
  }
  const position = values.get('position') ?? 'first';
  if (position !== 'first' && position !== 'last') throw new Error(`Unknown --position: ${position}`);
  const boundary = values.get('boundary') ?? 'publication';
  if (boundary !== 'preparation' && boundary !== 'publication') throw new Error(`Unknown --boundary: ${boundary}`);
  if (boundary === 'preparation' && profileCase === 'interleaved-read') {
    throw new Error('--case interleaved-read requires --boundary publication');
  }
  const count = positiveInteger(values.get('count') ?? '1000', 'count');
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
