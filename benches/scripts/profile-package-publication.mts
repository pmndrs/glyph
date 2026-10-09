/* @workflow {
  "name": "benchmark:publication-profile",
  "summary": "Attribute CPU, sampled allocation, GC, normalization/staging, and commit cost for the installed-package trailing-span workload.",
  "requirements": "One packed @pmndrs/glyph .tgz artifact plus authenticated Labs font fixtures. Accepts --artifact, --output, --iterations, and --warmups.",
  "writes": "CPU and heap profiles plus summary and artifact manifest under --output (default .cache/publication-profile)."
} */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installedPackageDependencies } from './support/package-labs-dependencies.mts';

const benchesRoot = fileURLToPath(new URL('..', import.meta.url));
const options = parseOptions(process.argv.slice(2));
const artifact = resolve(process.cwd(), options.artifact);
const artifactInfo = await stat(artifact);
if (!artifactInfo.isFile() || !artifact.endsWith('.tgz')) throw new Error('--artifact must identify one .tgz file');
const output = resolve(benchesRoot, options.output);
const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'glyph-publication-profile-'));

try {
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(temporaryRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'glyph-publication-profile',
        private: true,
        type: 'module',
        dependencies: installedPackageDependencies(`file:${artifact}`),
      },
      null,
      2,
    )}\n`,
  );
  await runPnpm(['install', '--ignore-scripts', '--config.confirmModulesPurge=false'], temporaryRoot);
  await run(
    process.execPath,
    ['--expose-gc', resolve(benchesRoot, 'labs/package/adapter-publication.profile.mts')],
    benchesRoot,
    {
      GLYPH_LABS_PACKAGE_ROOT: resolve(temporaryRoot, 'node_modules/@pmndrs/glyph'),
      GLYPH_PUBLICATION_PROFILE_ITERATIONS: String(options.iterations),
      GLYPH_PUBLICATION_PROFILE_OUTPUT: output,
      GLYPH_PUBLICATION_PROFILE_WARMUPS: String(options.warmups),
    },
  );
  const bytes = await readFile(artifact);
  await writeFile(
    resolve(output, 'manifest.json'),
    `${JSON.stringify(
      {
        artifact: {
          file: basename(artifact),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
        generatedAt: new Date().toISOString(),
        iterations: options.iterations,
        node: process.version,
        warmups: options.warmups,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Publication profile artifacts: ${output}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function parseOptions(arguments_: readonly string[]) {
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
  return {
    artifact: artifactOption,
    iterations: positiveInteger(values.get('iterations') ?? '20', 'iterations'),
    output: values.get('output') ?? '.cache/publication-profile',
    warmups: positiveInteger(values.get('warmups') ?? '6', 'warmups'),
  };
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new RangeError(`--${label} must be a positive integer`);
  return parsed;
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
