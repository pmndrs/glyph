/* @workflow {
  "name": "glyph:node-tests",
  "summary": "Run selected Glyph Node test files, or all package and integration tests.",
  "requirements": "Built Glyph distribution. Pass package-relative test paths to select a focused lane.",
  "writes": "Test-owned temporary fixtures."
} */
import { runNodeTests } from './support/command.mts';

const arguments_ = process.argv.slice(2);
const files = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
await runNodeTests(files.length === 0 ? ['tests/package/*.test.mjs', 'tests/integration/*.test.mjs'] : files);
