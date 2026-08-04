import { buildRuntimePackages, isMainModule, runPnpm } from './support/command-cli.mts';
import { runBenchmarkBuild } from './build.mts';
import { runBenchmarkTest } from './test.mts';

export async function runBenchmarkCheck(): Promise<void> {
  await buildRuntimePackages();
  await runPnpm(['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit']);
  await runPnpm(['exec', 'tsc', '-p', 'tsconfig.scripts.json', '--noEmit']);
  await runPnpm(['exec', 'oxlint', '--deny-warnings', '.']);
  await runPnpm(['exec', 'oxfmt', '--check', '.']);
  await runBenchmarkTest({ runtimePackagesReady: true });
  await runBenchmarkBuild({ runtimePackagesReady: true });
}

if (isMainModule(import.meta.url)) {
  runBenchmarkCheck().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
