import { buildRuntimePackages, isMainModule, runNodeScript } from './support/command-cli.mts';

export async function runBenchmarkBuild(options: { readonly runtimePackagesReady?: boolean } = {}): Promise<void> {
  if (!options.runtimePackagesReady) await buildRuntimePackages();
  await runNodeScript('scripts/measure-package-sizes.mts');
  await runNodeScript('node_modules/vite/bin/vite.js', ['build']);
  await runNodeScript('scripts/check-font-notices.mts');
}

if (isMainModule(import.meta.url)) {
  runBenchmarkBuild().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
