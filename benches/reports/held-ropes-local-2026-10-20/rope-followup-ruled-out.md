# Source checks before selecting another wave

These are source and fixture-lifetime findings, not measured CPU attribution or a new performance result.

- The ordered updater's lazily allocated changed-leaf Vec is moved into the final leaf. The old exact builder also allocates the final leaf Vec. The source does not establish an additional temporary leaf allocation introduced by this wave.
- RetainedRope::clear already clears and reuses a uniquely owned leaf; shared snapshots remain protected. A proposed unique-leaf reuse optimization would duplicate existing behavior.
- ClusterArena::build uses retained flat SoA vectors, clears/reserves them and fills their columns. It does not construct one retained-rope node per glyph. Its layout-unit sidecars also retain vector capacity.
- Staged<T> swaps committed and pending state on successful commit and preserves the pending allocation across rejected candidates. Generic pending-buffer reuse already exists.
- The dense batching and 1024-label benchmark generators create one fixture, yield a closure used for sampling, then clean up. Installed @pmndrs/labs 0.9 creates the generator once, pilots the closure, and samples the same closure. Single-call sampling does not recreate the fixture each sample. The native first-publication repack therefore cannot be charged to every timed sample without further evidence.
- Current native counters do not measure allocator calls, SIMD batch frequency, scalar tail frequency, or GC churn. They cannot establish those costs.

No implementation was selected from these hypotheses. Inspect the optimized frozen Wasm only after all predeclared timing arms finish. Preserve source-valid inconclusive combinations; do not infer savings from source initialization byte counts.
