# @pmndrs/text-font-baker

Internal portable bake core for `pmndrs/text`. The package keeps the Rust crate,
its Wasm boundary, TypeScript wrapper, build support, and tests together under
the monorepo package tree.

It ships one `wasm32-unknown-unknown` module built with `no_std + alloc` and an
ABI-private dynamic Talc allocator. There are no platform-native binaries, WASI imports,
Embind bindings, or generated binding runtime. Rust generates the versioned ABI
JSON at compile time from `src/abi_contract.rs`; the Wasm embeds those exact
bytes, and the `generate-abi` program emits the compiled contract for the package
build. The TypeScript shim uses it to access exported functions and response
offsets in linear memory. The package build then runs pinned Binaryen 129.0.0
with `-Oz` over the Rust release module while preserving only the bulk-memory
and nontrapping float-to-int features emitted by the pinned Rust target.

The current slice accepts source-font bytes and a V0 face descriptor, emits one
shaping-only `PMNDRS_font` GLB, and returns byte-accounting data and structured
diagnostics. Its separate `@pmndrs/text-font-baker/validate` entry validates the
complete artifact through strict GLB parsing, pinned Khronos glTF validation,
Draft-04 extension schemas, project semantics, and embedded shaping payloads.
Keeping that entry separate prevents the Ajv and Khronos engines from loading
with the small direct-memory baker wrapper. The package does not implement
project discovery, filesystem output, bitmap baking, Worker orchestration, or
runtime shaping.

```ts
import { createFontBaker } from '@pmndrs/text-font-baker';

const wasm = await fetch(wasmUrl).then((response) => response.arrayBuffer());
const baker = await createFontBaker(wasm);
const result = baker.bake({
  source: sourceBytes,
  descriptor: { formatVersion: 0, fontFaceIndex: 0 },
});
```

Validate untrusted baked bytes before registration:

```ts
import { validateFontArtifact } from '@pmndrs/text-font-baker/validate';

const validated = await validateFontArtifact(result.artifacts[0].bytes);
```

Build and verify the package from the repository root:

```sh
pnpm --filter @pmndrs/text-font-baker build
pnpm --filter @pmndrs/text-font-baker test
```

The test command keeps four lanes explicit: Rust unit tests, public Rust and
compiled Wasm/package/schema/malformed-input integration tests, deterministic
fixed-seed fuzz smoke, and a real-font vertical-slice test.
The real-font lane never substitutes generated font bytes for product evidence;
it always verifies and bakes the checked-in, licensed, hash-pinned Inter 4.1
fixture. The resulting reduced SFNT is validated structurally and shaped through
the complete checked-in corpus with HarfRust 0.12.0.

Run longer seeded validator and source-font mutation campaigns locally with
`pnpm run fuzz validator` and `pnpm run fuzz mutation`. The primary coverage-guided `pnpm run fuzz rust`
lane uses nested mise configuration to isolate exact `nightly-2026-06-01`,
cargo-fuzz 0.13.2, and libfuzzer-sys 0.4.13 from the stable product toolchain.
Any minimized finding must become a checked-in malformed fixture and ordinary
stable-toolchain regression test.

Emit the exact ABI JSON generated into the current Rust build:

```sh
pnpm --filter @pmndrs/text-font-baker generate:abi
```

The package is internal. The planned public Node surface remains
`@pmndrs/text/bake`, which will orchestrate this core without exposing its Wasm
memory protocol.
