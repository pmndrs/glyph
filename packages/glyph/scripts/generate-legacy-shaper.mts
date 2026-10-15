/* @workflow {
  "name": "glyph:legacy-shaper-fixture",
  "summary": "Rebuild the authenticated ABI 0 shaper fixture from the pre-anchor revision.",
  "requirements": "Git history containing d7ffcbbd, pinned Rust with wasm32 target, and package dependencies.",
  "writes": "The package-owned historical Wasm fixture and its provenance manifest."
} */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reproducibleRustEnvironment } from './support/reproducible-rust-env.mjs';

const revision = 'd7ffcbbdc5a38635604570f76395005e2d195d9a';
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const directory = new URL('../tests/fixtures/wasm/', import.meta.url);
const staging = await mkdtemp(join(tmpdir(), 'glyph-legacy-shaper-'));
try {
  const archive = execFileSync(
    'git',
    ['archive', revision, 'packages/glyph/rust/shaper', 'packages/glyph/rust/slug-core'],
    { cwd: workspace, maxBuffer: 32 * 1024 * 1024 },
  );
  execFileSync('tar', ['-xf', '-', '-C', staging], { input: archive });
  execFileSync(
    'cargo',
    [
      'build',
      '--manifest-path',
      join(staging, 'packages/glyph/rust/shaper/Cargo.toml'),
      '--target',
      'wasm32-unknown-unknown',
      '--release',
      '--no-default-features',
      '--locked',
    ],
    { env: reproducibleRustEnvironment(staging), stdio: 'inherit' },
  );
  const bytes = await readFile(
    join(staging, 'packages/glyph/rust/shaper/target/wasm32-unknown-unknown/release/pmndrs_glyph_shaper.wasm'),
  );
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('text-shaper-v0.wasm', directory), bytes);
  await writeFile(
    new URL('text-shaper-v0.json', directory),
    `${JSON.stringify(
      {
        revision,
        abiVersion: 0,
        semanticRecordBytes: 76,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        generator: 'glyph:legacy-shaper-fixture',
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
