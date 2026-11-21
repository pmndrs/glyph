import { isMainModule, runCargo, runNode, runPnpm } from './support/command.mts';
import { runGlyphTest } from './test.mts';

const rustCrates = [
  'bitmap-baker',
  'font-baker',
  'mtsdf-admission',
  'mtsdf-baker',
  'mtsdf-core',
  'mtsdf-fontations',
  'raster-artifact',
  'shaper',
  'slug-baker',
  'slug-core',
  'slug-fontations',
] as const;

// The parity crate is repository-owned code beside the vendored HarfRust fork. The fork itself keeps upstream's
// formatting and lint configuration and is checked there, not here.
const rustManifests = [
  ...rustCrates.map((crate) => `rust/${crate}/Cargo.toml`),
  '../../vendor/harfrust-parity/Cargo.toml',
];

export async function runGlyphCheck(): Promise<void> {
  await runGlyphTest();
  await runGlyphStaticCheck();
}

export async function runGlyphStaticCheck(): Promise<void> {
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json', '--noEmit']);
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.slug-shaders.json', '--noEmit']);
  // Emitted public declarations must survive strict consumers: stripInternal can orphan a
  // symbol that source-level checks never see. Peer-bound React and TypeGPU leaves are
  // exercised separately against dist with dependency declaration checking disabled: the
  // pinned peers currently contain TypeScript 7 declaration errors outside this package.
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.dist-declarations.json']);
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.dist-peer-declarations.json']);
  await runPnpm(['exec', 'oxlint', '--deny-warnings', '.']);
  await runPnpm(['exec', 'oxfmt', '--check', '.']);
  // The Rust crates carried 42 rustfmt diffs and 18 Clippy findings before this gate
  // existed, because nothing ran either. The fuzz crate is excluded: it is pinned to its
  // own dated nightly for cargo-fuzz and does not share this toolchain.
  for (const manifest of rustManifests) {
    await runCargo(['fmt', '--manifest-path', manifest, '--', '--check']);
    await runCargo(['clippy', '--manifest-path', manifest, '--locked', '--all-targets', '--', '-D', 'warnings']);
  }
}

if (isMainModule(import.meta.url)) {
  runGlyphCheck().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
