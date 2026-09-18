/* @workflow {
  "name": "glyph:unit",
  "summary": "Run Glyph JavaScript package and integration tests, optionally selecting package-relative test globs.",
  "requirements": "Workspace dependencies and built Glyph distribution.",
  "writes": "No persistent output"
} */
import { runNodeTests } from './support/command.mts';

const arguments_ = process.argv.slice(2).filter((argument) => argument !== '--');
await runNodeTests(arguments_.length === 0 ? ['tests/package/*.test.mjs', 'tests/integration/*.test.mjs'] : arguments_);
