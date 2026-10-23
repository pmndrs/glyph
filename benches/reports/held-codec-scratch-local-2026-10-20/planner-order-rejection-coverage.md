Existing downstream coverage retained for the publication-request deletion.

`packages/glyph/tests/integration/engine-font-binding.test.mjs` contains `base-order publication admits swaps and preserves pending order across semantic preparation`. It exercises unique-order swaps, independent semantic preparation, duplicate-order rejection and repair, pending creation disposal, removal plus same-order creation, lifecycle plus order plus ordinary setter, rejected semantic preparation with pending order retained, and former-order reuse after publication. This tests actual Rust ownership through the existing planner and real installed Wasm. No private array-identity test is added. Fresh candidate execution remains required.

Source SHA256: 8863339e24313eda0a68f917ea55fa3935bc5fdd06c653644843c54ac2edd56a
Selected test text SHA256: ae981fc70ffa96ce6a4c3b56f2944a77412ddfcbe4866f17686da27d1771efd6
