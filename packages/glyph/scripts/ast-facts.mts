/* @workflow {
  "name": "glyph:ast-facts",
  "summary": "Emit structural facts about every Rust function and struct as JSONL, for review and audit work.",
  "requirements": "The pinned Rust toolchain. Accepts --out <path> to write a file instead of stdout.",
  "writes": "stdout, or the JSONL path passed to --out"
} */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule, runCargo } from './support/command.mts';

/**
 * Structural facts about the Rust tree, one JSON object per line.
 *
 * Review questions here are structural — which functions allocate inside a loop, which
 * `unsafe fn` carry a `# Safety` section, how many parallel columns an arena holds — and grep
 * cannot answer them, because it cannot see loop nesting, `#[cfg(test)]` scope, or the
 * difference between a method call and a macro. `rust/ast-facts` parses every file with `syn`
 * and emits those facts; this drives it.
 *
 * The tool reports type-dependent method calls (`clone`, `join`) separately from unambiguous
 * allocations, because `syn` is a parser and not a compiler: `Range<usize>::clone()` is free
 * while `Vec<u8>::clone()` allocates, and nothing short of type resolution tells them apart.
 * Read those sites before believing them.
 *
 *   pnpm scripts run glyph:ast-facts
 *   pnpm scripts run glyph:ast-facts -- --out .cache/ast-facts.jsonl
 */
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rustRoot = resolve(packageRoot, 'rust');
const manifest = resolve(rustRoot, 'ast-facts/Cargo.toml');
const binary = resolve(rustRoot, 'ast-facts/target/release/ast-facts');

export async function runAstFacts(argv: readonly string[] = []): Promise<void> {
  const outIndex = argv.indexOf('--out');
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  if (outIndex >= 0 && out === undefined) throw new Error('--out requires a path');

  await runCargo(['build', '--release', '--locked', '--quiet', '--manifest-path', manifest]);

  const { spawn } = await import('node:child_process');
  const destination = out === undefined ? undefined : resolve(process.cwd(), out);
  if (destination !== undefined) await mkdir(dirname(destination), { recursive: true });

  await new Promise<void>((settle, fail) => {
    // The tool walks the tree itself; it is given the crate root rather than a file list so a
    // new crate is covered the day it is added.
    const child = spawn(binary, [rustRoot], {
      cwd: packageRoot,
      stdio: ['ignore', destination === undefined ? 'inherit' : 'pipe', 'inherit'],
    });
    if (destination !== undefined) child.stdout?.pipe(createWriteStream(destination));
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0 ? settle() : fail(new Error(`ast-facts exited with ${String(code)}`)),
    );
  });

  if (destination !== undefined) process.stderr.write(`ast-facts → ${destination}\n`);
}

if (isMainModule(import.meta.url)) await runAstFacts(process.argv.slice(2));
