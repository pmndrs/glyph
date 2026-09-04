---
type: Reference
title: Rust codex — Maintainability, lints and module architecture
description: Checkable rules on maintainability, lints and module architecture, researched against primary sources, each with rationale, applicability to this repository, and a citation.
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Rust Maintainability, DRY, Module Architecture, and Lint Policy — Rules (2026)

Project facts assumed throughout: `pmndrs/glyph`, 12 first-party crates, ~63k LOC, Rust 1.97.1,
edition 2024, no_std + alloc, target wasm32-unknown-unknown. `shaper` is 47k LOC / 52 files;
its ten largest modules run 1849–5926 lines. There is currently no `[lints]` table anywhere
in the workspace and no `clippy.toml`.

## Expressing lint policy in Cargo.toml (edition 2024)

### R1. Put lint policy in Cargo.toml `[lints]` tables, not crate-level `#![deny(...)]` attributes
**Why:** A `[lints.rust]`/`[lints.clippy]` table is data cargo reads before invoking `rustc`/`clippy-driver`, so it applies uniformly to every target (lib, bins, tests, examples, benches) without editing source, is visible in one place without opening `lib.rs`, and — critically for a 12-crate workspace — can be centralized once and inherited (R2) instead of copy-pasted into every crate root's attribute list. A crate-level `#![deny(...)]` is source code: overriding it per-crate means editing that crate's `lib.rs`, and it cannot express Cargo-only concepts like the `priority` field (R4) or the `cargo` lint group at all.
**Applies to us:** Zero `[lints]` tables exist today, so every one of this document's recommendations starts from nothing — there is no legacy `#![deny]` pile to migrate off of, only a blank Cargo.toml to fill in correctly the first time.
**Bad / Good:**
```rust
// Bad: in packages/glyph/rust/shaper/src/lib.rs
#![deny(unsafe_op_in_unsafe_fn)]
#![warn(clippy::pedantic)]
```
```toml
# Good: in the workspace root Cargo.toml
[workspace.lints.rust]
unsafe_op_in_unsafe_fn = "deny"

[workspace.lints.clippy]
pedantic = { level = "warn", priority = -1 }
```
**Source:** [The Manifest Format — the `[lints]` section, Cargo Book](https://doc.rust-lang.org/cargo/reference/manifest.html#the-lints-section) (fetched 2026-09-03; MSRV 1.74, stabilized Rust 1.74.0, 2023-11-16).

### R2. Centralize in `[workspace.lints.*]`; every member crate opts in with `[lints] workspace = true`
**Why:** `workspace.lints` is not implicitly inherited — each package must explicitly add `[lints] workspace = true` to pull it in. This is deliberate: Cargo added a real check that flags a crate whose `[lints]` table is either missing or non-inheriting when the workspace root defines lints, precisely because teams kept assuming inheritance was automatic.
**Applies to us:** With 12 crates, forgetting the two-line opt-in in even one of them silently drops that crate out of the workspace's lint policy — a reviewer must be able to `grep -L 'workspace = true' packages/*/rust/*/Cargo.toml` and get an empty result.
**Bad / Good:**
```toml
# Bad: workspace root defines lints, but this member crate never opts in — it builds with none of them
# packages/glyph/rust/font-baker/Cargo.toml
[package]
name = "font-baker"
```
```toml
# Good
[package]
name = "font-baker"

[lints]
workspace = true
```
**Source:** [Workspaces — the `[workspace.lints]` table, Cargo Book](https://doc.rust-lang.org/cargo/reference/workspaces.html#the-lints-table) (fetched 2026-09-03).

### R3. Never mix `workspace = true` with other keys in the same `[lints]` table
**Why:** Cargo's manifest schema treats `workspace = true` as claiming the entire `[lints]` table for inheritance; per-package overrides on top of an inherited table are a documented open request, not shipped behavior, so a package that needs one extra crate-specific lint must currently choose between full inheritance and hand-duplicating the whole policy locally.
**Applies to us:** If `shaper` ever needs a crate-specific lint the other 11 crates don't (plausible, given it is 4x the size of the next-largest crate), that has to be handled as either a workspace-wide addition set to `allow` everywhere except `shaper`, or by `shaper` dropping workspace inheritance entirely for that table — not by appending a `[lints.clippy]` key next to `workspace = true`.
**Source:** [Packages overriding inherited lints in Cargo.toml + adding lints, rust-lang/cargo#13157](https://github.com/rust-lang/cargo/issues/13157) (open issue, checked 2026-09-03); [Workspaces — Cargo Book](https://doc.rust-lang.org/cargo/reference/workspaces.html#the-lints-table).

### R4. Use the `priority` field to let one specific lint override a group it belongs to
**Why:** Every entry in a `[lints]` table has an implicit `priority = 0` unless written as the long form `{ level = "...", priority = N }`. Cargo orders lints by priority before handing them to rustc/clippy, and a higher-priority entry wins — so a bare `module_name_repetitions = "allow"` (priority 0) silently overrides `pedantic = "warn"` (priority 0, same value, but groups need `priority = -1` to lose ties against any individually-named lint) only if the group is explicitly given a lower number. Omitting `priority = -1` on the group entry makes the ordering between "the group" and "a named member of the group" unspecified from the table alone.
**Applies to us:** Every group enabled in the proposed table below (`pedantic`, `nursery`, `cargo`) must carry `priority = -1` for the per-lint `allow` overrides underneath it to be guaranteed to win.
**Bad / Good:**
```toml
# Bad: ambiguous — does the individual allow win over the group warn?
[lints.clippy]
pedantic = "warn"
module_name_repetitions = "allow"
```
```toml
# Good: group is explicitly lower priority, so the named lint always wins
[lints.clippy]
pedantic = { level = "warn", priority = -1 }
module_name_repetitions = "allow"
```
**Source:** [The Manifest Format — the `[lints]` section, Cargo Book](https://doc.rust-lang.org/cargo/reference/manifest.html#the-lints-section) (fetched 2026-09-03).

### R5. Adopt new lint groups at `warn`; ratchet to `deny` per-crate only after the backlog is cleared
**Why:** Turning `pedantic`, `restriction` picks, or `missing_docs` straight to `deny` on a 63k-LOC workspace with no prior lint config fails every build until every existing violation is fixed or individually `#[expect]`-ed — a one-shot cliff, not a rollout. Practitioners who enabled the whole `pedantic` group at `deny` in one step report needing to immediately carve out half a dozen blanket exceptions just to get back to green, which produces coarse per-lint `allow`s instead of the deliberate per-call-site ones R14/R30 argue for.
**Applies to us:** Land the table in the "Proposed workspace lint table" section below at the levels shown (mostly `warn`, `deny` only for lints with near-zero expected false positives like `wildcard_dependencies`); promote `missing_docs`, `unwrap_used`, and the safety-comment lints to `deny` crate-by-crate as each of the 12 crates' backlog is cleared, not workspace-wide on day one.
**Source:** [clippy::pedantic and Workspace Lints, coreyja.com](https://coreyja.com/notes/clippy-pedantic-workspace) (fetched 2026-09-03 — author enabled `pedantic = "deny"` and had to immediately `allow` seven lints); [Your Clippy Config Should Be Stricter-er, billylevin.dev](https://billylevin.dev/posts/clippy-config/) (fetched 2026-09-03 — "you can expect to sprinkle multiple `#[allow(..)]`s in your code" when enabling `pedantic`/`restriction` on existing code).

## rustc lints worth turning on

### R6. Deny `unreachable_pub`; use `pub(crate)`/`pub(super)` for everything not re-exported
**Why:** `unreachable_pub` fires on any `pub` item that is not actually reachable from outside the crate — not directly, not via `pub use`, not leaked through a public return type. It is allow-by-default in rustc precisely because most crates have some of these by accident.
**Applies to us:** `shaper` alone has 52 files; without this lint, "is this `pub` because an application needs it, or because someone typed `pub` out of habit while splitting a module" is unanswerable by reading the file in front of you.
**Bad / Good:**
```rust
// Bad: pub but only ever used inside this crate
mod cluster_state {
    pub struct RunCursor { .. }
}
```
```rust
// Good: intent matches reach
mod cluster_state {
    pub(crate) struct RunCursor { .. }
}
```
**Source:** [Allowed-by-default lints — `unreachable_pub`, rustc book](https://doc.rust-lang.org/rustc/lints/listing/allowed-by-default.html) (fetched 2026-09-03).

### R7. Deny `elided_lifetimes_in_paths` and the rest of `rust_2018_idioms`
**Why:** `rust_2018_idioms` bundles five lints: `bare_trait_objects`, `elided_lifetimes_in_paths`, `ellipsis_inclusive_range_patterns`, `explicit_outlives_requirements`, `unused_extern_crates`. `elided_lifetimes_in_paths` specifically forces every generic type that carries a lifetime to spell it (even as `'_`) at every use site, which is the difference between `fn foo(x: &Foo)` (hides that `Foo` borrows something) and `fn foo(x: &Foo<'_>)` (visible in the signature).
**Applies to us:** `abi_contract.rs` (2729 lines) and `semantic_wire.rs` (2266 lines) are exactly the kind of wire-format/contract code where a reader needs to see borrowing relationships in the signature, not infer them from the body.
**Bad / Good:**
```rust
struct ShapedRun<'a> { text: &'a str }
fn first_run(x: &ShapedRun) -> &str { x.text }        // Bad: hidden lifetime parameter
fn first_run(x: &ShapedRun<'_>) -> &str { x.text }     // Good: explicit, searchable
```
**Source:** [Lint groups — `rust-2018-idioms`, rustc book](https://doc.rust-lang.org/rustc/lints/groups.html) (fetched 2026-09-03).

### R8. Promote `unsafe_op_in_unsafe_fn` from edition-2024's default warn to deny
**Why:** Starting with edition 2024, this lint warns by default — an `unsafe fn` no longer implicitly treats its whole body as one unsafe block; each unsafe operation inside needs its own explicit `unsafe { }`. Warn-by-default means CI can still go green with the warning present; only `deny` (or promoting warnings to errors in CI, which wasmtime does — see R30) actually blocks it.
**Applies to us:** A no_std, wasm-target, unsafe-heavy workspace is exactly the profile where "this unsafe fn's body has three unsafe operations and I can no longer tell which one the safety comment above the function was justifying" is a real, not hypothetical, failure mode.
**Bad / Good:**
```toml
[workspace.lints.rust]
unsafe_op_in_unsafe_fn = "deny"   # edition 2024 default is "warn"; this workspace wants it fatal
```
**Source:** [`unsafe_op_in_unsafe_fn` is now warn-by-default, Rust 2024 Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html) (fetched 2026-09-03).

### R9. Turn on `missing_docs`, but expect it to surface a real backlog
**Why:** `missing_docs` is allow-by-default in rustc; it has to be opted into per-crate or per-workspace, and it fires on every public item lacking a doc comment — function, struct, enum, module, trait, const.
**Applies to us:** 12 crates with no lint config today means this has never run once. Turn it on at `warn` workspace-wide first (R5) and treat the initial run as a scoping exercise, not a merge blocker.
**Source:** [Allowed-by-default lints — `missing_docs`, rustc book](https://doc.rust-lang.org/rustc/lints/listing/allowed-by-default.html) (fetched 2026-09-03).

### R10. Decide `missing_debug_implementations` per crate — don't blanket-deny it
**Why:** rustc's own docs note this lint is allow-by-default because deriving `Debug` everywhere has a real compile-time and code-size cost — every derived `Debug` impl pulls in `core::fmt` formatting machinery. That is not a hypothetical cost for a crate that measures its output in bytes shipped over the wire.
**Applies to us:** The project's own wasm-size investigation established that the engine is 46% of the shipped artifact. Blanket-denying `missing_debug_implementations` fights that budget directly; enable it at `warn` and derive `Debug` deliberately on public API types (where it's a debugging/error-message asset), not on every internal buffer/cursor struct in `codec.rs` or `codec_gather.rs`.
**Source:** [Allowed-by-default lints — `missing_debug_implementations`, rustc book](https://doc.rust-lang.org/rustc/lints/listing/allowed-by-default.html) (fetched 2026-09-03).

## Clippy lint groups: what to enable, and how

### R11. Enable `pedantic`, `nursery`, and `cargo` at `warn` with `priority = -1`; never at `deny` workspace-wide
**Why:** All three groups are allow-by-default and contain lints clippy itself documents as having "intentional false positives" (pedantic) or being actively unstable (nursery). `warn` with a low group priority (R4) makes every one of them individually overridable without fighting the group setting.
**Applies to us:** This is the standard shape real projects ship. Bevy's workspace root sets `missing_docs = "warn"`, `unsafe_code = "deny"`, and a long list of individual `clippy::*` lints, each with its own level. Wasmtime's contributor guide states plainly that clippy's *default* lint set is too noisy to use productively, so they hand-pick opt-ins through `[workspace.lints.clippy]` rather than taking a whole group at face value.
**Bad / Good:**
```toml
[workspace.lints.clippy]
pedantic = "deny"   # Bad: fails the build on every intentional-false-positive pedantic lint at once
```
```toml
[workspace.lints.clippy]
pedantic = { level = "warn", priority = -1 }   # Good: visible, not fatal, individually overridable
```
**Source:** [`bevyengine/bevy` Cargo.toml, `[workspace.lints]`](https://github.com/bevyengine/bevy/blob/main/Cargo.toml) (fetched 2026-09-03); [Wasmtime Coding Guidelines — Lints](https://docs.wasmtime.dev/contributing-coding-guidelines.html) (fetched 2026-09-03: "the default set of Clippy lints is too noisy to productively use other Clippy lints").

### R12. Never write `restriction = "warn"` — clippy has a built-in lint against doing exactly that
**Why:** `clippy::blanket_clippy_restriction_lints` is itself a **suspicious**-group lint (on by default, since clippy 1.47.0) that fires when a `warn`/`deny`/`forbid` targets the whole `clippy::restriction` category. Clippy's own documentation gives the reason: restriction lints are deliberately in tension with each other and with idiomatic Rust, and are meant to be enabled "on a lint-by-lint basis and with careful consideration" — not as a group.
**Applies to us:** Every restriction lint recommended in this document (R17–R24) is named individually for exactly this reason.
**Bad / Good:**
```toml
# Bad: clippy will itself warn that this is wrong (blanket_clippy_restriction_lints)
[workspace.lints.clippy]
restriction = { level = "warn", priority = -1 }
```
```toml
# Good: cherry-picked
[workspace.lints.clippy]
undocumented_unsafe_blocks = "deny"
unwrap_in_result = "deny"
```
**Source:** `clippy_lints/src/attrs/mod.rs`, `rust-lang/rust-clippy` master branch (fetched 2026-09-03) — `BLANKET_CLIPPY_RESTRICTION_LINTS`, group `suspicious`, `#[clippy::version = "1.47.0"]`.

### R13. Track `nursery` separately from `pedantic`/`cargo` — expect churn between toolchain bumps
**Why:** Nursery lints are explicitly unfinished. `missing_const_for_fn`'s own doc comment warns it "only runs one pass over the code" — making function `a` const and re-running clippy is sometimes required before it will suggest making the caller `b` const too — and that the suggestion "may be incorrect if you are using this lint on stable." Nursery lints are also the ones most likely to be promoted, reworked, or removed outright on a rustc/clippy version bump.
**Applies to us:** The project pins Rust 1.97.1 today; when that pin moves, re-review the nursery diff specifically, not just re-run CI and assume green means unchanged.
**Source:** `clippy_lints/src/missing_const_for_fn.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03), group `nursery`, `#[clippy::version = "1.34.0"]`.

## Pedantic lints worth keeping on

### R14. Turn on the `cast_*` family for numeric layout code
**Why:** `cast_possible_truncation`, `cast_sign_loss`, `cast_possible_wrap`, and `cast_precision_loss` each catch a specific `as` conversion that silently changes a value (a `u32` font-unit value truncated into a `u16` glyph index, a negative `i32` advance cast to `u32`, etc.) — bugs that are otherwise invisible until a specific input triggers them, and that a fuzzer finds far later than a lint would.
**Applies to us:** `positioning.rs` (3121 lines) and `stable_plan.rs` (2588 lines) are dense with exactly this kind of fixed-point/font-unit numeric conversion.
**Bad / Good:**
```rust
let advance_units: i32 = -12;
let advance: u32 = advance_units as u32;   // Bad: silently wraps to a huge positive value
```
```rust
let advance: u32 = advance_units.try_into().map_err(|_| LayoutError::NegativeAdvance)?;  // Good
```
**Source:** [Clippy Lints — pedantic group listing](https://rust-lang.github.io/rust-clippy/master/index.html) (fetched 2026-09-03).

### R15. Turn on `missing_errors_doc`/`missing_panics_doc`; use `#[expect(..., reason = "...")]` for the deliberate exceptions
**Why:** These pedantic lints require a `# Errors` section on any public function returning `Result` and a `# Panics` section on any public function that can panic. Clippy's own documentation shows the intended escape hatch is not a blanket `#[allow]` at the crate or module level but a per-call-site `#[expect]`, so future panics added to the same function are still caught.
**Applies to us:** This is the documentation half of the "a call answers or throws where it was written" contract the `engine-call-contract` skill already enforces structurally — these two lints make it impossible to add a new panic or a new error path to a public engine entry point without either documenting it or explicitly, visibly, opting out.
**Bad / Good:**
```rust
// Clippy's own documented pattern for a deliberate, narrow exception:
pub fn will_not_panic(x: usize) {
    #[expect(clippy::missing_panics_doc, reason = "infallible")]
    let y = NonZeroUsize::new(1).unwrap();
    // If any panics are added in the future the lint will still catch them
}
```
**Source:** `clippy_lints/src/doc/mod.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `MISSING_ERRORS_DOC` (pedantic, 1.41.0), `MISSING_PANICS_DOC` (pedantic, 1.51.0, doc comment includes the `#[expect]` example above verbatim).

### R16. Turn on `too_many_lines` — it flags the function, not the file
**Why:** This is the critical nuance for this codebase: `too_many_lines` counts lines inside one function body. A 5926-line file made of forty well-factored 100-line functions never trips it; a single 400-line function inside a 300-line file does. File size and this lint measure different, complementary things — file size is an organization question (R33–R36), this lint is a "does any one function still fit in a head" question.
**Applies to us:** `state.rs` is 5926 lines. That fact alone says nothing about whether the module is a maintainability problem — running `cargo clippy` with this lint on says whether any *function inside it* is. Configure the threshold explicitly in `clippy.toml` (default 100) rather than accepting the default silently, since a hot-path state machine may have legitimately long single functions that a lower threshold would flag every time.
**Bad / Good:**
```toml
# clippy.toml (repo root) — not Cargo.toml; thresholds are configured here, levels in [lints]
too-many-lines-threshold = 150
```
**Source:** `clippy_lints/src/functions/mod.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `TOO_MANY_LINES`, group `pedantic`, `#[clippy::version = "1.34.0"]`.

### R17. Turn on `large_stack_arrays`
**Why:** This pedantic lint flags local arrays large enough to risk stack overflow. wasm32 targets ship with a small, fixed-size default stack and no guard-page-based overflow detection the way a native OS target has — a stack overflow in a wasm module is a trap, not a segfault with a backtrace.
**Applies to us:** Any glyph outline or shaping buffer sized with a compile-time constant (as opposed to `Vec`) is a candidate; this lint catches the case before it becomes a hard-to-reproduce wasm trap report.
**Source:** `clippy_lints/src/large_stack_arrays.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — group `pedantic`, `#[clippy::version = "1.41.0"]`.

## Restriction lints worth cherry-picking for an unsafe-heavy no_std crate

### R18. Turn on `undocumented_unsafe_blocks` and `multiple_unsafe_ops_per_block` together
**Why:** `undocumented_unsafe_blocks` requires a `// SAFETY:` comment on the line(s) immediately preceding every `unsafe` block or impl. `multiple_unsafe_ops_per_block` requires that an unsafe block contain exactly one unsafe operation. Used together, they force a 1:1 mapping between "one unsafe operation" and "one safety justification" — without the second lint, a block with three unsafe operations and one vague safety comment satisfies the first lint while still hiding which specific operation the comment was justifying.
**Applies to us:** This is the textbook combination for an unsafe-heavy no_std engine; it is also literally how wasmtime's own contributor guide states its unsafe policy: "an unsafe block within a function should be accompanied with a preceding comment explaining why it's safe to have this block."
**Bad / Good:**
```rust
// Bad: one comment, two unsafe operations — which one is it justifying?
unsafe {
    let len = buf.len_unchecked();
    core::ptr::write(dst, *src.add(len));
}
```
```rust
// Good
// SAFETY: `buf` was constructed with a known length by `Buffer::from_parts`.
let len = unsafe { buf.len_unchecked() };
// SAFETY: `dst` is valid for one write of T by the caller's contract (see `# Safety` above);
// `src.add(len)` stays in-bounds because `len < src_capacity`, checked above.
unsafe { core::ptr::write(dst, *src.add(len)) };
```
**Source:** `clippy_lints/src/undocumented_unsafe_blocks.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `UNDOCUMENTED_UNSAFE_BLOCKS` (restriction, 1.58.0), `MULTIPLE_UNSAFE_OPS_PER_BLOCK` (restriction, 1.69.0, in `clippy_lints/src/multiple_unsafe_ops_per_block.rs`); [Wasmtime Coding Guidelines — Unsafe Code](https://docs.wasmtime.dev/contributing-coding-guidelines.html) (fetched 2026-09-03).

### R19. Turn on `unnecessary_safety_comment` as the dual check
**Why:** Once `undocumented_unsafe_blocks` (R18) is enforced, `// SAFETY:` comments become mandatory in exactly one place — and start getting copy-pasted onto code that isn't actually unsafe, as a habit. `unnecessary_safety_comment` flags a `// SAFETY:` comment sitting on safe code, keeping the signal meaningful.
**Applies to us:** Prevents safety-comment inflation as the codebase adopts R18 — a `// SAFETY:` comment should mean something every time it appears, not become punctuation.
**Source:** `clippy_lints/src/undocumented_unsafe_blocks.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `UNNECESSARY_SAFETY_COMMENT`, group `restriction`, `#[clippy::version = "1.67.0"]`.

### R20. Don't bother enabling `missing_safety_doc` — it is already on by default
**Why:** Unlike the three lints above, `missing_safety_doc` (requiring a `# Safety` section on every public `unsafe fn`) lives in clippy's **style** group, which is on by default under plain `clippy::all`. Teams that explicitly add it to their `[lints.clippy]` table are re-declaring something already active — harmless, but it signals a misunderstanding of which unsafe-documentation lint needed opting into and which didn't.
**Applies to us:** If a review of `shaper`'s public unsafe functions turns up ones missing a `# Safety` section, that is a finding to fix, not a lint to newly enable — `cargo clippy` on this workspace has been catching it (or would, at `deny`-level in CI) all along, config or not.
**Source:** `clippy_lints/src/doc/mod.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `MISSING_SAFETY_DOC`, group `style`, `#[clippy::version = "1.39.0"]`.

### R21. Turn on `unwrap_used`/`expect_used` at `warn`, `unwrap_in_result` at `deny`
**Why:** `unwrap_used`/`expect_used` (both restriction, since 1.45.0) flag any `.unwrap()`/`.expect()` call on `Option`/`Result` — useful in library code where every panic is a decision the caller didn't get to make, especially with no unwinding on wasm (panic = abort, no stack unwind to catch). `unwrap_in_result` (restriction, since 1.48.0) is narrower and higher-signal: it flags `.unwrap()`/`.expect()` specifically *inside a function whose own return type is `Result`* — a strictly self-contradictory pattern, since the function already has a channel to propagate the failure and chose to panic instead.
**Applies to us:** `warn` for the first two (tests and one-off tools legitimately unwrap), `deny` for `unwrap_in_result` — a `shaper` function returning `Result<Plan, ShapeError>` that `.unwrap()`s partway through is a contract violation the type signature itself promised wouldn't happen, and is exactly the failure mode the `engine-call-contract` skill's "a call answers or throws where it was written" rule exists to prevent.
**Source:** `clippy_lints/src/methods/mod.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `UNWRAP_USED`/`EXPECT_USED`, group `restriction`, `#[clippy::version = "1.45.0"]`; `clippy_lints/src/unwrap_in_result.rs` — `UNWRAP_IN_RESULT`, group `restriction`, `#[clippy::version = "1.48.0"]`.

### R22. Turn on `indexing_slicing` for buffer-heavy modules
**Why:** `a[i]` panics on out-of-bounds; `a.get(i)` returns `Option`. This restriction lint forces the choice to be visible at every indexing site rather than defaulting to the panicking form. It is a `warn`, not a `deny`, specifically because a hot loop that has already proven `i < a.len()` a few lines above has a legitimate performance reason to skip the redundant bounds check via `a[i]` (or `get_unchecked` behind its own `// SAFETY:`, per R18) — the lint's job is to force that to be a decision, not a default.
**Applies to us:** `cluster_state.rs` (2067 lines), `codec.rs` (2525 lines), and `codec_gather.rs` (2332 lines) are the buffer/cursor-heavy modules where this distinction matters most.
**Source:** [Clippy Lints — restriction group listing](https://rust-lang.github.io/rust-clippy/master/index.html) (fetched 2026-09-03).

### R23. Turn on `std_instead_of_core`, `std_instead_of_alloc`, and `alloc_instead_of_core`
**Why:** All three (restriction, since clippy 1.64.0) exist for exactly one purpose per their own doc comments: "crates which have `no_std` compatibility... may wish to ensure types are imported from core [or alloc] to ensure disabling `std` [or `alloc`] does not cause the crate to fail to compile." They catch an accidental `use std::...` the moment it's typed, at the import line, instead of at the next `--target wasm32-unknown-unknown --no-default-features` build.
**Applies to us:** This is a direct, mechanical match for the project's stated `no_std + alloc` constraint across all 12 crates — enable all three at `deny`/`warn` workspace-wide; there is no legitimate `std` import inside `shaper`, `font-baker`, or any other crate that ships on the wasm target.
**Bad / Good:**
```rust
use std::vec::Vec;   // Bad: works today, breaks the moment `std` isn't available
```
```rust
extern crate alloc;
use alloc::vec::Vec;  // Good
```
**Source:** `clippy_lints/src/std_instead_of_core.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `ALLOC_INSTEAD_OF_CORE`/`STD_INSTEAD_OF_ALLOC`/`STD_INSTEAD_OF_CORE`, group `restriction`, `#[clippy::version = "1.64.0"]`.

### R24. Turn on `exhaustive_enums`/`exhaustive_structs` on the public API surface
**Why:** Both (restriction, since 1.51.0) flag any exported `enum`/`struct` not marked `#[non_exhaustive]`, on the reasoning that an exhaustive public type is a stability commitment — adding a variant or field to it is a breaking change the instant any downstream `match` or struct literal exists. Pairing this with `cargo-semver-checks` (R43) turns "did we just break semver" from a release-day surprise into a compile-time-visible decision made where the type is declared.
**Applies to us:** This maps directly onto the `engine-call-contract` skill's root-vs-`/core` distinction: "a type an application can encounter lives at the root." Root types are exactly the ones this lint should be enforced on; internal-only types constructed solely by integrators inside `/core` are a legitimate `#[allow]` (with a `reason`, per R30) if the crate deliberately wants them exhaustive for exhaustive-match ergonomics within the crate.
**Source:** `clippy_lints/src/exhaustive_items.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — group `restriction`, `#[clippy::version = "1.51.0"]`.

### R25. Turn on `allow_attributes` (warn) and `allow_attributes_without_reason` (deny)
**Why:** These are the two lints that make the rest of this document's `#[expect]`/`reason` guidance (R30–R32) actually enforced rather than aspirational. `allow_attributes` (restriction, since 1.70.0) flags a plain `#[allow(...)]` and suggests `#[expect(...)]` instead, wherever the two are interchangeable. `allow_attributes_without_reason` (restriction, since 1.61.0) requires a `reason = "..."` string on *both* `#[allow]` and `#[expect]` attributes.
**Applies to us:** `allow_attributes_without_reason` at `deny` workspace-wide is the mechanical guarantee that no future `#[allow(clippy::something)]` lands without someone writing down why — a one-line requirement that pays for itself the first time someone tries to remove a now-stale allow six months later and can immediately tell whether it's still needed.
**Source:** `clippy_lints/src/attrs/mod.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `ALLOW_ATTRIBUTES` (restriction, 1.70.0), `ALLOW_ATTRIBUTES_WITHOUT_REASON` (restriction, 1.61.0).

### R26. Skip `arithmetic_side_effects` — the targeted `cast_*` lints (R14) already catch the real bugs
**Why:** `arithmetic_side_effects` flags *every* `+`, `-`, `*`, `<<`, `/`, `%` on a type that could overflow or divide-by-zero — which, in a numeric text-shaping/layout engine, is nearly every line of arithmetic in the codebase. Clippy's own example (`fn foo(n: i32) -> i32 { n + 1 }`) shows it firing on code with no actual bug. The realistic failure modes in this kind of code — silent truncation, sign loss, precision loss on a numeric conversion — are exactly what R14's `cast_*` lints already target with a much better signal-to-noise ratio.
**Applies to us:** Enabling this lint across `positioning.rs`/`stable_plan.rs` would produce thousands of warnings on legitimate font-unit arithmetic, training reviewers to ignore clippy output wholesale rather than catching the handful of conversions that actually matter.
**Source:** [Clippy Lints — restriction group listing](https://rust-lang.github.io/rust-clippy/master/index.html) (fetched 2026-09-03) — `ARITHMETIC_SIDE_EFFECTS` example is `fn foo(n: i32) -> i32 { n + 1 }`, restriction, allow-by-default.

### R27. Skip `cognitive_complexity` and treat `min_ident_chars` as situational, not standing policy
**Why:** `cognitive_complexity` is, by clippy's own admission in its doc comment, an attempt to measure something the tool cannot actually measure: "the true Cognitive Complexity of a method is not something we can calculate using modern technology." Clippy's own docs recommend `excessive_nesting` or `too_many_lines` (R16) instead. `min_ident_chars` — which flags any identifier shorter than a configurable threshold — carries its own built-in caveat: "this lint can be very noisy when enabled; it may be desirable to only enable it temporarily."
**Applies to us:** A shaping/layout engine has a legitimate vocabulary of short, conventional names (`x`, `y`, `dx`, `i`, `n`) that this lint would flag indiscriminately; if it's ever useful, run it as a one-off audit, not a standing CI gate.
**Source:** `clippy_lints/src/functions/mod.rs` (fetched 2026-09-03) — `TOO_MANY_LINES` as the documented replacement; `clippy_lints/src/min_ident_chars.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `MIN_IDENT_CHARS`, group `restriction`, `#[clippy::version = "1.72.0"]`, doc comment contains the noise caveat verbatim.

## Nursery and cargo groups

### R28. Turn on `missing_const_for_fn` and `redundant_pub_crate`; expect to re-run after each fix
**Why:** `missing_const_for_fn` (nursery, since 1.34.0) suggests `const fn` where possible — valuable for a wasm target where const-evaluable code can move work to compile time and shrink the runtime binary, but the lint's own docs admit it only runs one pass, so making function `a` const often only then reveals that its caller `b` could also be const. `redundant_pub_crate` (nursery, since 1.44.0) is the inverse case R6 doesn't catch: a `pub(crate)` item sitting inside an already-private module, where the explicit `pub(crate)` is misleading because the module's own privacy already restricts it further.
**Applies to us:** Run `missing_const_for_fn` iteratively (fix, re-run, fix) rather than expecting one clippy pass to find every candidate; pair `redundant_pub_crate` with `unreachable_pub` (R6) for complete visibility-keyword hygiene in both directions.
**Source:** `clippy_lints/src/missing_const_for_fn.rs` (fetched 2026-09-03), group `nursery`, `#[clippy::version = "1.34.0"]`; `clippy_lints/src/redundant_pub_crate.rs` (fetched 2026-09-03), group `nursery`, `#[clippy::version = "1.44.0"]`.

### R29. Turn on the `cargo` group; use `clippy.toml`'s `allowed-duplicate-crates` as the `multiple_crate_versions` escape hatch
**Why:** The `cargo` group (allow-by-default) checks the manifest itself: `multiple_crate_versions` flags when the dependency graph pulls in two versions of the same crate (binary bloat, confusing type errors across the version boundary); `wildcard_dependencies` flags an unpinned `"*"` version requirement; `negative_feature_names` flags features like `no-abc`/`not-def` (features are supposed to be purely additive; a negative-named one usually signals an inverted default that will surprise someone composing features). `multiple_crate_versions`'s own doc comment notes the duplication is "not always possible to fix" when it comes from a dependency's own graph, and documents `allowed-duplicate-crates` as the configured exception list for exactly that case.
**Applies to us:** A 12-crate workspace with its own internal dependency graph plus external deps (harfrust-adjacent shaping crates, wasm tooling) is a natural place for version skew to creep in unnoticed; `wildcard_dependencies` at `deny` costs nothing since a deliberate `"*"` dependency should never exist in a shipped engine.
**Source:** `clippy_lints/src/cargo/mod.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `MULTIPLE_CRATE_VERSIONS` (cargo, pre-1.29.0, `allowed-duplicate-crates` config), `WILDCARD_DEPENDENCIES` (cargo, 1.32.0), `NEGATIVE_FEATURE_NAMES` (cargo, 1.57.0), `CARGO_COMMON_METADATA` (cargo, 1.32.0).

## `#[expect(...)]` versus `#[allow(...)]`

### R30. Prefer `#[expect(lint, reason = "...")]` to `#[allow(lint, reason = "...")]` for anything meant to be temporary
**Why:** `#[allow]` suppresses a lint silently and permanently — nothing tells you when the code changes such that the lint would no longer fire anyway, so allows accumulate and rot. `#[expect]` (stable since Rust 1.81.0, 2024-09-05) creates a *lint expectation*: if the named lint would not have fired at that location, the compiler emits `unfulfilled_lint_expectations` (warn-by-default) at the attribute itself, telling you the suppression is now dead weight and can be deleted. This is the direct mechanism for "an expectation that stops being needed becomes a warning."
**Applies to us:** Every one of the deliberate, per-call-site exceptions this document recommends (R15's `missing_panics_doc` example, R24's exhaustive-type opt-outs) should default to `#[expect]`; reserve `#[allow]` for the rare case where the exception is permanent and re-litigating it on every refactor would be noise, not signal.
**Bad / Good:**
```rust
#[allow(unused_mut)]              // Bad: silent forever, even after the `mut` becomes genuinely needed again
fn foo() -> usize {
    let mut a = Vec::new();
    a.len()
}
```
```rust
#[expect(unused_mut, reason = "refactor in progress, mut needed again once push() lands")]
fn foo() -> usize {
    let mut a = Vec::new();
    a.len()
}
```
**Source:** [Diagnostic attributes — `#[expect]`, The Rust Reference](https://doc.rust-lang.org/reference/attributes/diagnostics.html) (fetched 2026-09-03); [Rust 1.81.0 release notes](https://blog.rust-lang.org/2024/09/05/Rust-1.81.0.html) (2024-09-05); `clippy_lints/src/attrs/mod.rs`, `ALLOW_ATTRIBUTES` doc comment (fetched 2026-09-03) — "`#[allow]` will not trigger if a warning isn't found. `#[expect]` triggers if there are no warnings."

### R31. Expect the specific lint name, not its group — group expectations are fulfilled by any one member firing
**Why:** Per the Rust Reference's own worked example: `#[expect(unused_mut, unused_variables)]` on a binding creates *two separate* expectations, each independently checked. But `#[expect(unused)]` (a *group*) is fulfilled the moment *any single* lint inside the `unused` group fires anywhere in the attribute's scope — so a broad group-level expect can silently stop tracking the specific lint you actually cared about, as long as some other lint in the group still fires.
**Applies to us:** When suppressing something in `abi_contract.rs` or `semantic_wire.rs`, write `#[expect(clippy::missing_panics_doc, reason = "...")]`, not `#[expect(clippy::pedantic, reason = "...")]` — the group form would stay "fulfilled" (and thus silent) even after the specific `missing_panics_doc` case it was meant to track had already been fixed, as long as some unrelated pedantic lint elsewhere in scope still fired.
**Source:** [Diagnostic attributes — `#[expect]` and lint groups, The Rust Reference](https://doc.rust-lang.org/reference/attributes/diagnostics.html) (fetched 2026-09-03).

### R32. Require a `reason` string on every non-default lint-level attribute, not just `#[allow]`
**Why:** The Rust Reference specifies that `reason` is accepted on all four lint-level attributes (`allow`, `expect`, `warn`, `deny`) — including crate-wide `#![deny(lint, reason = "...")]` — and that the reason text is surfaced as part of the diagnostic message when the lint actually fires. Combined with `allow_attributes_without_reason` at `deny` (R25), this is enforced, not just documented.
**Applies to us:** A workspace-wide `#![deny(unsafe_op_in_unsafe_fn, reason = "no_std + wasm: unwinding across an unsafe boundary is not recoverable here")]` documents *why* at the point future maintainers will actually read it — in the compiler error itself — rather than in a comment or commit message they'd have to go find.
**Source:** [Diagnostic attributes — the `reason` field, The Rust Reference](https://doc.rust-lang.org/reference/attributes/diagnostics.html) (fetched 2026-09-03).

## Module organization at scale

### R33. Use `foo.rs` + `foo/`, never `foo/mod.rs` — enforce with exactly one of the two mutually exclusive style lints
**Why:** Since the 2018 edition, a module with children no longer requires `foo/mod.rs`; `foo.rs` alongside a `foo/` directory of children is equivalent and avoids a working tree with dozens of files literally named `mod.rs`. Clippy ships two lints for this and they contradict each other on purpose: `mod_module_files` (restriction, 1.57.0) *requires* the `mod.rs` style; `self_named_module_files` (restriction, 1.57.0) *bans* it in favor of `foo.rs`. Enable exactly one, never both (they will fight every file in the tree) and never neither (style drifts file by file otherwise).
**Applies to us:** With 52 files in `shaper` alone, an inconsistent mix of `foo/mod.rs` and `foo.rs` makes "does this module have children" unanswerable from the file name alone — pick `self_named_module_files` and enforce it.
**Bad / Good:**
```
src/
  cluster_state/
    mod.rs        <- Bad if `self_named_module_files` is the house style
    run_cursor.rs
```
```
src/
  cluster_state.rs   <- Good: same name as the directory it parents
  cluster_state/
    run_cursor.rs
```
**Source:** `clippy_lints/src/module_style.rs`, `rust-lang/rust-clippy` master (fetched 2026-09-03) — `MOD_MODULE_FILES` and `SELF_NAMED_MODULE_FILES`, both group `restriction`, `#[clippy::version = "1.57.0"]`; note also `INLINE_MODULES` (restriction, new in `#[clippy::version = "1.97.0"]`), which separately bans `mod foo { ... }` written inline in a parent file instead of split to its own file — worth enabling alongside for the same reason.

### R34. Judge a module by responsibility count and fan-out, not line count
**Why:** Line count alone doesn't predict maintainability; a 5000-line file of many small, independently-testable functions behaves differently from a 2000-line file dominated by one sprawling function or one struct with forty methods that all mutate the same field. The concrete, checkable proxies: (1) how many *distinct* public items the file exports — a facade re-exporting twenty types from child modules is fine at any length, a single `impl` block with twenty unrelated public methods is not; (2) whether `too_many_lines` (R16) fires on individual functions inside it — a big file failing that lint has a real problem, a big file passing it is organizationally large but locally fine; (3) git churn — a file every unrelated PR has to touch is a coupling problem line count won't show.
**Applies to us:** `state.rs` (5926 lines) is the test case: before deciding it needs splitting, check whether any single function inside it is actually long (R16), and whether the file holds one cohesive state machine (legitimate — see R35 for how large single-concern rustc/serde files get organized) or several unrelated concerns that happen to share a file.
**Source:** General module-system semantics from [Path and module system changes, Rust 2018 Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2018/path-changes.html) (fetched 2026-09-03); real-world large-crate structure cross-checked against [`serde-rs/serde`'s `serde/src` tree](https://github.com/serde-rs/serde/tree/master/serde/src) (fetched 2026-09-03: split into `de/`, `ser/`, and `private/` directories along the serialize/deserialize/internal-only axis, not by line count).

### R35. Split behind a facade: the parent file declares children and re-exports; implementation lives in the children
**Why:** A facade module (`foo.rs` containing only `mod a; mod b; pub use a::Thing;` — no logic of its own) gives external callers one stable import path (`crate::foo::Thing`) while the actual code moves freely between `foo/a.rs` and `foo/b.rs` without touching any call site outside the module. This is how large, well-run crates avoid the false choice between "one giant file" and "leaking internal file structure into the public API."
**Applies to us:** If `state.rs` is judged (via R34) to actually hold multiple concerns, the target shape is `state.rs` becoming a thin facade over `state/` with each concern in its own child file, re-exported from the top — not a mechanical line-count-based chop into `state_part1.rs`/`state_part2.rs`.
**Bad / Good:**
```rust
// Bad: mechanical split with no facade — callers now need to know internal file structure
use crate::state_part1::RunState;
use crate::state_part2::ClusterState;
```
```rust
// Good: state.rs is a facade
mod run;
mod cluster;
pub use run::RunState;
pub use cluster::ClusterState;
// callers everywhere else still write `use crate::state::{RunState, ClusterState};`
```
**Source:** [`serde-rs/serde`'s `serde/src` tree](https://github.com/serde-rs/serde/tree/master/serde/src) (fetched 2026-09-03); [The Manifest Format, module path conventions, Rust 2018 Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2018/path-changes.html) (fetched 2026-09-03).

### R36. When splitting a god-module, keep the new children one-directional — route cross-references through the facade, not sibling-to-sibling
**Why:** Rust's compiler does not reject circular *module* dependencies within one crate (unlike circular *crate* dependencies, which it does reject) — the whole crate is one compilation unit, so `cluster::foo` calling `run::bar` which calls back into `cluster::baz` compiles fine. That means nothing forces good layering when splitting a god-module; the only thing that prevents the split from becoming the same tangle spread across more files is discipline: define a strict order among the new children (e.g., `cursor` depends on nothing new, `run` depends on `cursor`, `cluster` depends on `run` but never the reverse) and have children reach each other's items only through `pub(crate)` re-exports at the parent facade, never via `super::sibling::Item` reaching directly into a sibling's internals.
**Applies to us:** This is the specific, checkable failure mode to watch for when breaking up `state.rs`, `positioning.rs`, or any of `shaper`'s other 1800+-line modules: a reviewer can `grep -rn 'super::' packages/glyph/rust/shaper/src/state/` after a split and treat any match reaching past the immediate parent as a smell — cross-sibling coupling that should have gone through the facade's public re-exports instead.
**Source:** General Rust module-compilation-unit semantics (one crate = one compilation graph; no cross-module acyclicity requirement), consistent with the module path mechanics documented in [Path and module system changes, Rust 2018 Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2018/path-changes.html) (fetched 2026-09-03).

## DRY in Rust: macro vs. generic vs. trait vs. duplication

### R37. Apply the rule of three: duplicate twice, extract on the third occurrence
**Why:** The first occurrence of a pattern is just code. The second might be coincidence — extracting an abstraction from two data points routinely guesses the wrong shape for the abstraction, producing a generic/trait/macro that has to be reshaped (or worked around) the moment a third, different-shaped use case arrives. Waiting for a third real occurrence means the abstraction is fit to actual variation, not imagined variation.
**Applies to us:** With 52 files in `shaper` alone, the temptation to "generalize early" while splitting a god-module (R35–R36) is high — resist extracting a shared trait/macro for two child modules that happen to look similar; wait for the third.
**Source:** General software-engineering principle; applied to Rust specifically in [Item 28: Use macros judiciously, *Effective Rust*](https://effective-rust.com/macros.html) (fetched 2026-09-03).

### R38. Reach for a function or generic before a macro — macros are for abstracting syntax, not values or types
**Why:** *Effective Rust*'s framing (Item 28) places macros as the third rung of a generalization ladder: functions abstract over *values*, generics abstract over *types*, and macros are the only tool that can abstract over *code structure itself*. A macro is justified when the repetition is genuinely structural — the same *shape* of code needs to stay in sync across call sites in a way no function signature or type parameter can express (e.g., generating a method per enum variant, or keeping a `file!()`/`line!()`-tagged diagnostic consistent). If a plain function or `fn foo<T: Trait>(...)` already expresses the abstraction, using a macro instead is strictly worse: type-checking happens *after* macro expansion (closer to C++ templates than to generics), so a misuse produces an error pointing at expanded code the caller never wrote, not at their call site.
**Applies to us:** `abi_contract.rs` and `codec.rs` are the kind of wire-format code where "generate the same five trait impls for every wire type" is a common temptation — check whether a blanket trait impl or a generic function over a shared trait bound covers it before reaching for `macro_rules!`.
**Bad / Good:**
```rust
// Bad: macro used where a generic function would do — expansion-time errors, opaque to tooling
macro_rules! read_u16_le {
    ($buf:expr, $off:expr) => { u16::from_le_bytes([$buf[$off], $buf[$off + 1]]) };
}
```
```rust
// Good: ordinary generic function — type-checked before use, rustfmt/rust-analyzer both understand it
fn read_le<T: FromLeBytes>(buf: &[u8], off: usize) -> T {
    T::from_le_bytes(&buf[off..off + size_of::<T>()])
}
```
**Source:** [Item 28: Use macros judiciously, *Effective Rust*](https://effective-rust.com/macros.html) (fetched 2026-09-03 — "if you repeat the same structure of code in multiple places, encapsulate that code into a macro"; notes error messages become "less helpful" and that `rustfmt` and other tooling "may treat the code as opaque" once macros are involved).

### R39. Prefer `#[derive(...)]` to a hand-written impl whenever the derived semantics are exactly what's wanted
**Why:** A derive macro is the one class of macro *Effective Rust* explicitly recommends over a hand-rolled procedural macro or manual impl for per-field/per-variant code generation, precisely because its behavior is standardized, well-understood by every Rust developer, and mechanically re-derived correctly every time a field is added or removed — a hand-written `Clone`/`PartialEq`/`Hash` impl silently goes stale the day someone adds a field and forgets to update it.
**Applies to us:** Hand-write only when the derived semantics would be *wrong* for the type — a newtype wrapping a raw pointer where `Clone` must not be a bitwise copy, or an ABI-contract struct (`abi_contract.rs`) where `Debug` must redact or summarize a large buffer rather than dump it in full (also see R10 on the wasm-size cost of `Debug`).
**Bad / Good:**
```rust
// Bad: hand-written, goes stale silently the next time a field is added
impl Clone for GlyphMetrics {
    fn clone(&self) -> Self {
        Self { advance: self.advance, bearing: self.bearing }
        // a later PR adds `baseline` here and forgets to add it above — silent bug
    }
}
```
```rust
// Good
#[derive(Clone, Copy, PartialEq)]
struct GlyphMetrics { advance: i32, bearing: i32, baseline: i32 }
```
**Source:** [Item 28: Use macros judiciously, *Effective Rust*](https://effective-rust.com/macros.html) (fetched 2026-09-03 — "prefer derive macros over procedural macros for per-field/per-variant code generation").

### R40. Keep `macro_rules!` shallow and documented with a pre/post-expansion example; never hide control flow or captures inside one
**Why:** *Effective Rust* names the specific ways macros damage readability beyond raw line count: they create a small DSL every reader has to separately learn; they can confound tooling badly enough that "various tools that analyze and interact with Rust code may treat the code as opaque"; and macros that insert an implicit `return`/`break`/`continue` or capture a variable from the invocation site silently, rather than taking it as an explicit parameter, produce non-local control flow a reader cannot see at the call site.
**Applies to us:** Any macro introduced while de-duplicating the wire-format boilerplate in `codec.rs`/`codec_gather.rs`/`semantic_wire.rs` should show, in its doc comment, one concrete invocation and what it expands to — not just a description of its parameters — and should take every value it uses as an explicit `$arg`, never reach for a same-named variable assumed to exist at the call site.
**Source:** [Item 28: Use macros judiciously, *Effective Rust*](https://effective-rust.com/macros.html) (fetched 2026-09-03 — "avoid inserting implicit references", "exclude nonlocal control flow... unless that's the macro's explicit purpose").

## Dependency hygiene

### R41. Run `cargo deny check` in CI against a checked-in `deny.toml`
**Why:** `cargo-deny` enforces four independent policy dimensions from one config file: `advisories` (known-vulnerability database), `bans` (denied crates, duplicate-version detection), `licenses` (an explicit allow-list), and `sources` (which registries/git hosts are trusted). `cargo deny init` generates a documented starting config; `cargo deny check` runs all four.
**Applies to us:** A 12-crate workspace shipping to wasm (a redistributable artifact, unlike an internal service) is exactly the case where an unreviewed transitive license or an unpinned git source dependency becomes a real legal/supply-chain question, not a hypothetical one.
**Source:** [`EmbarkStudios/cargo-deny` README](https://github.com/EmbarkStudios/cargo-deny) (fetched 2026-09-03).

### R42. Run `cargo machete` for fast unused-dependency sweeps; use its `ignored`/`renamed` metadata for known false positives
**Why:** `cargo-machete` works by scanning source text for identifier usage rather than compiling, which makes it fast enough to run on every PR, at the cost of two documented false-positive classes: dependencies used only through proc-macro expansion or `build.rs`, and dependencies whose crate name differs from the name they're imported under (e.g. a crate depended on as `rustls-webpki` but imported as `webpki`). Both are addressed in `Cargo.toml`, not by disabling the check.
**Applies to us:** Run it in CI at `warn` (not a hard PR-blocker) given the false-positive classes above are plausible in a workspace this size, and maintain the ignore/rename list deliberately rather than suppressing the tool's output wholesale.
**Bad / Good:**
```toml
[package.metadata.cargo-machete]
ignored = ["build-script-only-dep"]

[package.metadata.cargo-machete.renamed]
rustls-webpki = "webpki"
```
**Source:** [`bnjbvr/cargo-machete` README](https://github.com/bnjbvr/cargo-machete) (fetched 2026-09-03).

### R43. Gate releases on `cargo semver-checks`, configuring individual lints per crate
**Why:** `cargo-semver-checks` compares rustdoc JSON between the current tree and a baseline (crates.io's last published version by default, or an explicit `--baseline-rev`/`--baseline-version`) and reports SemVer-incompatible changes: removed public items, changed function signatures, removed trait impls, and more. It exits `100` specifically for deny-level violations found (distinct from `101`, a tool failure), which is directly scriptable as a release gate. Per-lint severity is configurable in `[package.metadata.cargo-semver-checks.lints]` (or `[workspace.metadata...]` with per-crate `workspace = true` opt-in, mirroring R2).
**Applies to us:** This is the direct enforcement mechanism for R24's `exhaustive_enums`/`exhaustive_structs` policy — a root-level type marked exhaustive that later needs a new variant is caught here, at release time, rather than discovered by a downstream application's build breaking.
**Source:** [`obi1kenobi/cargo-semver-checks` README](https://github.com/obi1kenobi/cargo-semver-checks) (fetched 2026-09-03).

### R44. Use `cargo geiger` as an unsafe-surface discovery tool, never as a merge gate
**Why:** `cargo-geiger` counts `unsafe` usage across a crate and its dependency tree. Its own maintainers are explicit that the tool "is not meant to advise directly whether the code ultimately is truly insecure or not" — it is "statistical input to auditing," meant to be read by a person alongside complementary tools, not thresholded in CI. A hard "unsafe block count must not increase" gate on an unsafe-heavy, no_std, perf-sensitive engine would actively fight the codebase's own domain requirements.
**Applies to us:** Run it periodically (e.g., before a release, or when adding a new dependency) to see whether a new transitive dependency quietly introduced a large unsafe surface the team didn't choose — a discovery signal, not a number to defend in a PR review.
**Source:** [`rust-secure-code/cargo-geiger` GitHub repository](https://github.com/rust-secure-code/cargo-geiger) (fetched 2026-09-03 — "not meant to advise directly whether the code ultimately is truly insecure or not").

## Documentation, doctests, and no_std/wasm

### R45. Gate `no_std` behind a `cfg` so doctests and unit tests keep linking `std`
**Why:** A doctest is not compiled as part of the library crate — rustdoc extracts each code block and compiles it as its own free-standing executable, which links normally against `std` regardless of whether the library it's exercising is `no_std`. This works transparently as long as the *library* itself doesn't hard-require `no_std` in a way that fights the host test binary — the common, working pattern is `#![cfg_attr(not(test), no_std)]` (or gating `no_std` behind a `std` feature that test builds enable), so `cargo test`/`cargo test --doc` on the host target build the crate *with* `std` available, while the real shipped build (`cargo build --target wasm32-unknown-unknown`) does not.
**Applies to us:** Verify each of the 12 crates' `lib.rs` uses this pattern (or equivalent) rather than an unconditional `#![no_std]` — an unconditional one either breaks every doctest/host-side unit test outright, or forces the crate to provide its own `#[panic_handler]`/allocator even for test builds, neither of which is what a no_std *library* (as opposed to a no_std *binary*) actually needs.
**Source:** [Documentation tests — how rustdoc compiles each block, rustdoc book](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) (fetched 2026-09-03); [`cargo test` — doctest execution model, Cargo Book](https://doc.rust-lang.org/cargo/commands/cargo-test.html) (fetched 2026-09-03 — "each code block compiles to a doctest executable on the fly with `rustc`. These executables run in parallel in separate processes").

### R46. Don't count on doctests to verify the wasm32-unknown-unknown build
**Why:** Per R45's mechanism, every doctest compiles to its own executable that must then be *run* as a subprocess. `wasm32-unknown-unknown` produces a freestanding `.wasm` module with no default way for the host OS to execute it directly — running one requires an explicit `runner` configured for that target in `.cargo/config.toml` (a JS shim, `wasmtime`, or similar). Without one configured, `cargo test --doc --target wasm32-unknown-unknown` cannot execute the compiled doctest binaries, so doctests are effectively validated only against the host target.
**Applies to us:** Any code gated behind `#[cfg(target_arch = "wasm32")]` gets zero doctest coverage under the default setup — the real verification for that code path has to be a genuine `cargo build --target wasm32-unknown-unknown` (and, for behavior, an integration test that actually runs under wasm, not a doctest) in CI, not an assumption that "the doctests passed" says anything about the wasm build.
**Source:** Mechanism confirmed via [`cargo test` doctest execution model, Cargo Book](https://doc.rust-lang.org/cargo/commands/cargo-test.html) (fetched 2026-09-03) combined with wasm32-unknown-unknown's documented lack of a default execution environment (a freestanding target requiring an explicit configured `runner` to execute any compiled artifact) — verify locally with `cargo test --doc --target wasm32-unknown-unknown` against this workspace before relying on this rule.

## Test organization

### R47. Same-file `#[cfg(test)] mod tests` for white-box tests; `tests/` for black-box public-API tests; doctests only for examples worth publishing
**Why:** A same-file `#[cfg(test)] mod tests` block compiles as part of the crate itself, so it can see private items — the right place for a test that needs to reach into `cluster_state`'s internal cursor logic. Each file under `tests/` compiles as its own separate crate that can only see the library's public API — the right place for "does this engine produce the right shaped output for this input," independent of internal structure. A doctest is both a test *and* published documentation every downstream user reads — reserve it for examples that earn a place in the public docs, not for exercising edge cases (those belong in one of the first two).
**Applies to us:** Given R46, remember that anything in `tests/` also only runs against whatever target `cargo test` is invoked for — a `tests/` integration test is not automatically wasm32 coverage either, unless explicitly run with `--target wasm32-unknown-unknown` and a configured runner.
**Source:** Rust's standard unit/integration/doctest visibility model, consistent with [`cargo test` documentation, Cargo Book](https://doc.rust-lang.org/cargo/commands/cargo-test.html) (fetched 2026-09-03) and [Documentation tests, rustdoc book](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) (fetched 2026-09-03).

### R48. Name shared integration-test helpers `tests/common/mod.rs`, not `tests/common.rs`
**Why:** Cargo treats every top-level file directly under `tests/` as its own independent test-binary crate. A `tests/common.rs` would be compiled and run as a (probably-empty) test binary of its own. Nesting it one level down as `tests/common/mod.rs` opts it out of that treatment — Cargo only auto-discovers top-level files in `tests/` as test crates, not files inside subdirectories — while still letting other files do `mod common; common::setup();` to reuse it.
**Applies to us:** This is the one place in the codebase where the `mod.rs` naming R33 otherwise bans is the deliberately correct choice, precisely because it's exploiting different Cargo behavior (test-binary auto-discovery) than ordinary library module resolution.
**Source:** Cargo's documented test-target auto-discovery (each direct child of `tests/` becomes its own test binary), consistent with [`cargo test`, Cargo Book](https://doc.rust-lang.org/cargo/commands/cargo-test.html) (fetched 2026-09-03).

## Measuring maintainability honestly

### R49. Don't gate CI on a single complexity number — use `too_many_lines` plus targeted human review, or a full multi-metric report read by a person
**Why:** Clippy's own authors ship `cognitive_complexity` at allow-by-default and directly say, in the lint's own documentation, that "the true Cognitive Complexity of a method is not something we can calculate using modern technology" — the tool that would compute the metric doesn't trust its own output enough to turn it on by default. `rust-code-analysis` (Mozilla) computes a genuinely broader set — cyclomatic complexity, cognitive complexity, Halstead measures, and a maintainability index — across a file or crate, which is a legitimate input to a periodic human review, but multi-metric output read by a person is a different practice than a single CI-blocking threshold.
**Applies to us:** For the ten largest modules in `shaper` (1849–5926 lines), the actionable CI-enforceable signal is `too_many_lines` per-function (R16); a `rust-code-analysis` run over the whole crate is a good input to a deliberate, human-scheduled maintainability review (the repository already has a `maintainability-review` skill for exactly this kind of pass) — not a number to wire into the same gate that blocks a PR.
**Source:** `clippy_lints/src/functions/mod.rs` (fetched 2026-09-03) — `COGNITIVE_COMPLEXITY` doc comment, group `restriction`/allow-by-default, quoted above verbatim; [`mozilla/rust-code-analysis` README](https://github.com/mozilla/rust-code-analysis) (fetched 2026-09-03).

### R50. Treat LOC-per-module, unsafe-block counts, and dependency-duplication counts as conversation starters, not merge thresholds
**Why:** Every metrics tool recommended in this document — `cargo geiger` (R44), raw module line counts (R34), `multiple_crate_versions` (R29) — has a documented, acknowledged gap between what it counts and what it means: geiger counts unsafe blocks, not unsound ones; a line count doesn't distinguish one big function from forty small ones; a duplicated crate version is sometimes unfixable from this side of the dependency graph. Wiring any one of them into a hard CI gate produces adversarial code optimized against the metric (a 4999-line file split at exactly the wrong seam to dodge a 5000-line check) rather than code optimized for the property the metric was a proxy for.
**Applies to us:** Use these numbers to decide *where* a human maintainability review (R49) should look first across 63k LOC, not as a pass/fail condition attached to a specific PR.
**Source:** Synthesis of R29, R34, R44, R49's individually-cited sources above — each tool's own documentation acknowledges the specific gap this rule generalizes from.

## Proposed workspace lint table

```toml
# --- workspace root Cargo.toml ---
# Every member crate must add, verbatim, and nothing else in that table (R2, R3):
#   [lints]
#   workspace = true

[workspace.lints.rust]
# Edition 2024 defaults this to "warn"; this workspace is unsafe-heavy enough (12 crates,
# no_std + wasm, no unwinding on panic) that a missed inner-unsafe-block is a soundness bug,
# not a style nit. (R8)
unsafe_op_in_unsafe_fn = "deny"
# 52 files in `shaper` alone: force every non-re-exported item to say so via pub(crate)/pub(super). (R6)
unreachable_pub = "deny"
# bare_trait_objects, elided_lifetimes_in_paths, ellipsis_inclusive_range_patterns,
# explicit_outlives_requirements, unused_extern_crates — explicit lifetimes matter most in
# abi_contract.rs / semantic_wire.rs, where a signature's borrows are part of the contract. (R7)
rust_2018_idioms = "deny"
unused_qualifications = "warn"
# Zero prior [lints] config anywhere in the workspace: start at warn, expect a real backlog
# across 63k LOC, ratchet to deny per-crate as each is deliberately documented. (R5, R9)
missing_docs = "warn"
# Not deny: derived Debug pulls in core::fmt machinery, and the engine is already 46% of the
# shipped wasm artifact. Opt in per public type, don't blanket-derive. (R10)
missing_debug_implementations = "warn"
trivial_casts = "warn"
trivial_numeric_casts = "warn"

[workspace.lints.clippy]
# Explicit rather than relying on cargo's implicit defaults, so the table is self-documenting.
all = { level = "warn", priority = -1 }
pedantic = { level = "warn", priority = -1 }
# Nursery lints are unstable and can be reworked/demoted on a toolchain bump; warn + re-review
# on every Rust version pin change, don't auto-deny. (R13)
nursery = { level = "warn", priority = -1 }
cargo = { level = "warn", priority = -1 }
# NEVER `restriction = "..."` as a group — clippy's own blanket_clippy_restriction_lints
# (on by default) exists specifically to catch that mistake. Every restriction lint below
# is named individually on purpose. (R12)

# --- pedantic: deliberate opt-outs ---
module_name_repetitions = "allow"   # noisy across shaper's many *_state / *_plan / *_wire modules

# --- pedantic: kept on, with the reasoning that makes each one worth the noise ---
too_many_lines = "warn"             # flags the FUNCTION, not the file — the right granularity
                                     # for a 5926-line state.rs; configure the threshold in
                                     # clippy.toml, not here (R16)
missing_errors_doc = "warn"         # documents the engine-call-contract "answers or throws" rule (R15)
missing_panics_doc = "warn"         # use #[expect(clippy::missing_panics_doc, reason = "...")] per call site
cast_possible_truncation = "warn"   # font-unit / fixed-point conversions in positioning.rs, stable_plan.rs (R14)
cast_sign_loss = "warn"
cast_possible_wrap = "warn"
cast_precision_loss = "warn"
large_stack_arrays = "deny"         # wasm32's small fixed stack has no guard-page overflow story (R17)

# --- restriction: cherry-picked individually (R12); unsafe-documentation pair (R18, R19) ---
undocumented_unsafe_blocks = "deny"        # every unsafe block gets a preceding // SAFETY: comment
multiple_unsafe_ops_per_block = "deny"     # one unsafe op per block = one traceable justification
unnecessary_safety_comment = "warn"        # catches SAFETY comments cargo-culted onto safe code
# missing_safety_doc is NOT listed here — it's already on by default (style group). (R20)

# --- restriction: #[expect]-enforcement pair (R25, ties to R30-R32) ---
allow_attributes = "warn"                  # prefer #[expect] so a stale allow becomes a warning, not silent rot
allow_attributes_without_reason = "deny"   # every allow/expect states why, enforced not just documented

# --- restriction: panic/Result discipline (R21) ---
unwrap_used = "warn"                       # library code should propagate through Result, not panic
expect_used = "warn"
unwrap_in_result = "deny"                  # a fn returning Result must never unwrap/expect internally —
                                            # contradicts its own signature otherwise

# --- restriction: buffer safety (R22) ---
indexing_slicing = "warn"                  # cluster_state.rs / codec.rs / codec_gather.rs are buffer-heavy;
                                            # warn (not deny) so a proven-safe hot-path index is a visible
                                            # choice, not a forced rewrite

# --- restriction: no_std discipline, mechanical and cheap (R23) ---
std_instead_of_core = "deny"
std_instead_of_alloc = "deny"
alloc_instead_of_core = "warn"

# --- restriction: API stability, pairs with cargo-semver-checks at release time (R24) ---
exhaustive_enums = "warn"           # root-level types (engine-call-contract) opt into non_exhaustive
exhaustive_structs = "warn"         # on purpose, not by omission

# --- nursery: visibility + const hygiene (R28) ---
missing_const_for_fn = "warn"       # re-run after each fix; the lint only does one pass
redundant_pub_crate = "warn"        # the inverse of unreachable_pub: pub(crate) inside an already-private module

# --- cargo: manifest hygiene (R29) ---
multiple_crate_versions = "warn"    # escape hatch: clippy.toml `allowed-duplicate-crates`
wildcard_dependencies = "deny"      # no legitimate "*" dependency in a shipped engine
negative_feature_names = "warn"

# Deliberately NOT enabled, with reasons (R26, R27):
#   arithmetic_side_effects   — fires on nearly every line of numeric layout math; the cast_*
#                                lints above already catch the conversions that actually matter
#   cognitive_complexity      — clippy's own docs call the metric uncomputable; use too_many_lines
#   min_ident_chars           — clippy's own docs call it "very noisy"; run as a one-off audit only
```

```toml
# --- clippy.toml (repo root; lint *thresholds*, not levels — separate file from Cargo.toml) ---
too-many-lines-threshold = 150          # default 100; this codebase's hot-path state functions run long
allowed-duplicate-crates = []           # add specific crates here only when a transitive dep forces it,
                                         # with a comment on each entry saying which dependency forced it
```
