---
type: Audit Report
title: Rust review — Slug, bitmap, font-baker and raster-artifact
description: Findings from the Slug, bitmap, font-baker and raster-artifact review, with file and line references, before/after snippets, and a confidence level per finding.
documentation_type: reference
tags: [rust, audit, bakers, fonts, untrusted-input]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Slug / bitmap / font-baker deep review

Scope: `slug-core/`, `slug-baker/`, `slug-fontations/`, `font-baker/` (incl. `font-baker-fuzz/`), `bitmap-baker/`, `raster-artifact/`. Every file in scope was read in full except `slug-baker/src/abi_contract.rs` (trivial, same shape as `font-baker/src/abi_contract.rs`, not touched) and `bitmap-baker/src/wasm.rs`/`bitmap-baker/src/abi_contract.rs` (grep-verified against the pattern already confirmed correct in `font-baker/src/wasm.rs`). All findings below were reached by reading and tracing call graphs, not by pattern-matching the AST facts file.

---

## B1 — `subsetting` feature (the code that actually ships) has zero fuzz coverage

**Severity:** high
**File:** `font-baker-fuzz/Cargo.toml:12`, `font-baker/tests/fuzz_smoke.rs`, `font-baker/src/bin/fuzz-bake.rs`, cross-checked against `packages/glyph/scripts/build.mjs:249-262`

**What:** The production wasm build compiles `font-baker` with `--no-default-features --features subsetting`:

```js
// packages/glyph/scripts/build.mjs:249-262
await run('cargo', [
  'build', '--manifest-path', 'rust/font-baker/Cargo.toml',
  '--target', 'wasm32-unknown-unknown', '--release', '--locked',
  '--no-default-features', '--features', 'subsetting',
], rustEnvironment);
```

`subsetting = ["std", "dep:skera"]` (`font-baker/Cargo.toml`) gates `source_font.rs`'s `prepare_font`/`inspect_font`, and their wasm entry points `pmndrs_font_baker_prepare`/`pmndrs_font_baker_inspect` (`font-baker/src/wasm.rs:80-141`) — both take raw untrusted `source: &[u8]` font bytes exactly like `bake_font` does. `prepare_font` additionally drives `skera::subset_font`, a full third-party font-subsetting engine that rewrites glyf/loca and friends — the highest-complexity, highest-risk code this crate touches.

All three fuzz surfaces exercise only `bake_font`/`sfnt.rs`:
- `font-baker-fuzz/fuzz_targets/bake_font.rs` via `font-baker-fuzz/Cargo.toml:12`: `pmndrs-glyph-font-baker = { path = "../font-baker", default-features = false, features = ["std"] }` — no `subsetting`.
- `font-baker/tests/fuzz_smoke.rs` (deterministic pseudo-fuzz) imports only `bake_font`.
- `font-baker/src/bin/fuzz-bake.rs` (mutation fuzzer, run via `packages/glyph/scripts/font-baker/fuzz-rust-mutation.mjs:15-17` with `--features fuzzing`) imports only `bake_font`.

**Why it matters:** The one code path this repo's fuzzing infrastructure was built to protect (`bake_font`/`sfnt.rs`, which delegates all offset/length parsing to `read_fonts`) is the *lower*-risk one, since it never runs a subsetting engine over the bytes. The path that ships to the browser and does the riskiest transformation of untrusted bytes (`prepare_font` → `skera::subset_font`) has no fuzz target, no mutation coverage, and no smoke test at all in this repository.

**Before / After:**
```rust
// font-baker-fuzz/Cargo.toml — before
pmndrs-glyph-font-baker = { path = "../font-baker", default-features = false, features = ["std"] }

// after: add a second target (or feature-gate the existing one) that exercises the shipped surface
pmndrs-glyph-font-baker = { path = "../font-baker", default-features = false, features = ["subsetting"] }
```
```rust
// a new fuzz_targets/prepare_font.rs mirroring bake_font.rs, calling
// pmndrs_glyph_font_baker::prepare_font(input, FontSelectionV0 { .. })
// with a small arbitrary-derived unicode_ranges seed
```

