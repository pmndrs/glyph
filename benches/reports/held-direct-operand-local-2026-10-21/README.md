# Retained direct-operand experiment — local 21 October 2026

The corrected E5 variant is preserved, **not promoted as a faster successor**. Its one frozen candidate was measured
once and reused byte-for-byte against main, published 0.1.0 and E2 in complete eight-block runs. Against E2, Labs
classifies 0 faster, 14 slower and 131 neutral workloads, with no exclusions. Dense 512 and 1,024 regress by 5.8% and
10.1% in the block-median estimator. Parity remains unproved; post-parity boost waves completed: zero.

| Complete dense operation              | Main p50/p95 ms | Published p50/p95 ms | E2 p50/p95 ms   | E5 p50/p95 ms   |
| ------------------------------------- | --------------- | -------------------- | --------------- | --------------- |
| Rewrite 512 labels                    | 7.098 / 7.876   | 7.487 / 8.096        | 9.385 / 10.538  | 10.019 / 11.178 |
| Publish 1,024 retained Text instances | 15.397 / 16.381 | 15.327 / 17.232      | 18.514 / 21.048 | 20.359 / 22.668 |

These are pooled stored-sample nearest-rank quantiles. Original Labs block-median confidence intervals use a different
estimator. [All 145 identities](matrix/all-workloads.md), [CSV](matrix/all-workloads.csv),
[full quantiles](matrix/three-arm-absolute-quantiles.json) and [original reports](matrix/arms/) retain every row.
Main has three timing-mode exclusions and 10.5% software-calibration drift; published has five exclusions, two missing
baseline identities and 5.3% drift. Those warnings are not hardware clock measurements or grounds to erase rows.

## Source, artifacts and work

The [exact source patch](source/corrected-product.patch) applies to `277417596afbe2a8cd87454317d05607dc9ba51b`;
snapshot `be6c7960dd7eda8917bc43422edadca1970c1278` and named local ref/stash preserve the whole corrected variant.
The [preservation receipt](source/corrected-product-patch-preservation.json) authenticates its ten Rust files.
The packed archive SHA-256 is `83949860ae65b99fe6d7471b9782398234852668b54412870fafa81878c366a3`.
Shipping shaper SHA-256 is `8b594e2b123c35c0789a1e38ee15761e9a6a2245fdce6da1181efacbc0ab366a`;
the named artifact has identical executable sections. Binaries, raw samples and raw profiles remain ignored local
artifacts, inventoried with hashes in [copy provenance](copy-provenance.json). They cannot be recovered from this packet.

[Native replay](native/root-bitmap-direct-success-observation.json) matches 6,157 events / 4,099 results /
1,977,392 encoded bytes. Each warm direction replaces 117,760 actual gathered field writes with direct reads and
184,320 locator bytes. Physical comparison and emitted bytes remain unchanged. The 175,104 hypothetical full-field
write counter is not the actual removed work. SIMD grouping and compiled instructions do not prove runtime utilization.

The [single current CPU profile](profile/cpu-ancestry.md) uses 10 warmups, 80 iterations, 1,024 setters, zero timed
reads and scene publication. Exclusive preparation/publication/unattributed sampled CPU is
790,207 / 454,502 / 112,291 microseconds. Profile elapsed time is not a paired matrix result.

Package/native, exact replay, minimum-peer and CPU renderer-recovery gates pass within their recorded scopes.
[Artifact facts](artifact/final-artifact-gates-summary.json) retain receipts and structural ABI proof. Engine requested
live/peak maxima are 41,848,831 / 42,049,147 bytes, +1,377,716 bytes over E2/E4, with 774 versus 728 Wasm pages.
Shaper size is 1,625,526 raw / 607,475 Node gzip-9 bytes; JS and declarations match E2 byte-for-byte. Allocator evidence
excludes JS, GPU, fragmentation and transient physical realloc peaks. Final browser/hero, whole-app memory, downstream
and lifetime acceptance remain open; prior CI does not cover this dirty variant.

## Independent diagnosis and next experiment

The [wave admission](reviews/direct-hybrid-wave-admission-high.md) rejects E5 as the active performance base.
The fresh no-history [architecture diagnosis](reviews/architecture-speed-zoomout-sol-high.md) separates deferred versus
synchronous semantic work from representation and locality costs. It does not prove parity impossible.
Its [concrete feasibility brief](reviews/architecture-speed-zoomout-implementation-brief.md) explains why a literal
forward stream cannot replace indexed, reordered physical compilation or transactional old/new ownership.

The next bounded combination starts from corrected E5 and lazily constructs one borrowed semantic view per loaded
record or four-lane group, replacing per-operand slice-array construction. It preserves one Codec interpreter,
packed SIMD, locators, candidate ownership and fallback. No speed claim precedes native/cold proof and a frozen
whole-operation matrix; a partial supported gain can be retained without an arbitrary percentage floor.

The original [packet index](packet-index.md) and [copy provenance](copy-provenance.json) are exact staged copies;
their pending architecture-report note is superseded by the completed reports above, authenticated in
[supplemental provenance](supplemental-copy-provenance.json). The stack remains held and unmerged.
