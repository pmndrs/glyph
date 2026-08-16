# Font baker coverage-guided fuzzing

This isolated workspace uses libFuzzer against package-owned Rust boundaries. `bake_font` exercises
the shaping-data baker, while `mtsdf_outline` exercises bounded contour streams through the candidate
generator's intersection cleanup and MTSDF generation. It is intentionally outside the product crate
workspaces: the product remains on stable Rust `1.97.1`, while this directory pins exact
`nightly-2026-06-01` / rustc commit `14210df0e` required by libFuzzer.

The nested mise configuration consumes this directory's `rust-toolchain.toml` and installs exact
`cargo-fuzz` 0.13.2. From the repository root:

```sh
pnpm --filter @pmndrs/glyph/bake run fuzz rust
pnpm --filter @pmndrs/glyph/bake run fuzz mtsdf
```

For a bounded verification run:

```sh
pnpm --filter @pmndrs/glyph/bake run fuzz rust -- -runs=1000 -max_len=1048576
pnpm --filter @pmndrs/glyph/bake run fuzz mtsdf -- -runs=1000 -max_len=1666
```

The nightly exception is confined to this workspace and never builds the distributed Wasm or product
crate. A compiler or runner upgrade changes the exact pins, lockfile, drift test, package reference, and
version contract in the same atomic commit. Minimized failures must be copied into the checked-in
malformed corpus and gain an ordinary stable-toolchain regression test before transient artifacts are
cleared. The evolving local libFuzzer corpus and crash artifacts live under ignored `target/`; valuable
cases are promoted before `cargo clean` removes that transient state.
