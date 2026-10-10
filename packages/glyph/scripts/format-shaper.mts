/* @workflow {
  "name": "glyph:shaper-format",
  "summary": "Format retained Rust shaper source with the repository-pinned formatter.",
  "requirements": "Repository-pinned stable Rust.",
  "writes": "Rust shaper source formatting."
} */
import { runCargo } from './support/command.mts';

await runCargo(['fmt', '--manifest-path', 'rust/shaper/Cargo.toml']);
