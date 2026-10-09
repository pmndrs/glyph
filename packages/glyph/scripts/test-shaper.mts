/* @workflow {
  "name": "glyph:shaper-tests",
  "summary": "Run retained Rust shaping and publication tests, including deterministic mutation coverage; optionally pass a test filter.",
  "requirements": "Repository-pinned stable Rust and authenticated font fixtures.",
  "writes": "Ignored Rust build outputs only."
} */
import { runCargo } from './support/command.mts';

const arguments_ = process.argv.slice(2);
const filter = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
await runCargo(['test', '--manifest-path', 'rust/shaper/Cargo.toml', '--locked', ...filter]);