**Confidence:** certain (feature flags, Cargo manifests, and all three harness entry points were read directly; the build script was read directly).

---

## B2 — `slug-core::packer::div_ceil` has an unchecked `divisor - 1` that can divide by zero

**Severity:** medium
**File:** `slug-core/src/packer.rs:629-634`

**What:**
```rust
fn div_ceil(value: usize, divisor: usize) -> Result<usize, PackError> {
    value
        .checked_add(divisor - 1)
        .map(|sum| sum / divisor)
        .ok_or(PackError::ArithmeticOverflow)
}
```
`divisor - 1` is a bare subtraction in a file that otherwise checks *every* arithmetic op that could plausibly fail (`checked_add`/`checked_mul`/`checked_sub` appear ~30 times in this file). With `overflow-checks` off in release, `divisor == 0` makes `divisor - 1` wrap to `usize::MAX`. For `value == 0`, `0.checked_add(usize::MAX) == Some(usize::MAX)`, and the closure then runs `usize::MAX / 0` — an unconditional division-by-zero panic (integer div-by-zero panics in Rust regardless of the `overflow-checks` profile setting). For `value >= 1` it instead returns `Err(ArithmeticOverflow)`, which is merely a misleading error code, not a panic.

**Why it matters:** In a `panic = "abort"` wasm module with a `core::arch::wasm32::unreachable()` panic handler, any panic traps the entire module for the rest of the page session, not just the current call. Both real call sites are currently protected:
- `pack_page` (line 304-307) always calls with `value = estimated_curve_texels.max(1)` (never 0) and `divisor = config.curve_width`, guarded `>= 2` by `validate_config` (line 236).
- `grid()` (line 620) calls with `value = count.max(1)` and a `width` that is provably `>= 1` given `validate_config`'s `header_width == 0`/`reference_width == 0` rejection (lines 238-239).

So `div_ceil(0, 0)` is unreachable *today* — but only because two independent upstream checks both happen to hold. `div_ceil` itself has no local guard, so any future caller (or a loosened `validate_config`) reintroduces a live panic in the packer this task explicitly prioritized for correctness.

**Before / After:**
```rust
// before
fn div_ceil(value: usize, divisor: usize) -> Result<usize, PackError> {
    value
        .checked_add(divisor - 1)
        .map(|sum| sum / divisor)
        .ok_or(PackError::ArithmeticOverflow)
}

// after
fn div_ceil(value: usize, divisor: usize) -> Result<usize, PackError> {
    if divisor == 0 {
        return Err(PackError::ArithmeticOverflow);
    }
    value
        .checked_add(divisor - 1)
        .map(|sum| sum / divisor)
        .ok_or(PackError::ArithmeticOverflow)
}
```

**Confidence:** certain that the bug exists (traced the exact wrap-then-divide-by-zero path by hand); certain it is unreachable via the two current call sites (traced both back through `validate_config`).

---

## B3 — `slug-baker::wasm::encode_artifact_response` truncates with `as u32` where the sibling crates use `try_from`

**Severity:** medium
**File:** `slug-baker/src/wasm.rs:444-445`

**What:**
```rust
fn encode_artifact_response(
    prepared: PreparedArtifactResponse,
) -> Result<Vec<u8>, PreparedArtifactResponse> {
    let metadata_length = prepared.metadata.len() as u32;
    let artifact_length = prepared.artifact_bytes_length as u32;
    ...
```
Both fields are `usize` and both are cast with a truncating `as u32` rather than `u32::try_from(..)`. Compare the structurally identical functions in the other two baker crates, both of which re-validate at the point of use instead of trusting an upstream check:
```rust
// font-baker/src/wasm.rs:216-227 (encode_envelope)
let Ok(metadata_len) = u32::try_from(metadata.len()) else {
    return encode_response(Err(BakeError::new(BakeErrorCode::IntegerOverflow, "...")));
};
let Ok(artifact_len) = u32::try_from(artifact.len()) else { ... };
```
```rust
// bitmap-baker/src/wasm.rs:148,154 (encode_response) — same pattern, grep-confirmed
let Ok(metadata_len) = u32::try_from(metadata.len()) else { ... };
let Ok(artifact_len) = u32::try_from(artifact_bytes.len()) else { ... };
```

