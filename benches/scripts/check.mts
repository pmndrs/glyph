import { buildRuntimePackages, isMainModule, runPnpm } from './support/command-cli.mts';
import { runBenchmarkBuild } from './build.mts';
import { runBenchmarkTest } from './test.mts';

export async function runBenchmarkCheck(
  options: { readonly runtimePackagesReady?: boolean; readonly staticOnly?: boolean } = {},
): Promise<void> {
  if (!options.runtimePackagesReady) await buildRuntimePackages();
  await runPnpm(['exec', 'oxfmt', process.argv.includes('--format') ? '--write' : '--check', '.']);
  await runPnpm(['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit']);
  await runPnpm(['exec', 'tsc', '-p', 'tsconfig.scripts.json', '--noEmit']);
  await runPnpm(['exec', 'oxlint', '--deny-warnings', '.']);
  if (options.staticOnly) return;
  await runBenchmarkTest({ runtimePackagesReady: true });
  await runBenchmarkBuild({ runtimePackagesReady: true });
}

if (isMainModule(import.meta.url)) {
  runBenchmarkCheck({
    runtimePackagesReady: process.argv.includes('--runtime-packages-ready'),
    staticOnly: process.argv.includes('--static'),
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}

/* @workflow { "name": "benchmark:static-check", "summary": "Check benchmark TypeScript, lint and formatting without rebuilding or running tests.", "requirements": "Built runtime packages. --format applies repository formatting to benchmark sources.", "writes": "TypeScript build metadata; source formatting only with --format.", "args": ["--runtime-packages-ready", "--static"] } */
