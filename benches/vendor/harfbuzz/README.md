# Vendored HarfBuzz utilities

The benchmark and fixture workflows use authenticated, platform-specific `hb-shape`, `hb-subset`, and `hb-info`
bundles instead of compiling HarfBuzz during CI or local verification.

- HarfBuzz 13.0.0 preserves the existing independent shaping-oracle contract.
- HarfBuzz 14.2.0 serves current subset and glyph-information workloads.
- Runtime provisioning verifies the source identity, target, every file's SHA-256 and size, and each utility's reported
  version before materializing the ignored `.cache/harfbuzz` layout.
- Linux x64 and macOS arm64 are currently supported. Other targets fail explicitly.

Regenerate one bundle through the indexed repository workflow:

```sh
pnpm scripts run fixture:harfbuzz:vendor -- --version 14.2.0 --target linux-x64
```

Linux uses the digest-pinned Ubuntu builder under `benches/scripts/harfbuzz-vendor`. macOS bundles must be built on the
matching architecture. The recipe authenticates the upstream release archive, statically links non-system dependencies,
records `ldd` or `otool` evidence, strips the utilities, and writes the checked manifest and license files.
