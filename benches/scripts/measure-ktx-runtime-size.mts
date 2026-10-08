/* @workflow { "name": "glyph:ktx-runtime-size", "summary": "Compile two Glyph revisions with the pinned JS toolchain and compare KTX-affected production bundle graphs.", "requirements": "A clean installed workspace with git, tar, and the pinned Glyph TypeScript, tsdown, Vite, and ktx-parse development dependencies. Pass --baseline and --candidate Git revisions; do not run concurrently.", "writes": "A stable ignored .cache/ktx-runtime-size source and dist tree, removed on exit; JSON evidence to stdout." } */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import {
  bundleJavaScriptVariants,
  externalizeGlyphWasmPlugin,
  isGlyphPeerDependency,
  type JavaScriptBundle,
} from '../src/benchmark/vite-size-bundle.ts';

interface Arguments {
  readonly baseline: string;
  readonly candidate: string;
}

interface Build {
  readonly commit: string;
  readonly compileConfigSha256: string;
  readonly packageRoot: string;
  readonly entries: Readonly<Record<EntryId, string>>;
}

interface BundleSize {
  readonly rawBytes: number;
  readonly minifiedBytes: number;
  readonly gzipBytes: number;
  readonly brotliBytes: number;
}

interface BundleEvidence extends BundleSize {
  readonly includedModuleCount: number;
  readonly excludedDynamicModuleCount: number;
  readonly includesKtxParse: boolean;
  readonly includesRasterKtxModule: boolean;
}

interface BundleComparison {
  readonly baseline: BundleEvidence;
  readonly candidate: BundleEvidence;
  readonly delta: {
    readonly rawBytes: number;
    readonly rawPercent: number;
    readonly minifiedBytes: number;
    readonly minifiedPercent: number;
    readonly gzipBytes: number;
    readonly gzipPercent: number;
    readonly brotliBytes: number;
    readonly brotliPercent: number;
  };
}

const entryIds = ['glyph-root', 'three-bitmap', 'three-msdf', 'three-slug', 'ktx-reader'] as const;
type EntryId = (typeof entryIds)[number];
type Scope = 'initial' | 'total';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const glyphNodeModules = join(workspace, 'packages/glyph/node_modules');
const tsc = join(workspace, `node_modules/.bin/tsc${process.platform === 'win32' ? '.CMD' : ''}`);
const tsdown = join(glyphNodeModules, `.bin/tsdown${process.platform === 'win32' ? '.CMD' : ''}`);
const args = parseArguments(process.argv.slice(2));
const scratch = join(workspace, '.cache/ktx-runtime-size');
await mkdir(dirname(scratch), { recursive: true });
await mkdir(scratch);

