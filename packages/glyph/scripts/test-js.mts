/* @workflow {
  "name": "glyph:test-js",
  "summary": "Run focused Glyph JavaScript tests against the built package; accepts package-relative test globs.",
  "requirements": "Built Glyph package and its test fixtures.",
  "writes": "Test-owned temporary files, removed by test cleanup."
} */
import { runNodeTests } from './support/command.mts';

const patterns = process.argv.slice(2);
await runNodeTests(patterns.length === 0 ? ['tests/package/*.test.mjs', 'tests/integration/*.test.mjs'] : patterns);
