/* @workflow {
  "name": "benchmark:labs-package",
  "summary": "Benchmark common installed-package workflows by default, select a focused/full pmndrs/labs suite, or capture a tagged diagnostic CPU profile.",
  "requirements": "Network access for registry specs, or one or two packed @pmndrs/glyph .tgz artifacts. Never builds workspace source. --saved-candidate <report-directory> reuses an exact artifact's saved candidate instead of timing it again, with matching environment checks. Accepts --suite smoke|layout|measure|glyphs|publication|spans|batch|style|reflow|stress|cold|edit|assignment|edit-sized|multi-owner|full. Optional candidate-only diagnostic profiling requires both --profile-tag <@tag> and --cpu-profile-output <directory>; it selects that Labs tag and cannot be combined with --baseline or --saved-candidate. Profiled timings are diagnostic and are not a normal performance comparison.",
  "writes": "Ignored Labs results, an artifact manifest, and a Markdown summary.md (also appended to $GITHUB_STEP_SUMMARY when set) under --output (default .cache/labs-package); optional V8 CPU profiles are written under --cpu-profile-output."
} */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acceptLabsResult,
  labsRunNames,
  labsRunMedianTimes,
  type LabsResultRole,
  readLabsResult,
  timingModeDifferences,
  timingModeMismatches,
} from './support/labs-result.mts';
import { parseLabsComparison, renderLabsSummary, writeLabsSummary } from './support/labs-summary.mts';
import { installedPackageDependencies } from './support/package-labs-dependencies.mts';
import { type PackageLabsSuite, requirePackageLabsSuite } from './support/package-labs-suite.mts';
import { packageLabsHarnessDigest, validateSavedPackageLabs } from './support/saved-package-labs.mts';

interface Options {
  readonly baseline?: string;
  readonly blocks: number;
  readonly candidate: string;
  readonly output: string;
  readonly profileTag?: string;
  readonly cpuProfileOutput?: string;
  readonly suite: PackageLabsSuite;
  readonly savedCandidate?: string;
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
const resolvedCpuProfileDirectory =
  options.cpuProfileOutput === undefined ? undefined : resolve(benchesRoot, options.cpuProfileOutput);
const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'glyph-labs-package-'));

await mkdir(output, { recursive: true });
if (resolvedCpuProfileDirectory !== undefined) await mkdir(resolvedCpuProfileDirectory, { recursive: true });

try {
  const harnessDigest = packageLabsHarnessDigest();
  const baseline =
    options.baseline === undefined ? undefined : await installArtifact('baseline', options.baseline, temporaryRoot);
  const candidate = await installArtifact('candidate', options.candidate, temporaryRoot);
  const baselineRunName = baseline === undefined ? undefined : artifactRunName('baseline', baseline);
  const candidateRunName = `${artifactRunName('candidate', candidate)}${
    options.profileTag === undefined ? '' : '-diagnostic-profile'
  }`;
  const savedCandidate =
    options.savedCandidate === undefined ? undefined : resolve(benchesRoot, options.savedCandidate);
  if (savedCandidate !== undefined) {
    const manifest = await readLabsResult(resolve(savedCandidate, 'manifest.json'));
    const result = await readLabsResult(resolve(savedCandidate, 'candidate.json'));
    validateSavedPackageLabs(manifest, result, {
      ...artifactIdentity(candidate),
      suite: options.suite,
      blocks: options.blocks,
    });
    await mkdir(labsResults, { recursive: true });
    await copyFile(resolve(savedCandidate, 'candidate.json'), resolve(labsResults, `${candidateRunName}.json`));
    await copyFile(resolve(savedCandidate, 'manifest.json'), resolve(output, 'saved-candidate-manifest.json'));
    process.stdout.write(
      `Reusing saved candidate timings from ${savedCandidate}; candidate will not be benchmarked again\n`,
    );
  }

  const baselineRun =
    baseline === undefined || baselineRunName === undefined
      ? undefined
      : await runLabs(baselineRunName, baseline.packageRoot, options.blocks, options.suite, 'baseline');
  const candidateRun =
    savedCandidate === undefined
      ? await runLabs(
          candidateRunName,
          candidate.packageRoot,
          options.blocks,
          options.suite,
          'candidate',
          options.profileTag,
          resolvedCpuProfileDirectory,
        )
      : { result: await readLabsResult(resolve(labsResults, `${candidateRunName}.json`)), notComparable: [] };
  if (options.profileTag !== undefined && labsRunNames(candidateRun.result).length !== 1) {
    const selectedBenchmarks = labsRunNames(candidateRun.result).length;
    throw new Error(
      `Diagnostic profile tag ${options.profileTag} selected ${selectedBenchmarks} benchmarks; expected one`,
    );
  }

  let comparison: string | undefined;
  const timingMismatches =
    baselineRun === undefined ? [] : timingModeMismatches(baselineRun.result, candidateRun.result);
  if (baselineRunName !== undefined && baselineRun !== undefined) {
    await run(labsExecutable, ['baseline', baselineRunName], benchesRoot);
    comparison =
      (await run(labsExecutable, ['compare', candidateRunName], benchesRoot, true)) +
      notComparableReport(baselineRun.notComparable, timingMismatches);
    await writeFile(resolve(output, 'comparison.txt'), comparison);
  }

  if (packageLabsHarnessDigest() !== harnessDigest) throw new Error('Benchmark inputs changed during the run');
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
        harnessDigest,
        blocks: options.blocks,
        suite: options.suite,
        baseline: baseline === undefined ? undefined : artifactIdentity(baseline),
        candidate: artifactIdentity(candidate),
        savedCandidate,
        ...(options.profileTag === undefined
          ? {}
          : {
              profiling: {
                label: 'diagnostic profiling; not a normal performance comparison',
                profileTag: options.profileTag,
                output: resolvedCpuProfileDirectory!,
              },
            }),
        comparison: comparison === undefined ? 'not requested' : 'comparison.txt',
        notComparable: {
          baselineCheckFailures: baselineRun?.notComparable ?? [],
          timingModeMismatches: timingMismatches,
        },
      },
      null,
      2,
    )}\n`,
  );
  if (comparison !== undefined && baseline !== undefined) {
    await publishSummary(comparison, baselineRun?.result, candidateRun.result, baseline, candidate);
  }
  process.stdout.write(`Labs artifacts: ${output}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

