# @pmndrs/text-font-baker

Internal portable bake core for `pmndrs/text`. The package keeps the Rust crate,
its Wasm boundary, TypeScript wrapper, build support, and tests together under
the monorepo package tree.

It ships one `wasm32-unknown-unknown` module built with `no_std + alloc` and an
ABI-private `dlmalloc`. There are no platform-native binaries, WASI imports,
Embind bindings, or generated binding runtime. Rust generates the versioned ABI
JSON at compile time from `src/abi_contract.rs`; the Wasm embeds those exact
bytes, and the `generate-abi` program emits the compiled contract for the package
build. The TypeScript shim uses it to access exported functions and response
offsets in linear memory.

The current slice accepts source-font bytes and a V0 face descriptor, emits one
shaping-only `PMNDRS_font` GLB, and returns byte-accounting data and structured
diagnostics. It does not implement project discovery, filesystem output, bitmap
baking, Worker orchestration, or runtime shaping.

```ts
import { createFontBaker } from '@pmndrs/text-font-baker'

const wasm = await fetch(wasmUrl).then((response) => response.arrayBuffer())
const baker = await createFontBaker(wasm)
const result = baker.bakeFont(sourceBytes, { fontFaceIndex: 0 })
```

Build and verify the package from the repository root:

```sh
pnpm --filter @pmndrs/text-font-baker build
pnpm --filter @pmndrs/text-font-baker test
```

The test command keeps three lanes explicit: Rust unit tests, public Rust and
compiled Wasm/package integration tests, and a real-font vertical-slice test.
The real-font lane never substitutes generated font bytes for product evidence;
until the canonical repository font is licensed and pinned, provide one locally:

```sh
PMNDRS_TEXT_TEST_FONT=/absolute/path/to/font.ttf \
  pnpm --filter @pmndrs/text-font-baker test:e2e
```

The test is reported as skipped when the variable is absent. It becomes a
required CI lane once the canonical fixture manifest owns the exact font bytes,
license, version, and SHA-256 hash.

Emit the exact ABI JSON generated into the current Rust build:

```sh
pnpm --filter @pmndrs/text-font-baker generate:abi
```

The package is internal. The planned public Node surface remains
`@pmndrs/text/bake`, which will orchestrate this core without exposing its Wasm
memory protocol.
