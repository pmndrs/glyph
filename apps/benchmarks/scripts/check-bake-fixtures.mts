/* @workflow
{
  "name": "benchmark:bake-check",
  "summary": "Verify every deterministic benchmark bake and authenticated Japanese subset.",
  "requirements": "Core toolchain plus the scoped HarfBuzz utilities for the Japanese subset.",
  "writes": "Temporary build outputs only; checked-in fixtures must remain unchanged.",
  "args": []
}
*/

import { buildRuntimePackages, isMainModule, runNodeScript } from './support/command-cli.mts';

const fixtureChecks = [
  'generate-showcase-raster-fixtures.mts',
  'generate-mtsdf-render-fixture.mts',
  'generate-slug-render-fixture.mts',
  'generate-paragraph-conformance-font.mts',
  'generate-paragraph-bidi-contract.mts',
  'generate-paragraph-cjk-contract.mts',
] as const;

export async function checkBakeFixtures(): Promise<void> {
  await buildRuntimePackages();
  for (const script of fixtureChecks) await runNodeScript(`scripts/${script}`, ['--check']);
  await runNodeScript('scripts/check-paragraph-contract-fixtures.mts');
  await runNodeScript('scripts/provision-harfbuzz.mts', ['--check']);
  await runNodeScript('scripts/generate-japanese-showcase-subset.mts', ['--check']);
}

if (isMainModule(import.meta.url)) {
  checkBakeFixtures().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
