/* @workflow {
  "name": "glyph:static-check",
  "summary": "Run Glyph's shared TypeScript, declaration, formatting and Rust lint gates without rebuilding or rerunning tests.",
  "requirements": "Workspace dependencies, repository-pinned Rust tools and a current built Glyph distribution. This is the static portion of the full package check, not a replacement for its test gates.",
  "writes": "TypeScript build metadata and Rust check artifacts."
} */
import { runGlyphStaticCheck } from './check.mts';

await runGlyphStaticCheck();