**Why it matters:** if `metadata.len()` or `artifact_bytes_length` ever exceeded `u32::MAX` when this function runs, the truncating cast would silently wrap to a small value, and the response header would then claim a length far shorter than the bytes actually appended (`response.extend_from_slice(&prepared.metadata)` / per-artifact `extend_from_slice` still append the *real*, untruncated bytes) — a corrupted-but-not-panicking response the JS host would misparse. Today this is unreachable: the only two constructors of `PreparedArtifactResponse` are `prepare_artifact_response` (which explicitly checks `u32::try_from(offset).is_err()` at line 396 and `u32::try_from(metadata.len()).is_err()` at line 416 *before* building the struct) and `prepared_error_response` (whose `metadata` is always a small serialized `SlugBakeError`). The struct and its fields are private to this one file (confirmed via `slug-baker/src/lib.rs`, which does not re-export `wasm`), so the blast radius of a future mistake is contained — but `encode_artifact_response` itself doesn't know that, and the two sibling crates prove the locally-defensive version was the team's own established idiom one file away.

**Before / After:**
```rust
// after
let Ok(metadata_length) = u32::try_from(prepared.metadata.len()) else {
    return Err(prepared);
};
let Ok(artifact_length) = u32::try_from(prepared.artifact_bytes_length) else {
    return Err(prepared);
};
```

**Confidence:** certain the cast is unchecked and inconsistent with `font-baker`/`bitmap-baker`'s equivalent functions (all three read directly); certain it's unreachable today (traced both constructors of `PreparedArtifactResponse`, and confirmed the type is file-private via `slug-baker/src/lib.rs`).

---

## B4 — `raster-artifact::coverage::canonical_raster_coverage_json` panics on a serialization failure that a sibling file already treats as recoverable

**Severity:** medium
**File:** `raster-artifact/src/coverage.rs:209-212`

**What:**
```rust
pub fn canonical_raster_coverage_json(coverage: &RasterCoverageV0) -> String {
    serde_json::to_string(&raster_coverage_json_value(coverage))
        .expect("validated raster coverage serializes to JSON")
}
```
This is on the mainline path, not an edge case: `bitmap-baker::descriptor_raster_key` (`bitmap-baker/src/lib.rs:155-178`, called unconditionally by every `bake_bitmap`) and `mtsdf-baker::artifact.rs:173` both call it whenever a `coverage` descriptor is present. `serde_json::to_string` can only fail here on allocation failure (the `Value` tree built by `raster_coverage_json_value` has no floats, no non-UTF8 content, and no cycles, so the only failure mode is OOM inside the `String` writer).

Contrast with the structurally identical operation one crate over:
```rust
// font-baker/src/wasm.rs:166-169
serde_json::to_vec(&metadata).unwrap_or_else(|_| {
    b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize result\"}".to_vec()
})
```

**Why it matters:** in this codebase's `panic = "abort"` + `unreachable()`-trap wasm modules, any panic kills the whole module for the rest of the session — not just the current bake call. `try_reserve`/`try_reserve_exact` are used deliberately everywhere else in this codebase specifically to convert allocator exhaustion into a `Result` instead of an abort; this one call reintroduces exactly the abort this project otherwise goes out of its way to avoid, on a call path that isn't rare (any coverage-bounded bitmap or mtsdf bake).

**Before / After:**
```rust
// after
pub fn canonical_raster_coverage_json(coverage: &RasterCoverageV0) -> String {
    serde_json::to_string(&raster_coverage_json_value(coverage))
        .unwrap_or_else(|_| "{}".into())
}
```
(Or thread a `Result` through `descriptor_raster_key` if a silent `"{}"` fallback is judged too surprising — either is strictly better than a module-wide trap.)

