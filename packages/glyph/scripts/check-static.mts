/* @workflow {
  "name": "glyph:static-check",
  "summary": "Run Glyph's shared TypeScript, declaration, formatting and Rust lint gates without rebuilding or rerunning tests.",
  "requirements": "Workspace dependencies, repository-pinned Rust tools and a current built Glyph distribution. --format applies repository formatting first. This is the static portion of the full package check, not a replacement for its test gates.",
  "writes": "TypeScript build metadata and Rust check artifacts; source formatting only with --format."
} */
import { runGlyphStaticCheck } from './check.mts';
import { runPnpm } from './support/command.mts';

if (process.argv.includes('--format')) await runPnpm(['exec', 'oxfmt', '--write', '.']);
await runGlyphStaticCheck();
