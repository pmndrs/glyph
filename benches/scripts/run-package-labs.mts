/* @workflow {
  "name": "benchmark:labs-package",
  "summary": "Benchmark common installed-package workflows by default, or select a focused/full pmndrs/labs suite.",
  "requirements": "Network access for registry specs, or one or two packed @pmndrs/glyph .tgz artifacts. Never builds workspace source. Accepts --suite smoke|layout|measure|glyphs|publication|style|reflow|stress|full.",
  "writes": "Ignored Labs results and an artifact manifest under --output (default .cache/labs-package)."
} */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertLabsResultSucceeded } from './support/labs-result.mts';
import { type PackageLabsSuite, requirePackageLabsSuite } from './support/package-labs-suite.mts';

interface Options {
  readonly baseline?: string;
  readonly blocks: number;
  readonly candidate: string;
  readonly output: string;
  readonly suite: PackageLabsSuite;
}

interface InstalledArtifact {
  readonly installRoot: string;
  readonly packageRoot: string;
  readonly requested: string;
  readonly sha256?: string;
  readonly version: string;
}

const benchesRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = resolve(benchesRoot, '..');
const labsExecutable = resolve(benchesRoot, 'node_modules/.bin/labs');
const labsResults = resolve(benchesRoot, '.cache/labs-store/results');
const options = await parseOptions(process.argv.slice(2));
const output = resolve(benchesRoot, options.output);
const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'glyph-labs-package-'));

await mkdir(output, { recursive: true });

try {
  const baseline =
    options.baseline === undefined ? undefined : await installArtifact('baseline', options.baseline, temporaryRoot);
  const candidate = await installArtifact('candidate', options.candidate, temporaryRoot);
  const baselineRunName = baseline === undefined ? undefined : artifactRunName('baseline', baseline);
  const candidateRunName = artifactRunName('candidate', candidate);

  if (baseline !== undefined && baselineRunName !== undefined) {
    await runLabs(baselineRunName, baseline.packageRoot, options.blocks, options.suite);
  }
  await runLabs(candidateRunName, candidate.packageRoot, options.blocks, options.suite);

  let comparison: string | undefined;
  if (baselineRunName !== undefined) {
    await run(labsExecutable, ['baseline', baselineRunName], benchesRoot);
    comparison = await run(labsExecutable, ['compare', candidateRunName], benchesRoot, true);
    await writeFile(resolve(output, 'comparison.txt'), comparison);
  }

  await copyFile(resolve(labsResults, `${candidateRunName}.json`), resolve(output, 'candidate.json'));
  if (baselineRunName !== undefined) {
    await copyFile(resolve(labsResults, `${baselineRunName}.json`), resolve(output, 'baseline.json'));
  }
  await preserveInstall(candidate, 'candidate', output);
  if (baseline !== undefined) await preserveInstall(baseline, 'baseline', output);

  const labsPackage = JSON.parse(
    await readFile(resolve(benchesRoot, 'node_modules/@pmndrs/labs/package.json'), 'utf8'),
  ) as { version: string };
  await writeFile(
    resolve(output, 'manifest.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        labsVersion: labsPackage.version,
        blocks: options.blocks,
        suite: options.suite,
        baseline: baseline === undefined ? undefined : artifactIdentity(baseline),
        candidate: artifactIdentity(candidate),
        comparison: comparison === undefined ? 'not requested' : 'comparison.txt',
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Labs artifacts: ${output}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function parseOptions(argv: readonly string[]): Promise<Options> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error('Arguments must be supplied as --name value pairs');
    }
    values.set(name.slice(2), value);
  }
  const suite = requirePackageLabsSuite(values.get('suite') ?? 'smoke');
  const blocks = Number(values.get('blocks') ?? (suite === 'smoke' ? 4 : 8));
  if (!Number.isSafeInteger(blocks) || blocks < 2) throw new RangeError('--blocks must be an integer of at least 2');
  return {
    candidate: values.get('candidate') ?? '@pmndrs/glyph@canary',
    blocks,
    output: values.get('output') ?? '.cache/labs-package',
    suite,
    ...(values.has('baseline') ? { baseline: values.get('baseline')! } : {}),
  };
}

