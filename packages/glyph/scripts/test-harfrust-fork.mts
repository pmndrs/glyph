/* @workflow {
  "name": "glyph:harfrust-fork-tests",
  "summary": "Shape the fixture fonts through the in-tree HarfRust fork and the crates.io release it was cut from, and require identical glyphs, with the fork built as Glyph consumes it and as upstream would ship it.",
  "requirements": "Repository-pinned stable Rust, the font fixtures, and the harfrust 0.12.0 crate from crates.io or the Cargo cache.",
  "writes": "Ignored Rust build outputs only."
} */
import { isMainModule, runCargo } from './support/command.mts';

const parityManifest = '../../vendor/harfrust-parity/Cargo.toml';

export async function runHarfrustForkTests(filter: readonly string[] = []): Promise<void> {
  // Release mode: the sweep shapes every ordered character pair of the kern-only fonts.
  const test = ['test', '--release', '--manifest-path', parityManifest, '--locked'];
  await runCargo([...test, ...filter]);
  await runCargo([...test, '--features', 'fork-default-features', ...filter]);
}

if (isMainModule(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  runHarfrustForkTests(arguments_[0] === '--' ? arguments_.slice(1) : arguments_).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