try {
  const baseline = await compileRevision('baseline', args.baseline, false);
  const baselineGraphs = await measureRevision(baseline, 'baseline');
  await rm(join(scratch, 'revision'), { recursive: true, force: true });

  const candidate = await compileRevision('candidate', args.candidate, true);
  if (baseline.compileConfigSha256 !== candidate.compileConfigSha256) {
    throw new Error('Baseline and candidate do not share identical TypeScript and tsdown build configurations');
  }
  run(candidate.packageRoot, process.execPath, ['--test', 'tests/package/raster-ktx.test.mjs'], true);
  const candidateGraphs = await measureRevision(candidate, 'candidate');

  const graphs: Record<string, BundleComparison> = {};
  for (const entryId of entryIds) {
    const scopes: readonly Scope[] = entryId === 'ktx-reader' ? ['total'] : ['initial', 'total'];
    for (const scope of scopes) {
      const key = `${entryId}:${scope}`;
      const before = baselineGraphs[key]!;
      const after = candidateGraphs[key]!;
      assertKtxBoundary(entryId, scope, before, after);
      graphs[key] = compare(before, after);
    }
  }

  const evidence = {
    schemaVersion: 1,
    comparison: {
      baseline: baseline.commit,
      candidate: candidate.commit,
    },
    toolchain: {
      node: process.version,
      typescript: commandOutput(tsc, ['--version']),
      tsdown: commandOutput(tsdown, ['--version']),
      vite: await readPackageVersion(join(workspace, 'benches/node_modules/vite/package.json')),
    },
    compileConfigurations: {
      baselineSha256: baseline.compileConfigSha256,
      candidateSha256: candidate.compileConfigSha256,
      identical: baseline.compileConfigSha256 === candidate.compileConfigSha256,
    },
    productionBundleConfiguration: {
      helper: 'benches/src/benchmark/vite-size-bundle.ts',
      helperSha256: await sha256File(join(workspace, 'benches/src/benchmark/vite-size-bundle.ts')),
      target: 'es2022',
      productionNodeEnv: true,
      rawMinification: 'dce-only',
      minifiedMinification: 'oxc compress+mangle',
      peerDependencies: 'external',
      wasmAssets: 'external and excluded from all byte counts',
      compression: 'gzip level 9; Brotli quality 11',
    },
    compiledKtxTests: {
      revision: candidate.commit,
      file: 'packages/glyph/tests/package/raster-ktx.test.mjs',
      passed: true,
    },
    graphs,
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

async function compileRevision(label: string, revision: string, includeTest: boolean): Promise<Build> {
  const commit = commandOutput('git', ['rev-parse', '--verify', `${revision}^{commit}`], workspace);
  const root = join(scratch, 'revision');
  const archive = join(scratch, 'revision.tar');
  run(workspace, 'git', [
    'archive',
    '--format=tar',
    `--output=${archive}`,
    commit,
    '--',
    'tsconfig.base.json',
    'packages/glyph/package.json',
    'packages/glyph/tsconfig.build.json',
    'packages/glyph/tsdown.config.ts',
    'packages/glyph/src',
  ]);
  await mkdir(root, { recursive: true });
  run(workspace, 'tar', ['-xf', archive, '-C', root]);
  await rm(archive);

  const packageRoot = join(root, 'packages/glyph');
  await symlink(glyphNodeModules, join(packageRoot, 'node_modules'), 'dir');
  const dist = join(packageRoot, 'dist');
  await mkdir(dist, { recursive: true });
  process.stderr.write(`[ktx-size] compiling ${label} ${commit}\n`);
  run(
    packageRoot,
    tsc,
    ['-p', 'tsconfig.build.json', '--outDir', dist, '--tsBuildInfoFile', join(dist, '.tsbuildinfo')],
    true,
  );
  run(packageRoot, tsdown, ['--out-dir', dist, '--no-clean'], true);

  if (includeTest) {
    const testPath = join(packageRoot, 'tests/package/raster-ktx.test.mjs');
    await mkdir(dirname(testPath), { recursive: true });
    const testSource = commandOutput(
      'git',
      ['show', `${commit}:packages/glyph/tests/package/raster-ktx.test.mjs`],
      workspace,
    );
    await writeFile(testPath, `${testSource}\n`);
  }

  return {
    commit,
    compileConfigSha256: await sha256Files([
      join(root, 'tsconfig.base.json'),
      join(packageRoot, 'tsconfig.build.json'),
      join(packageRoot, 'tsdown.config.ts'),
    ]),
    packageRoot,
    entries: await writeEntries(packageRoot),
  };
}

async function measureRevision(build: Build, label: string): Promise<Readonly<Record<string, BundleEvidence>>> {
  const graphs: Record<string, BundleEvidence> = {};
  for (const entryId of entryIds) {
    const scopes: readonly Scope[] = entryId === 'ktx-reader' ? ['total'] : ['initial', 'total'];
    for (const scope of scopes) {
      const key = `${entryId}:${scope}`;
      process.stderr.write(`[ktx-size] measuring ${key} ${label}\n`);
      graphs[key] = await measureBundle(build.entries[entryId], `${key} ${label}`, scope === 'total');
    }
  }
  return graphs;
}

async function writeEntries(packageRoot: string): Promise<Readonly<Record<EntryId, string>>> {
  const entriesRoot = join(packageRoot, '.ktx-size-entries');
  await mkdir(entriesRoot, { recursive: true });
  const rootExports = [
    'Constraints',
    'GlyphEngineStatusError',
    'GlyphError',
    'GlyphFontError',
    'ParagraphLayout',
    'TextStyle',
    'compatibilityFingerprint',
    'createFontStack',
    'fingerprint',
    'glyph',
    'glyphEngineStatusErrorDetails',
    'glyphFlags',
    'span',
    'txt',
  ];
  const sources: Record<EntryId, string> = {
    'glyph-root': `export { ${rootExports.join(', ')} } from '../dist/index.js';\n`,
    'three-bitmap': "export { bitmap, glyph } from '../dist/index.js';\nexport { Text } from '../dist/three.js';\n",
    'three-msdf': "export { glyph, msdf } from '../dist/index.js';\nexport { Text } from '../dist/three.js';\n",
    'three-slug': "export { glyph, slug } from '../dist/index.js';\nexport { Text } from '../dist/three.js';\n",
    'ktx-reader': "export { RasterKtxValidationError, validateNativeKtx2 } from '../dist/internal/raster-ktx.js';\n",
  };
  const entries = {} as Record<EntryId, string>;
  for (const entryId of entryIds) {
    const path = join(entriesRoot, `${entryId}.mjs`);
    await writeFile(path, sources[entryId]);
    entries[entryId] = path;
  }
  return entries;
}

async function measureBundle(entry: string, label: string, includeDynamic: boolean): Promise<BundleEvidence> {
  const { raw, minified } = await bundleJavaScriptVariants({
    entry,
    includeDynamic,
    label,
    workspace,
    external: isGlyphPeerDependency,
    plugins: [externalizeGlyphWasmPlugin()],
  });
  const rawModules = normalizeModules(raw);
  const minifiedModules = normalizeModules(minified);
  if (JSON.stringify(rawModules) !== JSON.stringify(minifiedModules)) {
    throw new Error(`${label} raw and minified outputs do not share one module graph`);
  }
  return {
    rawBytes: raw.bytes.byteLength,
    minifiedBytes: minified.bytes.byteLength,
    gzipBytes: gzipSync(minified.bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(minified.bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    includedModuleCount: raw.includedModules.size,
    excludedDynamicModuleCount: raw.excludedDynamicModules.size,
    includesKtxParse: rawModules.some((module) => module.includes('/node_modules/ktx-parse/')),
    includesRasterKtxModule: rawModules.some((module) => module.endsWith('/dist/internal/raster-ktx.js')),
  };
}

function assertKtxBoundary(entryId: EntryId, scope: Scope, baseline: BundleEvidence, candidate: BundleEvidence): void {
  if (candidate.includesKtxParse)
    throw new Error(`${entryId}:${scope} retains ktx-parse in the candidate runtime graph`);
  const expectsKtx = entryId === 'ktx-reader' || (entryId.startsWith('three-') && scope === 'total');
  if (expectsKtx && !baseline.includesRasterKtxModule) {
    throw new Error(`${entryId}:${scope} did not include the baseline KTX reader`);
  }
  if (expectsKtx && !candidate.includesRasterKtxModule) {
    throw new Error(`${entryId}:${scope} did not include the candidate native KTX reader`);
  }
  if (scope === 'initial' && (baseline.includesKtxParse || candidate.includesRasterKtxModule)) {
    throw new Error(`${entryId}:${scope} eagerly included a KTX reader that must remain lazy`);
  }
}

function compare(baseline: BundleEvidence, candidate: BundleEvidence): BundleComparison {
  return {
    baseline,
    candidate,
    delta: {
      rawBytes: candidate.rawBytes - baseline.rawBytes,
      rawPercent: percent(candidate.rawBytes, baseline.rawBytes),
      minifiedBytes: candidate.minifiedBytes - baseline.minifiedBytes,
      minifiedPercent: percent(candidate.minifiedBytes, baseline.minifiedBytes),
      gzipBytes: candidate.gzipBytes - baseline.gzipBytes,
      gzipPercent: percent(candidate.gzipBytes, baseline.gzipBytes),
      brotliBytes: candidate.brotliBytes - baseline.brotliBytes,
      brotliPercent: percent(candidate.brotliBytes, baseline.brotliBytes),
    },
  };
}

function percent(candidate: number, baseline: number): number {
  return Number((((candidate - baseline) / baseline) * 100).toFixed(4));
}

function normalizeModules(bundle: JavaScriptBundle): readonly string[] {
  return [...bundle.includedModules]
    .map((module) => module.split(sep).join('/'))
    .sort((left, right) => left.localeCompare(right));
}

function parseArguments(values: readonly string[]): Arguments {
  let baseline: string | undefined;
  let candidate: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index];
    const value = values[index + 1];
    if ((option === '--baseline' || option === '--candidate') && value !== undefined) {
      if (option === '--baseline') baseline = value;
      else candidate = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${String(option)}`);
  }
  if (baseline === undefined || candidate === undefined) {
    throw new Error('Usage: --baseline <git-revision> --candidate <git-revision>');
  }
  return { baseline, candidate };
}

function run(cwd: string, executable: string, values: readonly string[], redirectOutputToStderr = false): void {
  execFileSync(executable, [...values], { cwd, stdio: redirectOutputToStderr ? ['inherit', 2, 2] : 'inherit' });
}

function commandOutput(executable: string, values: readonly string[], cwd = workspace): string {
  return execFileSync(executable, [...values], { cwd, encoding: 'utf8' }).trim();
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function sha256Files(paths: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const path of paths) hash.update(await readFile(path));
  return hash.digest('hex');
}

async function readPackageVersion(path: string): Promise<string> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isRecord(value) || typeof value.version !== 'string') {
    throw new Error(`${relative(workspace, path)} has no string version`);
  }
  return value.version;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
