/* @workflow {
  "name": "benchmark:edit-sized-publication-profile",
  "summary": "Profile one installed-package edit-sized publication lane, optionally with a named shaper Wasm artifact.",
  "requirements": "One packed @pmndrs/glyph .tgz artifact and the authenticated Labs font fixtures. Accepts --artifact, --output, --case, --boundary, --count, --position, --iterations, --warmups, and optional --wasm. The same-length, same-value, and overwrite-before-publication cases support setter-only, setter+read preparation, or setter+read+publication boundaries. Setter-only profiles exclude reads and publications from timing; parity reads run afterward. Same-value isolates no-op setters; overwrite-before-publication performs two edits. Prepared-read accepts 100 or 1000 labels; interleaved-read requires publication. Bulk-write alternates the short alpha/bravo labels across --count labels and supports preparation or publication boundaries; --reads none|measure selects setter-only versus setter+measure-read behavior (default measure), and --publication-path engine|scene selects publication routing (default engine). Post-timing correctness reads are counted separately. Fredoka-edit and inter-edit reproduce their long typing corpora at --count 1 and support all three boundaries. Font-size matches the 22k-glyph Labs publication callback at --count 1, with setter or publication boundaries only; warmup callbacks continue the same font-size progression before timed callbacks, not the Labs warmup schedule. Multi-owner-balanced and multi-owner-unbalanced share the Labs three-separated-owner publisher at 100 or 1000 labels and require the publication boundary.",
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
      ...(options.reads === undefined ? {} : { GLYPH_EDIT_PROFILE_READS: options.reads }),
      ...(options.publicationPath === undefined
        ? {}
        : { GLYPH_EDIT_PROFILE_PUBLICATION_PATH: options.publicationPath }),
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
  readonly boundary: 'setter' | 'preparation' | 'publication';
  readonly count: number;
  readonly iterations: number;
  readonly output: string;
  readonly position: 'first' | 'last';
  readonly reads?: 'none' | 'measure';
  readonly publicationPath?: 'engine' | 'scene';
  readonly profileCase:
    | 'same-length'
    | 'same-value'
    | 'overwrite-before-publication'
    | 'length-changing'
    | 'color-only'
    | 'interleaved-read'
    | 'prepared-read'
    | 'bulk-write'
    | 'fredoka-edit'
    | 'inter-edit'
    | 'width-reflow'
    | 'font-size'
    | 'multi-owner-balanced'
    | 'multi-owner-unbalanced';
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
      'same-value',
      'overwrite-before-publication',
      'length-changing',
      'color-only',
      'interleaved-read',
      'prepared-read',
      'bulk-write',
      'fredoka-edit',
      'inter-edit',
      'width-reflow',
      'font-size',
      'multi-owner-balanced',
      'multi-owner-unbalanced',
    ].includes(profileCase)
  ) {
    throw new Error(`Unknown --case: ${profileCase}`);
  }
  const position = values.get('position') ?? 'first';
  if (position !== 'first' && position !== 'last') throw new Error(`Unknown --position: ${position}`);
  const reads = values.get('reads');
  if (reads !== undefined && reads !== 'none' && reads !== 'measure') {
    throw new Error('--reads must be none or measure');
  }
  if (reads !== undefined && profileCase !== 'bulk-write') {
    throw new Error('--reads only applies to --case bulk-write');
  }
  const publicationPath = values.get('publication-path');
  if (publicationPath !== undefined && publicationPath !== 'engine' && publicationPath !== 'scene') {
    throw new Error('--publication-path must be engine or scene');
  }
  if (publicationPath !== undefined && profileCase !== 'bulk-write') {
    throw new Error('--publication-path only applies to --case bulk-write');
  }
  const boundary = values.get('boundary') ?? 'publication';
  if (boundary !== 'setter' && boundary !== 'preparation' && boundary !== 'publication') {
    throw new Error(`Unknown --boundary: ${boundary}`);
  }
  if (
    boundary === 'setter' &&
    !['same-length', 'same-value', 'overwrite-before-publication', 'fredoka-edit', 'inter-edit', 'font-size'].includes(
      profileCase,
    )
  ) {
    throw new Error(
      '--boundary setter supports same-length, same-value, overwrite-before-publication, fredoka-edit, inter-edit, or font-size',
    );
  }
  if (boundary === 'preparation' && profileCase === 'interleaved-read') {
    throw new Error('--case interleaved-read requires --boundary publication');
  }
  if (boundary === 'preparation' && profileCase === 'font-size') {
    throw new Error('--case font-size has no preparation read; use --boundary setter or publication');
  }
  const count = positiveInteger(
    values.get('count') ??
      (['width-reflow', 'fredoka-edit', 'inter-edit', 'font-size'].includes(profileCase) ? '1' : '1000'),
    'count',
  );
  if (profileCase === 'width-reflow' && count !== 1) throw new RangeError('--case width-reflow requires --count 1');
  if (profileCase === 'font-size' && count !== 1) throw new RangeError('--case font-size requires --count 1');
  if (['fredoka-edit', 'inter-edit'].includes(profileCase) && count !== 1) {
    throw new RangeError(`--case ${profileCase} requires --count 1`);
  }
  if (profileCase === 'prepared-read' && count !== 100 && count !== 1000) {
    throw new RangeError('--case prepared-read requires --count 100 or 1000');
  }
  if (profileCase === 'interleaved-read' && count < 100) {
    throw new RangeError('--case interleaved-read requires at least 100 labels');
  }
  if (profileCase.startsWith('multi-owner-') && (boundary !== 'publication' || (count !== 100 && count !== 1000))) {
    throw new RangeError('Multi-owner profiling requires publication and 100 or 1000 labels');
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
    ...(profileCase === 'bulk-write' ? { reads: reads ?? 'measure' } : {}),
    ...(profileCase === 'bulk-write' ? { publicationPath: publicationPath ?? 'engine' } : {}),
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
