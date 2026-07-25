import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";

const fuzzDirectory = new URL("../fuzz/", import.meta.url);
const corpusDirectory = new URL("target/corpus/bake_font/", fuzzDirectory);
await mkdir(new URL("target/artifacts/bake_font/", fuzzDirectory), { recursive: true });
await mkdir(corpusDirectory, { recursive: true });
await copyFile(
  new URL("../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf", fuzzDirectory),
  new URL("inter-v4.1-40d692fc.ttf", corpusDirectory),
);
const rustc = spawnSync("mise", ["exec", "--", "rustc", "--version"], {
  cwd: fuzzDirectory,
  encoding: "utf8",
});
const expectedRustc = "rustc 1.98.0-nightly (14210df0e 2026-05-31)";
if (rustc.error?.code === "ENOENT") {
  throw new Error("The coverage-guided Rust fuzz lane requires mise. Install mise, then rerun.");
}
if (rustc.status !== 0 || rustc.stdout.trim() !== expectedRustc) {
  throw new Error(
    `Expected ${expectedRustc}, received ${rustc.stdout.trim() || rustc.stderr.trim()}`,
  );
}
const mise = spawnSync("mise", ["exec", "--", "cargo", "fuzz", "--version"], {
  cwd: fuzzDirectory,
  encoding: "utf8",
});
if (mise.status !== 0) {
  throw new Error("mise could not provision the pinned Rust fuzz toolchain", {
    cause: mise.error ?? mise.stderr.trim(),
  });
}
if (mise.stdout.trim() !== "cargo-fuzz 0.13.2") {
  throw new Error(`Expected cargo-fuzz 0.13.2, received ${mise.stdout.trim()}`);
}

const arguments_ = process.argv.slice(2);
while (arguments_[0] === "--") arguments_.shift();
const result = spawnSync(
  "mise",
  [
    "exec",
    "--",
    "cargo",
    "fuzz",
    "run",
    "bake_font",
    "--fuzz-dir",
    ".",
    "target/corpus/bake_font",
    "--",
    "-seed=1347243588",
    "-artifact_prefix=target/artifacts/bake_font/",
    ...(arguments_.length === 0 ? ["-max_len=1048576"] : arguments_),
  ],
  { cwd: fuzzDirectory, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
