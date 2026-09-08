/* @workflow {
  "name": "benchmark:unit",
  "summary": "Run benchmark unit tests, optionally selecting Vitest test files or filters.",
  "requirements": "Workspace dependencies and built runtime packages.",
  "writes": "Vitest cache"
} */
import { runNodeScript } from './support/command-cli.mts';

const args = process.argv.slice(2);
await runNodeScript('node_modules/vitest/vitest.mjs', ['run', ...(args[0] === '--' ? args.slice(1) : args)]);