**Confidence:** certain the `.expect()` exists and is reachable on the mainline path (traced both call sites via grep and read both callers); certain the only failure mode is allocator exhaustion (read `raster_coverage_json_value` in full — no floats, no cycles).

---

## B5 — `bitmap-baker::glb::build_bitmap_glb` asserts an invariant its own signature doesn't enforce

**Severity:** medium
**File:** `bitmap-baker/src/glb.rs:108-117`

**What:**
```rust
pub(crate) fn build_bitmap_glb(
    ...
    coverage_descriptor: Option<&RasterCoverageV0>,
    coverage: Option<&[u8]>,
) -> Result<BuiltRasterGlb, BitmapBakeError> {
    ...
    if let Some(coverage_view) = coverage_view {
        let extension = extension.as_object_mut().expect("extension is an object");
        extension.insert(
            "coverage".into(),
            pmndrs_glyph_raster_artifact::raster_coverage_json_value(
                coverage_descriptor.expect("coverage descriptor accompanies bits"),
            ),
        );
```
`coverage_descriptor` and `coverage` (the bits) are two *independent* `Option` parameters. They happen to agree today only because the single caller keeps them in lockstep:
```rust
// bitmap-baker/src/lib.rs:59-64, 93-101
let coverage = rasterize::resolve_coverage(source, ..., request.descriptor.coverage.as_ref())?;
...
let built = glb::build_bitmap_glb(
    ...,
    request.descriptor.coverage.as_ref(),          // coverage_descriptor
    coverage.as_ref().map(|selection| selection.bits()),  // coverage bits
)?;
```
`resolve_coverage` returns `Ok(None)` exactly when its `coverage` argument is `None` (`rasterize.rs:27-29`), so both parameters are `Some`/`None` together *only because the caller derived them from the same `Option` and never diverges*. Nothing in `build_bitmap_glb`'s type signature requires this pairing.

**Why it matters:** this is the same "any panic traps the module" concern as B4, on the same coverage-bake mainline path, but here the trigger is a type-safety gap rather than an OOM edge case: a future refactor of `bake_bitmap` (e.g., reordering fields, or a new caller of `build_bitmap_glb` from a test or another baker) that passes these two `Option`s out of sync panics immediately, with no compiler warning.

**Before / After:**
```rust
// before: two independent Options
coverage_descriptor: Option<&RasterCoverageV0>,
coverage: Option<&[u8]>,

// after: one Option that makes the pairing structurally required
coverage: Option<(&RasterCoverageV0, &[u8])>,
```
The `.expect()` at line 113 then disappears entirely — the `if let Some((descriptor, bits)) = coverage` binds both or neither.