async function installArtifact(name: string, requested: string, root: string): Promise<InstalledArtifact> {
  const normalized = await normalizeSpec(requested);
  const installRoot = resolve(root, name);
  await mkdir(installRoot, { recursive: true });
  await writeFile(
    resolve(installRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: `glyph-labs-${name}`,
        private: true,
        type: 'module',
        dependencies: { '@pmndrs/glyph': normalized.spec, three: '0.185.1' },
      },
      null,
      2,
    )}\n`,
  );
  await runPnpm(['install', '--ignore-scripts', '--config.confirmModulesPurge=false'], installRoot);
  const packageRoot = resolve(installRoot, 'node_modules/@pmndrs/glyph');
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as { version: string };
  return {
    installRoot,
    packageRoot,
    requested,
    version: manifest.version,
    ...(normalized.sha256 === undefined ? {} : { sha256: normalized.sha256 }),
  };
}

async function normalizeSpec(requested: string): Promise<{ readonly spec: string; readonly sha256?: string }> {
  if (requested.startsWith('workspace:'))
    throw new Error('Labs requires a packed or registry package, not workspace source');
  if (!requested.startsWith('.') && !requested.startsWith('/') && !requested.startsWith('file:')) {
    if (requested === '@pmndrs/glyph') return { spec: await resolveRegistryVersion('@pmndrs/glyph@latest') };
    const prefix = '@pmndrs/glyph@';
    if (!requested.startsWith(prefix)) {
      throw new Error(`Registry artifacts must identify @pmndrs/glyph: ${requested}`);
    }
    return { spec: await resolveRegistryVersion(requested) };
  }
  const candidate = resolve(process.cwd(), requested.replace(/^file:/u, ''));
  const info = await stat(candidate);
  let archive = candidate;
  if (info.isDirectory()) {
    const archives = (await readdir(candidate)).filter((entry) => entry.endsWith('.tgz'));
    if (archives.length !== 1) {
      throw new Error(`Artifact directory must contain exactly one .tgz file: ${candidate}`);
    }
    archive = resolve(candidate, archives[0]!);
  } else if (!candidate.endsWith('.tgz')) {
    throw new Error(`Package artifact must be a .tgz file: ${candidate}`);
  }
  const bytes = await readFile(archive);
  return { spec: `file:${archive}`, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function resolveRegistryVersion(requested: string): Promise<string> {
  const pnpm = process.env.npm_execpath;
  if (pnpm === undefined) throw new Error('Run this workflow through pnpm so it uses the repository-pinned pnpm');
  const registryOutput = await run(pnpm, ['view', requested, 'version', '--json'], workspaceRoot, true);
  const version: unknown = JSON.parse(registryOutput);
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`npm did not resolve ${requested} to one exact version`);
  }
  return version;
}

async function runLabs(name: string, packageRoot: string, blocks: number, suite: PackageLabsSuite): Promise<void> {
  const selection = suite === 'full' ? [] : [`@${suite}`];
  await run(labsExecutable, [...selection, '--name', name, '--force', '--blocks', String(blocks)], benchesRoot, false, {
    GLYPH_LABS_PACKAGE_ROOT: packageRoot,
  });
  await assertLabsResultSucceeded(resolve(labsResults, `${name}.json`));
}

async function preserveInstall(artifact: InstalledArtifact, name: string, destination: string): Promise<void> {
  await copyFile(resolve(artifact.installRoot, 'package.json'), resolve(destination, `${name}-package.json`));
  await copyFile(resolve(artifact.installRoot, 'pnpm-lock.yaml'), resolve(destination, `${name}-pnpm-lock.yaml`));
}

function artifactIdentity(artifact: InstalledArtifact) {
  return {
    requested: artifact.requested,
    version: artifact.version,
    ...(artifact.sha256 === undefined ? {} : { sha256: artifact.sha256 }),
  };
}

function artifactRunName(role: 'baseline' | 'candidate', artifact: InstalledArtifact): string {
  const digest = artifact.sha256 === undefined ? '' : `-${artifact.sha256.slice(0, 8)}`;
  return `${role}-${artifact.version}${digest}`.replace(/[^a-zA-Z0-9._-]/gu, '-');
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
  capture = false,
  environment: Readonly<Record<string, string>> = {},
): Promise<string> {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let commandOutput = '';
    child.stdout.on('data', (chunk: Buffer) => {
      commandOutput += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      commandOutput += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveRun(capture ? commandOutput : '');
      else reject(new Error(`${basename(command)} exited with ${String(code)}`));
    });
  });
}