/** The summary is a convenience view of finished results, so a failure here warns instead of failing the benchmark. */
async function publishSummary(
  comparison: string,
  baselineResult: unknown,
  candidateResult: unknown,
  baseline: InstalledArtifact,
  candidate: InstalledArtifact,
): Promise<void> {
  try {
    const markdown =
      (options.savedCandidate === undefined
        ? ''
        : 'Candidate timings reuse a saved run; only the baseline was measured in this job. CPU model, architecture, Node version, suite, blocks and package digest match. Separate-run machine variability remains.\n\n') +
      renderLabsSummary({
        suite: options.suite,
        baseline: artifactLabel(baseline),
        candidate: artifactLabel(candidate),
        comparison: parseLabsComparison(
          comparison,
          labsRunNames(candidateResult),
          baselineResult === undefined
            ? []
            : timingModeDifferences(baselineResult, candidateResult).map(({ name }) => name),
          labsRunMedianTimes(candidateResult),
        ),
      });
    await writeLabsSummary(markdown, output, process.env);
  } catch (error) {
    process.stdout.write(`::warning::Labs job summary was not written: ${String(error)}\n`);
  }
}

function artifactLabel(artifact: InstalledArtifact): string {
  return artifact.sha256 === undefined ? artifact.version : `${artifact.version} (${artifact.sha256.slice(0, 8)})`;
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
  const profileTag = values.get('profile-tag');
  const cpuProfileOutput = values.get('cpu-profile-output');
  if ((profileTag === undefined) !== (cpuProfileOutput === undefined)) {
    throw new Error('--profile-tag and --cpu-profile-output must be provided together');
  }
  if (profileTag !== undefined && !/^@[^\s@]+$/u.test(profileTag)) {
    throw new Error('--profile-tag must be one @tag');
  }
  if (cpuProfileOutput !== undefined && cpuProfileOutput.trim().length === 0) {
    throw new Error('--cpu-profile-output must name a directory');
  }
  if (profileTag !== undefined && values.has('baseline')) {
    throw new Error('--baseline cannot be used with candidate-only diagnostic profiling');
  }
  if (profileTag !== undefined && values.has('saved-candidate')) {
    throw new Error('--saved-candidate cannot be used with diagnostic profiling');
  }
  return {
    candidate: values.get('candidate') ?? '@pmndrs/glyph@canary',
    blocks,
    output: values.get('output') ?? '.cache/labs-package',
    suite,
    ...(profileTag === undefined ? {} : { profileTag }),
    ...(cpuProfileOutput === undefined ? {} : { cpuProfileOutput }),
    ...(values.has('baseline') ? { baseline: values.get('baseline')! } : {}),
    ...(values.has('saved-candidate') ? { savedCandidate: values.get('saved-candidate')! } : {}),
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
        dependencies: installedPackageDependencies(normalized.spec),
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

/**
 * Labs exits non-zero when any benchmark check fails, after saving the result. A candidate must pass every check; a
 * baseline may fail checks for behavior it predates, and those workloads are reported as not comparable.
 */
async function runLabs(
  name: string,
  packageRoot: string,
  blocks: number,
  suite: PackageLabsSuite,
  role: LabsResultRole,
  profileTag?: string,
  cpuProfileOutput?: string,
): Promise<{ readonly notComparable: readonly string[]; readonly result: unknown }> {
  const selection = profileTag === undefined ? (suite === 'full' ? [] : [`@${suite}`]) : [profileTag];
  const resultPath = resolve(labsResults, `${name}.json`);
  // A result left by an earlier run under this name must never stand in for this one.
  await rm(resultPath, { force: true });
  try {
    await run(
      labsExecutable,
      [...selection, '--name', name, '--force', '--blocks', String(blocks)],
      benchesRoot,
      false,
      {
        GLYPH_LABS_PACKAGE_ROOT: packageRoot,
        GLYPH_LABS_ARTIFACT_ROLE: role,
        GLYPH_LABS_CPU_PROFILE_OUTPUT: cpuProfileOutput,
      },
    );
  } catch (error) {
    if (role === 'candidate' || !(await exists(resultPath))) throw error;
  }
  const result = await readLabsResult(resultPath);
  return { notComparable: acceptLabsResult(result, role), result };
}

function notComparableReport(baselineFailures: readonly string[], timingMismatches: readonly string[]): string {
  const sections = [
    ['Baseline failed checks for behavior it predates', baselineFailures],
    ['Timed in different modes, so the delta measures the mode rather than the package', timingMismatches],
  ] as const;
  return sections
    .filter(([, lines]) => lines.length !== 0)
    .map(([title, lines]) => `\nNot comparable: ${title}\n${lines.map((line) => `  · ${line}`).join('\n')}\n`)
    .join('');
}

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(
    () => true,
    () => false,
  );
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
  environment: Readonly<Record<string, string | undefined>> = {},
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
