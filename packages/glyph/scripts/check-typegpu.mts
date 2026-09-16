/* @workflow {
  "name": "glyph:typegpu-check",
  "summary": "Check TypeGPU integration declarations and focused shader/entrypoint tests.",
  "requirements": "Workspace dependencies and built Glyph distribution.",
  "writes": "TypeScript build metadata"
} */
import { runNode, runNodeTests, runPnpm } from './support/command.mts';
await runPnpm(['exec', 'oxlint', '--deny-warnings', '.']);
await runPnpm(['exec', 'oxfmt', '--check', '.']);
await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.shader-types.json']);
await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json', '--noEmit']);
await runNodeTests([
  'tests/package/typegpu-*.test.mjs',
  'tests/package/slug-shader-source.test.mjs',
  'tests/package/entry-point-boundaries.test.mjs',
  'tests/package/esm-only.test.mjs',
  'tests/package/packed-package.test.mjs',
]);