**Confidence:** certain the two parameters are independent in the signature (read the function directly); certain they agree today (traced the single call site through `resolve_coverage`'s `Ok(None)` short-circuit).

---

## B6 — `align4` is defined three times, each breaking the file's own checked-arithmetic discipline

**Severity:** low
**File:** `font-baker/src/glb.rs:98-100`, `font-baker/src/sfnt.rs:349-351`, `raster-artifact/src/ktx.rs:176-178`

**What:** all three are byte-identical:
```rust
fn align4(value: usize) -> usize {
    (value + 3) & !3
}
```
in files that otherwise wrap essentially every size computation in `checked_add`/`checked_mul`. `font-baker/src/sfnt.rs::rebuild_sfnt` has a second, smaller instance of the same pattern at line 242 (`count * 16 - search_range`, an unchecked multiply immediately next to a `checked_shl` two lines above it).

**Why it matters:** none of the current call sites can realistically overflow — `align4` is only ever called on a font-table length, a KTX2 DFD-block length, or an SFNT table count, all bounded far below `usize::MAX` by the actual size of an in-memory font or a compile-time-embedded DFD blob (`include_bytes!`). The `count * 16` at sfnt.rs:242 is bounded to at most 14 (the number of tags in `REQUIRED_TABLES` + `OPTIONAL_TABLES`). This is a maintainability/DRY finding, not a live bug: three copies of the same helper means a future correctness fix (or a future call site with a genuinely large input) has to be applied three times, and a reader has to re-verify the same "is this reachable" argument three times.

**Before / After:**
```rust
// consolidate into raster-artifact (already a shared dependency of font-baker's sibling and
// of ktx.rs itself) and use it everywhere, checked:
pub(crate) fn align4(value: usize) -> Option<usize> {
    value.checked_add(3).map(|v| v & !3)
}
```

**Confidence:** certain (all three definitions read directly; grep confirmed no other copies in scope). Confirming full unreachability of the theoretical overflow would require a `cargo fuzz`/property test asserting `align4` on the actual bounds of each call site, but the practical risk is speculative given the wasm32 memory ceiling.

---

## B7 — `font-baker::lib::bake_font` clones the whole shaping report where a destructuring move would do

**Severity:** low
**File:** `font-baker/src/lib.rs:44-62`

**What:**
```rust
let shaping = sfnt::build_shaping_payload(source, descriptor.font_face_index)?;
let shaping_report = shaping.report.clone();          // <-- clones Vec<TablePayloadReport> + Strings
let artifact = glb::build_font_glb(&shaping, ProvenanceV0 { .. })?;
let artifact_hash = hex_sha256(&artifact.bytes);
let artifact_id = format!("font-{}", shaping.shaping_hash);   // only remaining use of `shaping`
```
`build_font_glb(shaping: &ShapingPayload, ..)` (`font-baker/src/glb.rs:16-19`) only reads `shaping.sfnt`, `.extents`, `.extents_availability`, `.shaping_hash`, and `.metrics` — never `.report`. After it returns, the only remaining use of `shaping` in `bake_font` is `shaping.shaping_hash` at line 62. So `shaping.report` is cloned purely because `build_font_glb` needs `shaping` to still be a whole, unmoved struct at the time of the call — there is no later use of `.report` that requires the clone.

**Why it matters:** this is the same "clone that could be a move" pattern flagged as a known lead for `slug-baker/src/glb.rs` (see B9) but in a different crate/file, and it clones a nested structure (`Vec<TablePayloadReport>`, each with an owned `String` tag) rather than a flat byte buffer. Bake-time only, not a hot loop, so this is a minor allocation, not a performance regression risk.

**Before / After:**
```rust
// after: destructure once build_font_glb no longer needs the whole struct
let artifact = glb::build_font_glb(&shaping, ProvenanceV0 { .. })?;
let artifact_hash = hex_sha256(&artifact.bytes);
let ShapingPayload { shaping_hash, report: shaping_report, .. } = shaping;
let artifact_id = format!("font-{shaping_hash}");
```
(Requires `ShapingPayload`'s fields to be at least `pub(crate)`, which they already are per `font-baker/src/sfnt.rs:64-71`.)

**Confidence:** certain (traced every use of `shaping` in `bake_font` and every field access inside `build_font_glb`).

---

## B8 — Known lead confirmed: `slug-baker::glb::build_slug_glb`'s per-page clones can become moves

**Severity:** low
**File:** `slug-baker/src/glb.rs:81,89`

**What:**
```rust
pub(crate) fn build_slug_glb(
    ..., packed: &PackedSlug,
) -> Result<BuiltRasterGlb, SlugBakeError> {
    ...
    for (page_index, page) in packed.pages.iter().enumerate() {
        ...
        let header_source = append_resource(..., page.header_bytes.clone(), page_packaging)?;
        let reference_source = append_resource(..., page.reference_bytes.clone(), page_packaging)?;
```
`packed` is taken by shared reference, forcing `.clone()` on every page's header/reference byte buffers. Its one caller doesn't need `packed` afterward:
```rust
// slug-baker/src/artifact.rs:60-68
let packed = rasterize_font(source, request.font_face_index, request.glyph_count)?;
let metadata_bytes = packed.record_bytes.len();          // read before the call
let built = build_slug_glb(..., &packed)?;                // packed unused after this
```
`packed.metadata_bytes` is captured *before* the call, and nothing references `packed` afterward — confirmed by reading the rest of `bake_slug` in full.

**Why it matters:** exactly the "bake-time, not hot" allocation this task flagged as a known lead — real but low-urgency. `curve_bytes` is already used by reference only (`encode_ktx2(..., &page.curve_bytes)`), so only `header_bytes`/`reference_bytes` need to change.

**Before / After:**
```rust
// before
pub(crate) fn build_slug_glb(..., packed: &PackedSlug) -> Result<BuiltRasterGlb, SlugBakeError> {
    for (page_index, page) in packed.pages.iter().enumerate() {
        ...
        page.header_bytes.clone(), ...
        page.reference_bytes.clone(), ...

// after
pub(crate) fn build_slug_glb(..., packed: PackedSlug) -> Result<BuiltRasterGlb, SlugBakeError> {
    let record_bytes = &packed.record_bytes; // still borrowed once, read before the loop
    for (page_index, page) in packed.pages.into_iter().enumerate() {
        // page: SlugPage (owned) — curve_bytes still borrowed for encode_ktx2, then:
        page.header_bytes, ...      // moved, no clone
        page.reference_bytes, ...   // moved, no clone
```
(Caller changes `&packed` → `packed` at `slug-baker/src/artifact.rs:67`.)

**Confidence:** certain (the sole call site was read in full and confirmed `packed` is dead after the call).

---

## B9 — Known lead, resolved with two different verdicts: `to_string()`/formatting in `font-baker/src/sfnt.rs`

**Severity:** low
**File:** `font-baker/src/sfnt.rs:102` (cheap, confirmed), `font-baker/src/sfnt.rs:272` (worth removing, confirmed), `font-baker/src/source_font.rs:144` (real but not formatting-machinery)

**What:**
- **`sfnt.rs:102`** — `return Err(missing(&tag.to_string()));` inside the `REQUIRED_TABLES` presence-check loop. This only runs when about to return an `Err` via `?` — genuinely error-only, runs at most once, and `Tag: Display` is already linked in via other `format!("...{tag}...")` call sites in the same file (line 211). **Verdict: cheap, as hypothesized. No action needed.**
- **`sfnt.rs:272`** — inside `rebuild_sfnt`'s per-table loop (runs on every successful bake, up to 14 times):
  ```rust
  reports.push(TablePayloadReport { tag: tag.to_string(), raw_bytes: table.len(), padded_bytes: padded });
  ```
  This *is* on the normal/success path, and `TablePayloadReport.tag: String` is serialized to the caller (`ShapingPayloadReportV0` flows into `BakeReportV0`, which `font-baker/src/wasm.rs:161` serializes into the JSON metadata returned to JS on every bake). But `tag` can only ever be one of the 14 values in `REQUIRED_TABLES`/`OPTIONAL_TABLES` (both compile-time `const` arrays) — a `&'static str` lookup would carry the same information with no per-bake allocation. **Verdict: worth removing, as hypothesized.**
- **`source_font.rs:144`** — inside `inspect_font`'s per-charmap-entry loop:
  ```rust
  let name = names.get(glyph_id).filter(|v| !v.is_synthesized()).map(|value| value.as_str().to_string());
  ```
  This runs once per mapped glyph in the font's *entire* charmap (thousands for CJK). But `value.as_str()` is a `&str`, and `str::to_string()` goes through the specialized `impl ToString for str` (`String::from`), **not** the generic `Display`-based blanket impl — so it does not pull in `core::fmt` formatting machinery the way `Tag::to_string()` does. `inspect_font` *is* shipped (see B1: the `subsetting` feature is enabled in the production wasm build) and *is* on a normal (non-error) path. **Verdict: real per-glyph allocation, but it's the function's actual output data (`GlyphInspectionV0.name`), not formatting bloat — not removable without changing what the API returns.**

**Before / After (sfnt.rs:272 only):**
```rust
// before
reports.push(TablePayloadReport { tag: tag.to_string(), raw_bytes: table.len(), padded_bytes: padded });

// after
fn tag_name(tag: Tag) -> &'static str {
    match tag.to_be_bytes() {
        *b"head" => "head", *b"maxp" => "maxp", *b"cmap" => "cmap", *b"hhea" => "hhea",
        *b"hmtx" => "hmtx", *b"OS/2" => "OS/2", *b"BASE" => "BASE", *b"GDEF" => "GDEF",
        *b"GSUB" => "GSUB", *b"GPOS" => "GPOS", *b"VORG" => "VORG", *b"kern" => "kern",
        *b"vhea" => "vhea", *b"vmtx" => "vmtx", _ => "????",
    }
}
// TablePayloadReport.tag becomes `&'static str` (or Cow<'static, str> if Serialize needs an owned type)
```

**Confidence:** certain for all three verdicts (traced reachability, feature flags, and the exact `ToString` impl selected for each receiver type).

---

## B10 — `SlugBakeError`/`BitmapBakeError` are 100% duplicated, including `From` conversion logic; `BakeError` is legitimately different

**Severity:** low
**File:** `slug-baker/src/error.rs` vs `bitmap-baker/src/error.rs` (full files); compare `font-baker/src/error.rs`

**What:** `slug-baker/src/error.rs` and `bitmap-baker/src/error.rs` are line-for-line identical except for the type name and two message strings ("Slug"/"bitmap"): same 9 error-code variants in the same order, same `{code, message, path}` shape, same `new()`/`.at()` methods, and — notably — the same `impl From<RasterArtifactError>` with identical match arms:
```rust
match error {
    RasterArtifactError::Allocation | RasterArtifactError::ArithmeticOverflow => overflow(),
    RasterArtifactError::InvalidTexture | RasterArtifactError::Serialization => {
        Self::new(<Code>::SerializationFailed, error)
    }
}
```
This is duplicated *logic*, not just a duplicated shape — a future new `RasterArtifactError` variant needs this match updated in both files, and nothing forces that. (`bitmap-baker/src/progress.rs` and `slug-baker/src/progress.rs` are a second, smaller instance of the same full-file duplication.)

`font-baker/src/error.rs`'s `BakeError` is a different, smaller shape by necessity — no `.at()`, no `From<RasterArtifactError>` — because font-baker produces no raster output and has nothing to convert from. It should not be folded into the same abstraction.

**Why it matters (honest both ways):** unifying `SlugBakeError`/`BitmapBakeError` would not shrink either shipped `.wasm` binary — each is compiled as an independent `cdylib`, so a shared crate still gets fully monomorphized into both artifacts. The only benefit is source-level maintainability, specifically for the `From<RasterArtifactError>` mapping. Given `slug-baker` and `bitmap-baker` already both depend on `pmndrs_glyph_raster_artifact`, hosting a shared `BakeError<Code>`-style type there would introduce no *new* coupling beyond what already exists — but it's a judgment call whether that's worth touching two already-small, already-tested files for. A smaller, purely mechanical improvement: `SlugBakeError::new`/`BitmapBakeError::new` take `impl ToString` (line 30 of both files) and unconditionally re-format via `Display`, whereas `font-baker::BakeError::new` takes `impl Into<String>` — a strictly cheaper bound for the common case of passing an already-owned `String`.

**Confidence:** certain (both files read in full, diffed by hand).

---

# Verified non-issues

These were flagged by the AST facts scan or named as "known leads" to confirm/dismiss; each was traced to a definite verdict rather than left as a hunch.

- **`slug-core/src/packer.rs` overlap/page-full/oversized-glyph handling — all correct.** `ABSENT_PAGE` (`0xffff`) can never collide with a real page index: `groups.len() >= usize::from(ABSENT_PAGE)` is rejected (line 201), so real 0-based page indices max out at `0xFFFE`. A single glyph whose `estimate_curve_texels` exceeds `page_capacity` returns `Err(GlyphTooLarge)` before ever entering a group (line 176-178). Page-full triggers a clean group flush, never a panic. No two glyphs can overlap in the curve/header/reference buffers: `estimate_curve_texels = curves.len()*2 + contour_starts.len()` is a *provable* upper bound on the texels `write_curves` actually consumes (at most one row-boundary skip texel per curve, plus exactly one endpoint texel per contour), so the greedy grouping in `pack_glyphs` guarantees every page's real usage fits the buffer sized from that estimate, and each glyph's writes advance a single shared monotonic cursor with no rewind.
- **`raster-artifact/src/atlas.rs`'s shelf-packing atlas — correct**, including several *unchecked* `usize` multiplications in `place()`/`finish()` (e.g. `(top+row) * limit + left) * bytes_per_texel`) that are provably bounded by the same `checked_mul` chain `AtlasPage::new` already used to size the backing buffer — traced by hand, not a defect.
- **All 8 AST-flagged `unsafe_blocks` with `safety_doc=False` have proper `// SAFETY:` comments.** Checked every one: `slug-baker/src/progress.rs:18`, `bitmap-baker/src/progress.rs:18`, `slug-baker/src/wasm.rs:42/48/54` (alloc/dealloc/realloc wrappers) and `:524-538` (`with_state`), `font-baker/src/wasm.rs:370-389` (`with_state`), `bitmap-baker/src/wasm.rs:304-321` (`with_state`, grep-confirmed). The AST tool's `safety_doc` detector has a consistent blind spot for this codebase's "`// SAFETY:` comment on the line immediately above `unsafe {`" style — treat that specific flag as unreliable for this repo rather than re-auditing it again.
- **Narrowing casts the AST facts flagged all turned out to be pre-validated, not truncating:** `slug-baker/src/artifact.rs:265` (`quantize_plane_bounds`), `font-baker/src/sfnt.rs:322-325` (`encode_bounds`), and `bitmap-baker/src/rasterize.rs:238` (`encode_pixel_plane_bounds`) all range-check against `i16::MIN..=i16::MAX` *before* the `as i16` cast — the same idiom, independently reimplemented three times, always correctly. `bitmap-baker/src/rasterize.rs:180-181` uses checked `u16::try_from` (not `as`) for placement width/height.
- **Bitmap strike sizes (`ppem`) cannot truncate.** `BitmapDescriptorV0.strikes: Vec<u16>` is `u16` from JSON deserialization onward (serde rejects out-of-range values rather than truncating them), and `BitmapDescriptorV0::validate()` (`bitmap-baker/src/model.rs:49-59`) further bounds every strike to `1..=1022` (`MAX_BITMAP_PPEM`) before any rasterization runs. No narrowing cast exists anywhere on this path.
- **`slug-fontations/src/lib.rs`'s `Collector` (the `OutlinePen` impl that turns raw, font-controlled outline commands into Slug curves) is panic-free for any call sequence**, including pathological ones (e.g. `close()` before any `move_to()`, or a `move_to()` immediately following another with no `close()`), via a sticky `failure: Option<FontOutlineError>` flag checked in every mutating path (`reserve_curve`) and read once at the end in `finish()`.
- **Newtypes for page/glyph/texel indices are deliberately absent, and that reads as intentional here**, not an oversight: every "index" in scope (`page: u16`, `glyph_id: u16`, `curve_index: usize`, ...) is a raw primitive that also appears verbatim in a `#[repr(C)]` ABI record or an `extern "C"` wasm export. The project's own "data-oriented, integer indices, no `Rc`/`RefCell`/`Cow`" law (law #1) explicitly trades this type-safety for a flat, FFI-friendly representation; introducing newtypes would mean unwrapping them at every ABI boundary for no memory-safety benefit (index confusion here is a logic bug, not a soundness one). Not recommending a change.
