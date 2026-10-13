/* @workflow { "name": "benchmark:compose-check", "summary": "Check types, lint and formatting for the composed-material render proof.", "requirements": "Frozen workspace dependencies and built Glyph runtime; no browser or listening server.", "writes": "No repository files." } */
import { runPnpm } from './support/command-cli.mts';

await runPnpm(['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit']);
await runPnpm(['exec', 'tsc', '-p', 'tsconfig.scripts.json', '--noEmit']);
const files = [
  'src/v1-compose-proof.ts',
  'src/slug-nonlinear-proof.ts',
  'src/slug-nonlinear-fixture.ts',
  'scripts/verify-v1-bitmap.mts',
  'scripts/check-compose.mts',
  'scripts/support/slug-footprint-control.mts',
];
await runPnpm(['exec', 'oxlint', '--deny-warnings', ...files]);
await runPnpm(['exec', 'oxfmt', '--check', ...files]);
