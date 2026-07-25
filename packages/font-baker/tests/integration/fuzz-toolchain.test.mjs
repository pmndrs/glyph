import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the fuzz-only nightly exception is exact, isolated, and mise-owned", async () => {
  const [productToolchain, fuzzToolchain, fuzzMise, fuzzManifest, fuzzLock, runner] =
    await Promise.all([
      readFile(new URL("../../../../rust-toolchain.toml", import.meta.url), "utf8"),
      readFile(new URL("../../fuzz/rust-toolchain.toml", import.meta.url), "utf8"),
      readFile(new URL("../../fuzz/mise.toml", import.meta.url), "utf8"),
      readFile(new URL("../../fuzz/Cargo.toml", import.meta.url), "utf8"),
      readFile(new URL("../../fuzz/Cargo.lock", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/fuzz-rust.mjs", import.meta.url), "utf8"),
    ]);

  assert.match(productToolchain, /channel = "1\.97\.1"/);
  assert.doesNotMatch(productToolchain, /nightly/);
  assert.match(fuzzToolchain, /channel = "nightly-2026-06-01"/);
  assert.match(fuzzToolchain, /components = \["clippy", "rustfmt"\]/);
  assert.doesNotMatch(fuzzToolchain, /channel = "nightly"\s*$/m);
  assert.match(fuzzMise, /idiomatic_version_file_enable_tools = \["rust"\]/);
  assert.match(fuzzMise, /"cargo:cargo-fuzz" = "0\.13\.2"/);
  assert.match(fuzzManifest, /libfuzzer-sys = "=0\.4\.13"/);
  assert.match(fuzzLock, /name = "libfuzzer-sys"\nversion = "0\.4\.13"/);
  assert.match(
    fuzzManifest,
    /pmndrs-text-font-baker = \{ path = "\.\.\/rust", default-features = false, features = \["std"\] \}/,
  );
  assert.match(runner, /mise/);
  assert.match(runner, /cargo-fuzz 0\.13\.2/);
  assert.match(runner, /rustc 1\.98\.0-nightly \(14210df0e 2026-05-31\)/);
  assert.match(runner, /Inter-Regular\.ttf/);
  assert.match(runner, /-seed=1347243588/);
  assert.doesNotMatch(runner, /\+nightly/);
});
