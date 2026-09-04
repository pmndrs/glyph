---
type: Reference
title: Rust codex — Data-oriented design in Rust
description: Checkable rules on data-oriented design in rust, researched against primary sources, each with rationale, applicability to this repository, and a citation.
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

### R1. Default to array-of-structs; convert to struct-of-arrays only where a profile names a hot loop that touches a narrow subset of fields across many records.
**Why:** SoA earns its keep by shrinking the bytes fetched per useful item when a loop reads or writes only some fields of a record. If the loop already touches every field, SoA adds indirection and a length-invariant to maintain for no cache benefit.
**Applies to us:** shaper's per-cluster loops (positioning touches x/y-advance and x/y-offset out of a wider cluster-state record) are a plausible SoA target; plan-encoding record types that TypeScript reads whole are not — flattening those buys nothing.
**Bad / Good:**
```rust
// Bad: SoA introduced without profiling — three extra Vecs, one more
// invariant to maintain, for a loop that already visits every field.
struct GlyphRun { ids: Vec<u16>, x_advance: Vec<f32>, y_advance: Vec<f32>, color: Vec<[u8; 4]> }
fn draw_all(run: &GlyphRun) {
    for i in 0..run.ids.len() { draw(run.ids[i], run.x_advance[i], run.y_advance[i], run.color[i]); }
}
```
```rust
// Good: single AoS Vec until a profile shows this loop is hot AND reads
// only a subset of fields.
struct Glyph { id: u16, x_advance: f32, y_advance: f32, color: [u8; 4] }
fn draw_all(run: &[Glyph]) { for g in run { draw(g.id, g.x_advance, g.y_advance, g.color); } }
```
**Source:** Tweede golf, "Optimizing a parser/compiler with data-oriented design: a case study", https://tweedegolf.nl/en/blog/88/data-oriented-design (measured 1.12x, 1.69x vs `Box<Def>`, ~12% less memory; retrieved 2026-09-03). James McMurray, "An introduction to Data Oriented Design with Rust", https://jamesmcm.github.io/blog/intro-dod/ ("finishes in half the time"; retrieved 2026-09-03). Guillaume Endignoux, "Optimization adventures: making a parallel Rust workload even faster with data-oriented design", https://gendignoux.com/blog/2024/12/02/rust-data-oriented-design.html (up to 20% best case), 2024-12-02.

### R2. Keep SoA behind an invariant-checked container — a derive macro, or a hand-rolled type that asserts equal lengths on every mutation — never expose sibling `Vec`s a caller can desync.
**Why:** parallel `Vec`s carry no structural guarantee of equal length or matching order. A push to one and not the others is silent data corruption, not a compile error or even a panic.
**Applies to us:** the plan-encoding buffers shared with TypeScript are exactly this shape (parallel typed arrays). A length mismatch there corrupts what the JS side decodes, with nothing on the Rust side to catch it.
**Bad / Good:**
```rust
// Bad: nothing stops this from pushing to two of three arrays.
struct Plan { glyph_id: Vec<u16>, x_offset: Vec<f32>, y_offset: Vec<f32> }
fn push_partial(p: &mut Plan, id: u16, x: f32) { p.glyph_id.push(id); p.x_offset.push(x); }
```
```rust
// Good: one entry point, one invariant, enforced in one place.
impl Plan {
    fn push(&mut self, id: u16, x: f32, y: f32) {
        self.glyph_id.push(id); self.x_offset.push(x); self.y_offset.push(y);
        debug_assert_eq!(self.glyph_id.len(), self.x_offset.len());
    }
}
```
**Source:** `soa_derive`, https://docs.rs/soa_derive/latest/soa_derive/ and https://github.com/lumol-org/soa-derive (retrieved 2026-09-03). `soa-rs`, https://github.com/tim-harding/soa-rs and https://docs.rs/soa-rs/latest/soa_rs/ (retrieved 2026-09-03).

### R3. Budget for SoA's ergonomic loss up front: a generated SoA container cannot implement `Index`/`IndexMut` returning a reference to "the record."
**Why:** `Index::index` must return `&Self::Output`. A SoA row is scattered across N arrays, so the accessor is a constructed value (a `Ref`/tuple), not a borrow — bracket syntax (`v[i]`) is unavailable; only method-call access (`v.get(i)`, `v.x_advance()[i]`) is.
**Applies to us:** any shaper/mtsdf code migrated to SoA loses `run[i].x_advance` at every call site; audit call sites before migrating a widely-indexed type, not after.
**Bad / Good:**
```rust
// AoS: bracket indexing to a whole record.
let a = run[i].x_advance;
```
```rust
// SoA: no record to borrow; access per field or via a constructed value type.
let a = run.x_advance()[i]; // or: let r = run.get(i); let a = r.x_advance;
```
**Source:** `soa_derive` docs, https://docs.rs/soa_derive/latest/soa_derive/ (CheeseVec/CheeseRef cannot implement `Deref`/`Index` because the target isn't a reference; retrieved 2026-09-03). Tim Harding, "Macros, Safety, and SOA", https://timharding.co/blog/soa-rs/ (retrieved 2026-09-03).

### R4. Don't convert record-lifecycle-heavy data — frequent whole-record insert/remove/reorder — to SoA.
**Why:** SoA's per-field arrays each need an insert/remove at the same logical position for every mutation. An AoS `Vec<T>::swap_remove` is one move; the SoA equivalent is N moves and N chances for the arrays to desync mid-operation.
**Applies to us:** bidi run splitting and line-breaking's run insertion/removal in the shaper are record-lifecycle-heavy — keep those AoS even if neighboring positioning code goes SoA.
**Bad / Good:** n/a — the failure mode is architectural (mutation pattern), not a local snippet.
**Source:** `soa-rs` docs.rs description: "SoA does not offer performance wins in all cases — in particular, operations such as push and pop are usually slower than for `Vec` since the memory for each field is far apart", https://docs.rs/soa-rs/latest/soa_rs/ (retrieved 2026-09-03).

### R5. When splitting a record for SoA, split by access-correlation, not by exploding every field into its own array — keep fields that are always read together in the same array.
**Why:** hashbrown/SwissTable gets its speed by pulling only the searchable metadata (control bytes) into a dense array for SIMD scanning, while keeping key and value together, because "you don't want to unzip them into an array of K and an array of V since accessing a key is highly correlated with accessing its value."
**Applies to us:** mtsdf admission's per-sample inside/outside test is hot, narrow metadata; the distance-field payload is read only for samples that pass. Split those two. Don't also split the payload's own components apart without evidence they're accessed independently.
**Bad / Good:**
```rust
// Bad: splits every field, including x/y which are always read together.
struct SamplesSoA { pass: Vec<bool>, x: Vec<f32>, y: Vec<f32>, dist: Vec<f32> }
```
```rust
// Good: split by what's scanned hot (pass) vs. what's read only on a hit.
struct SamplesSoA { pass: Vec<bool>, payload: Vec<(f32, f32, f32)> }
```
**Source:** Aria Beingessner, "Swisstable, a Quick and Dirty Description", https://faultlore.com/blah/hashbrown-tldr/ (retrieved 2026-09-03).

### R6. Choose a collection's storage strategy (columnar/SoA vs. sparse/indexed) per its mutation pattern, not by copying whatever the rest of the codebase uses.
**Why:** columnar storage wins at sequential iteration and loses at single-record insert/remove, because the record's slot must move across every column. Sparse storage wins at insert/remove and loses at iteration, because lookups add indirection and defeat prefetch.
**Applies to us:** raster-artifact's Bitmap/MSDF/Slug variants likely differ in mutation pattern (bulk-written raster payload vs. incrementally-built vector outline) — don't assume one storage scheme fits all three.
**Bad / Good:** n/a — decision is per-collection, not a code pattern.
**Source:** Bevy Cheatbook, "Component Storage (Table/Sparse-Set)", https://bevy-cheatbook.github.io/patterns/component-storage.html: "Table storage is optimized for fast query iteration... Sparse-Set storage is optimized for fast adding/removing... Everything depends on your application's unique usage patterns. You have to measure and try." (retrieved 2026-09-03). `bevy::ecs::storage`, https://docs.rs/bevy/latest/bevy/ecs/storage/index.html.

### R7. Replace a shared-mutable graph or self-referential structure with index handles into one flat store, instead of `Rc<RefCell<Node>>` or raw references.
**Why:** the borrow checker enforces one mutable path to a value at a time. A graph with back-edges or shared ownership has no single such path, so it needs either runtime-checked cells (which add overhead and can panic) or a flat arena where "edges" are `Copy` indices the checker has no opinion about.
**Applies to us:** font-baker's composite-glyph trees and contour graphs are this shape — index into a `Vec<Contour>` rather than linking contours by reference.
**Bad / Good:**
```rust
// Bad: fights the borrow checker, one allocation + refcount per node.
struct Node { children: Vec<Rc<RefCell<Node>>> }
```
```rust
// Good: indices into a flat arena; no lifetime, no refcount, Copy handle.
struct NodeId(u32);
struct Node { children: Vec<NodeId> }
struct Arena { nodes: Vec<Node> }
```
**Source:** Catherine West (kyren), RustConf 2018 closing keynote writeup, https://kyren.github.io/2018/09/14/rustconf-talk.html, 2018-09-14 ("plain Vecs and indexes should be the first tool you reach for"). Rust users forum, "Graph data structure (fighting the borrow checker)", https://users.rust-lang.org/t/graph-data-structure-fighting-the-borrow-checker/3486 (retrieved 2026-09-03).

### R8. Use a generational `(index, generation)` handle, not a bare index, for any slot whose entry can be freed and the slot reused — and size the generation counter against the slot's real churn.
**Why:** a bare index is unique only until its slot is reused; a stale handle then silently reads someone else's data (the ABA problem). A generation counter bumped on every reuse turns that silent corruption into a checked lookup failure, at the cost of one extra integer per handle and per slot.
**Applies to us:** any rasterized-glyph cache/atlas slot in baker/admission that gets evicted and reused needs this — otherwise a JS-held handle to an evicted glyph starts returning a different glyph's bitmap with no error.
**Bad / Good:**
```rust
// Bad: bare index into a Vec whose entries get replaced in place.
type GlyphSlot = u32;
```
```rust
// Good: generation catches use of a handle to an evicted-and-reused slot.
struct GlyphSlot { index: u32, generation: u32 }
// slotmap / generational-arena return None (or panic) on a generation
// mismatch, not the wrong glyph's bytes.
```
A `u32` generation reused ~2^31 times on one slot wraps and can repeat a key — pick a counter width the slot's real churn can't exhaust, or document the risk explicitly.
**Source:** `generational-arena`, https://github.com/fitzgen/generational-arena and https://crates.io/crates/generational-arena ("allows deletion without suffering from the ABA problem by using generational indices"; retrieved 2026-09-03). `slotmap`, https://docs.rs/slotmap (generation-wraparound caveat; retrieved 2026-09-03).

### R9. Wrap each arena's index in its own newtype (with `PhantomData<Arena>` if the arena type is generic) so the compiler rejects using one arena's index on another.
**Why:** two `u32` index types are structurally identical and interchangeable to the compiler; nothing but a reviewer stops one being passed where the other is expected. A distinct newtype turns that mistake into a type error.
**Applies to us:** shaper juggles cluster indices, glyph indices, and byte offsets in the same functions — a mix-up is a classic silent-corruption bug in a 47k-line shaping engine, and the compiler can catch it for free.
**Bad / Good:**
```rust
// Bad: both are u32; swapping call-site arguments compiles silently.
fn advance_for(cluster: u32, glyph: u32) -> f32 { /* ... */ }
```
```rust
// Good: distinct newtypes; swapping arguments is a compile error.
struct ClusterIndex(u32);
struct GlyphIndex(u32);
fn advance_for(cluster: ClusterIndex, glyph: GlyphIndex) -> f32 { /* ... */ }
```
**Source:** Rust By Example, "Phantom type parameters", https://doc.rust-lang.org/rust-by-example/generics/phantom.html (retrieved 2026-09-03) — standard community pattern for typed IDs/indices, not tied to one publication.

### R10. Don't hand-reorder fields of a `repr(Rust)` struct to save padding — the compiler's default layout already minimizes it. Hand-ordering only has an effect once the type opts into `repr(C)`.
**Why:** `repr(Rust)` layout is deliberately unspecified so the compiler is free to reorder fields for minimal padding, and on nightly with `-Z randomize-layout` to shuffle them to catch code that wrongly assumes an order. Source-order field reordering has been in stable rustc since 1.18 (2017).
**Applies to us:** internal shaper/mtsdf structs that don't cross the wasm boundary should stay `repr(Rust)` and skip manual field-order tuning — it's effort the compiler already spends, and it obscures the one place ordering does matter (R11).
**Bad / Good:**
```rust
// Wasted effort: hand-sorted large-to-small for a repr(Rust) struct — the
// compiler already does this, and this order isn't what's guaranteed to
// actually be emitted.
struct Cluster { x_advance: f32, y_advance: f32, cluster_len: u8, flags: u8 }
```
```rust
// Correct framing: order fields for readability; let layout be repr(Rust).
struct Cluster { flags: u8, cluster_len: u8, x_advance: f32, y_advance: f32 }
```
**Source:** The Rustonomicon, "repr(Rust)", https://doc.rust-lang.org/nomicon/repr-rust.html (retrieved 2026-09-03). camlorn, "Optimizing Rust Struct Size: A 6-month Compiler Development Project", https://camlorn.net/posts/April%202017/rust-struct-field-reordering/, 2017-04.

### R11. Put `#[repr(C)]` on every type whose byte layout is a contract — an FFI boundary, a wasm↔JS shared buffer, or an on-disk/on-wire format — and nowhere else.
**Why:** `repr(C)` is the only representation that fixes field order, size, and padding to C ABI rules. `repr(Rust)` gives none of those guarantees — not even across two instances of a *different* type with identical fields (see R17).
**Applies to us:** this is the load-bearing rule for glyph's plan-encoding records. Anything TypeScript reads out of the wasm flat buffer by byte offset must be `repr(C)` (or `repr(transparent)`, or an explicit manual encode), or a compiler upgrade can silently change the offsets TS decodes against.
**Bad / Good:**
```rust
// Bad: TS decodes this by byte offset, but layout is unspecified and can
// change between compiler versions, or even between debug/release.
struct PlanRecord { glyph_id: u16, flags: u8, x_offset: f32, y_offset: f32 }
```
```rust
// Good: layout is part of the published contract.
#[repr(C)]
struct PlanRecord { glyph_id: u16, flags: u8, x_offset: f32, y_offset: f32 }
```
**Source:** The Rustonomicon, "Other reprs", https://doc.rust-lang.org/nomicon/other-reprs.html (retrieved 2026-09-03).

### R12. Don't reach for `#[repr(packed)]` on a struct with multi-byte fields without a specific, documented reason.
**Why:** packing removes alignment padding by letting fields start at unaligned addresses. Taking `&T` to such a field and dereferencing it is undefined behavior on any target that doesn't tolerate the misaligned load, and rustc lints this specifically because it has shipped real bugs: "As this can cause undefined behavior, the lint has been implemented and it will become a hard error."
**Applies to us:** the temptation is real for the wasm plan buffer (every byte saved is a byte not shipped to the browser), but wasm32 currently tolerating unaligned loads is a target detail, not a language guarantee `repr(packed)` gives you. Prefer `repr(C)` with fields ordered large-to-small, which removes most padding without the UB risk.
**Bad / Good:**
```rust
// Bad: packed struct; references to multi-byte fields are UB-prone.
#[repr(C, packed)]
struct PlanRecord { flags: u8, glyph_id: u16, x_offset: f32 }
```
```rust
// Good: reorder large-to-small under plain repr(C); no packing needed.
#[repr(C)]
struct PlanRecord { x_offset: f32, glyph_id: u16, flags: u8 }
```
**Source:** The Rustonomicon, "Other reprs", https://doc.rust-lang.org/nomicon/other-reprs.html (retrieved 2026-09-03).

### R13. When padding a struct to avoid false sharing between cores, pad to 128 bytes on x86-64/aarch64/powerpc64 — not the "native" 64-byte line.
**Why:** on modern Intel architectures the spatial prefetcher pulls pairs of adjacent 64-byte lines together, so two hot fields 64 bytes apart can still ping-pong between cores. Crossbeam's own `CachePadded` states the reasoning directly: "spatial prefetcher is pulling pairs of 64-byte cache lines at a time, so we pessimistically assume that cache lines are 128 bytes long."
**Applies to us:** low priority inside a single wasm32 module today (no cross-core sharing without the threads proposal), but directly applicable to any multi-threaded native batch tool — a font-baker CLI sharding a bake job across OS threads — that shares mutable counters/cursors between workers.
**Bad / Good:**
```rust
// Bad: two hot atomics 8 bytes apart, padded to 64 — still false-shares
// under Intel's paired-line prefetch.
#[repr(align(64))]
struct Counters { produced: AtomicU64, consumed: AtomicU64 }
```
```rust
// Good: crossbeam's CachePadded — 128 bytes on x86-64/aarch64/powerpc64,
// 256 on s390x, 32 on arm/mips/sparc/hexagon, 64 elsewhere.
struct Counters { produced: CachePadded<AtomicU64>, consumed: CachePadded<AtomicU64> }
```
**Source:** `crossbeam_utils::CachePadded`, https://docs.rs/crossbeam-utils/latest/crossbeam_utils/struct.CachePadded.html (retrieved 2026-09-03).

### R14. Zone a hot struct's fields by (writer, temperature): give each writer's hot fields their own padded line, and pack cold fields together, unpadded.
**Why:** two fields written by different threads/producers must not share a cache line, or every write invalidates the other side's cache regardless of locking. A cold field padded to a full line wastes it, since nobody contends for cold data.
**Applies to us:** general pattern for shared progress/cursor state in a native multi-threaded bake or shape-batch pipeline; not relevant to single-threaded per-call shaper/mtsdf state.
**Bad / Good:**
```rust
// Bad: producer- and consumer-written fields interleaved, unzoned.
struct Ring { tail: AtomicU64, head: AtomicU64, cached_head: u64, cached_tail: u64, metrics: Metrics }
```
```rust
// Good: zoned by writer, cold fields packed together deliberately.
#[repr(C)]
struct Ring {
    tail: CacheAligned<AtomicU64>, cached_head: CacheAligned<UnsafeCell<u64>>, // producer-hot
    head: CacheAligned<AtomicU64>, cached_tail: CacheAligned<UnsafeCell<u64>>, // consumer-hot
    closed: AtomicBool, metrics: Metrics, config: Config,                     // cold, packed
}
```
**Source:** "Cache-Conscious Data Layout in Rust: Field Zoning, False Sharing, and the 128-Byte Rule", https://debasishg.github.io/blog/part1-cache-conscious-data-layout-in-rust/ (retrieved 2026-09-03).

### R15. Give an enum a niche-bearing payload (`NonZero*`, `Box<T>`, `&T`, `NonNull<T>`) when you want `Option<T>`/`Result<T, E>` to cost nothing extra; an explicit integer `#[repr]` on a data-carrying variant forfeits this.
**Why:** the compiler encodes `None`/`Err` in an otherwise-invalid bit pattern of the payload (e.g. a null pointer) when one exists, so `Option<T>` becomes the same size as `T`. Forcing an explicit tag repr on a variant that carries data removes the invalid-bit-pattern space the compiler needs, so it falls back to an explicit tag byte/word.
**Applies to us:** any `Option<GlyphIndex>`/`Option<&Glyph>`-shaped field in a per-glyph record, repeated across thousands of glyphs, pays for this choice thousands of times over. Check with `niche.rs` or a `size_of` assert (R16) rather than assuming.
**Bad / Good:**
```rust
// Bad: repr(u8) on a data-carrying variant kills the niche.
#[repr(u8)]
enum MaybeGlyph { Some(&'static Glyph), None } // 16 bytes on a 64-bit target
```
```rust
// Good: default repr(Rust), reference payload — null-pointer niche applies.
enum MaybeGlyph { Some(&'static Glyph), None } // 8 bytes, same as &Glyph
```
**Source:** The Rustonomicon, "Other reprs" (the `MyReprOption<T>` example, 8→16 bytes when `repr(u8)` suppresses null-pointer optimization), https://doc.rust-lang.org/nomicon/other-reprs.html. niche.rs, "About", https://niche.rs/about (retrieved 2026-09-03).

### R16. Assert struct/enum sizes with a compile-time check next to the type definition, for any type where size is part of the design.
**Why:** a size regression in a hot record type — an added field, a lost niche, a forgotten `repr(C)` — is otherwise invisible until someone profiles or a wasm decoder mismatches. A `const_assert`/`assert_eq_size!` next to the type turns it into a compile failure at the point of the change.
**Applies to us:** the plan-encoding record and any per-glyph/per-cluster hot struct in shaper/mtsdf should carry this.
**Bad / Good:**
```rust
// Bad: no guard; a later added field silently doubles per-glyph memory.
#[repr(C)]
struct PlanRecord { glyph_id: u16, flags: u8, x_offset: f32, y_offset: f32 }
```
```rust
// Good: CI fails the instant the size moves, with the diff visible in review.
#[repr(C)]
struct PlanRecord { glyph_id: u16, flags: u8, x_offset: f32, y_offset: f32 }
static_assertions::assert_eq_size!(PlanRecord, [u8; 12]);
```
**Source:** `static_assertions`, https://docs.rs/static_assertions and https://github.com/nvzqz/static-assertions (`assert_eq_size!`, `const_assert!`; must be invoked from within a function body; retrieved 2026-09-03).

### R17. Never `transmute`/byte-cast between two independently-defined `repr(Rust)` types, even when they "look the same." Only `repr(C)`/`repr(transparent)` (or the *same* type) give a layout guarantee to rely on.
**Why:** the Rustonomicon guarantees that two *instances of the same type* share layout, but explicitly does not guarantee two *different* types with identical fields share layout. The compiler is free to lay them out differently, and `-Z randomize-layout` exists specifically to catch code that quietly assumed otherwise.
**Applies to us:** general — anywhere shaper/mtsdf is tempted to reinterpret one internal struct as another for a "free" conversion, go through an explicit field-by-field constructor or a shared `repr(C)` type instead.
**Bad / Good:**
```rust
// Bad: assumes two repr(Rust) types with "the same fields" share layout.
let b: OtherRecord = unsafe { std::mem::transmute(record) };
```
```rust
// Good: explicit, correct regardless of either type's actual layout.
let b = OtherRecord { glyph_id: record.glyph_id, flags: record.flags };
```
**Source:** The Rustonomicon, "repr(Rust)", https://doc.rust-lang.org/nomicon/repr-rust.html. rust-lang/rust tracking issue #106764, "-Z randomize-layout" (retrieved 2026-09-03).

### R18. Replace `Vec<Box<dyn Trait>>` with an enum (matched directly, or via `enum_dispatch`) whenever the set of implementing types is closed.
**Why:** a boxed trait object adds a heap allocation and a vtable-indirect call, and defeats the sequential prefetch a flat `Vec` gives you. An enum stores the variant inline in the `Vec`'s own buffer and dispatches through a jump table the branch predictor learns.
**Applies to us:** raster-artifact's Bitmap/MSDF/Slug is a closed, fixed set of raster kinds — a natural enum, not a trait-object collection.
**Bad / Good:**
```rust
// Bad: heap alloc + vtable call per rasterizer, per call.
let rasterizers: Vec<Box<dyn Rasterizer>> = vec![Box::new(Bitmap), Box::new(Msdf)];
```
```rust
// Good: inline storage, jump-table dispatch.
enum RasterKind { Bitmap(Bitmap), Msdf(Msdf), Slug(Slug) }
let rasterizers: Vec<RasterKind> = vec![RasterKind::Bitmap(Bitmap), RasterKind::Msdf(Msdf)];
```
**Source:** `enum_dispatch`, https://docs.rs/enum_dispatch/latest/enum_dispatch/ — verified benchmark, 1024 randomly-typed trait objects in a `Vec`, `black_box`ed method calls, successive iteration: `boxdyn` 5,900,191 ns/iter (±95,169) vs. `enum_dispatch` 479,630 ns/iter (±3,531), ~12x; single-call-site variant `boxdyn` 2,131,736 ns/iter (±24,937) vs. `enum_dispatch` 471,740 ns/iter (±1,439), ~4.5x (retrieved 2026-09-03).

### R19. Flatten nested owned collections (`Vec<Vec<T>>`) into one backing buffer plus offsets or a fixed stride.
**Why:** each inner `Vec` is a separate heap allocation at an unrelated address, so walking the outer `Vec` chases a pointer to a new, likely-cold cache line on every step. A flat buffer keeps everything the loop will touch in one contiguous region a prefetcher can follow.
**Applies to us:** a per-glyph MSDF/bitmap tile stored as `Vec<Vec<Pixel>>` (a `Vec` per row) is the textbook version of this anti-pattern — store one `Vec<Pixel>` plus `width`/`height`/`stride` instead.
**Bad / Good:**
```rust
// Bad: one heap allocation per row, rows scattered across the heap.
struct Tile { rows: Vec<Vec<Pixel>> }
```
```rust
// Good: one allocation; row y is &pixels[y*stride .. y*stride+width].
struct Tile { pixels: Vec<Pixel>, width: usize, height: usize, stride: usize }
```
Measured on a 4x4 matrix: nested `Vec<Vec<f32>>` up to 12 cache misses, flat `Vec<f32>` + dims up to 4, fixed `[[f32; 4]; 4]` up to 2.
**Source:** kvark, "Rust Optimization" gist, https://gist.github.com/kvark/f067ba974446f7c5ce5bd544fe370186 (retrieved 2026-09-03).

### R20. Keep hot-loop data structures to at most one pointer indirection between the loop and the value it touches.
**Why:** this generalizes R19 — every extra `Box`/`Rc`/`&` hop the loop follows is a potential cache miss paid on every iteration, not once. `Vec<T>` gives zero hops; `Vec<Box<T>>` gives one; `Vec<Box<dyn Trait>>` or `Vec<Rc<RefCell<T>>>` give one hop plus extra bookkeeping reads (vtable, refcount, borrow flag).
**Applies to us:** per-glyph loops in shaper touching thousands of glyphs, and per-pixel loops in mtsdf touching potentially millions of samples per tile, are exactly where this compounds — audit for any `Box`/`Rc`/`&dyn` sitting between the loop and the payload.
**Bad / Good:** see R19.
**Source:** kvark, "Rust Optimization" gist ("a good rule of thumb is to never have more than one layer of pointers to dereference before you reach your value"), https://gist.github.com/kvark/f067ba974446f7c5ce5bd544fe370186 (retrieved 2026-09-03).

### R21. For graph- or tree-shaped data built and consumed within a single pass, use a single-type arena (a `TypedArena`-style bump allocator) instead of `Box`/`Rc` per node.
**Why:** a typed arena gives every node the same lifetime, which legalizes cycles and back-references without `Rc`/`RefCell`, and allocation is a pointer bump instead of a general-purpose allocator call per node. The whole arena — every node in it — is freed in one deallocation when the pass ends.
**Applies to us:** font-baker's composite-glyph/contour trees, built once per bake and then walked and discarded, fit this exactly. It is also how rustc represents its own type graph internally.
**Bad / Good:**
```rust
// Bad: one heap allocation and one refcount per contour node.
struct Contour { children: Vec<Rc<Contour>> }
```
```rust
// Good: one arena allocation batch for the whole tree, freed together.
struct Contour<'a> { children: Vec<&'a Contour<'a>> }
let arena = typed_arena::Arena::new();
let root = arena.alloc(Contour { children: vec![] });
```
**Source:** `rustc_arena::TypedArena`, https://doc.rust-lang.org/nightly-rustc/rustc_arena/struct.TypedArena.html. `typed-arena`, https://github.com/thomcc/rust-typed-arena. manishearth, "Arenas in Rust", https://manishearth.github.io/blog/2021/03/15/arenas-in-rust/, 2021-03-15.

### R22. When the data can legally be reordered, sort or bucket it by the branch predicate before a hot loop containing a data-dependent branch.
**Why:** a branch predictor learns short, repeating patterns. Data in random order relative to the predicate pushes it toward a coin flip (worst case ~50% mispredict rate); sorted data gives it one transition to learn per pass, collapsing mispredictions toward zero.
**Applies to us:** bidi run classification and line-break opportunity scanning walk text character-by-character with per-character class branches. Where a pipeline stage can tolerate a reordering pass first (e.g. bucketing clusters by script/direction before positioning), this turns an unpredictable branch into a predictable one.
**Bad / Good:** n/a beyond the technique (bucket/sort before the loop, not inside it).
**Source:** reported (not independently re-measured here) at roughly 4.5x for a sorted-vs-shuffled filter, in *Rust High Performance* (O'Reilly), "Branch prediction" chapter, https://www.oreilly.com/library/view/rust-high-performance/9781788399487/ab6e9a00-a970-4ef1-ba63-5380955abb86.xhtml — cited secondhand; verify the multiplier on your own data before relying on the exact number. The mechanism itself (sorted data collapses branch-predictor misses) is well established independent of this figure.

### R23. When the data can't be reordered but profiling shows a branch is genuinely unpredictable, rewrite it as arithmetic (branchless) instead of `if`.
**Why:** turning `if cond { keep(x) }` into `out[n] = x; n += cond as usize;` converts a control dependency (which the CPU must predict or stall on) into a data dependency (executed unconditionally). This only pays off when the misprediction cost it removes exceeds the cost of unconditionally doing the work.
**Applies to us:** mtsdf's per-pixel inside/outside admission test over a large, effectively-random distance field is a strong candidate — high branch entropy, cheap per-pixel work, large N.
**Bad / Good:**
```rust
// Bad: cost dominated by misprediction at ~50% selectivity.
fn filter(input: &[f64], t: f64) -> Vec<f64> {
    input.iter().copied().filter(|&x| x > t).collect()
}
```
```rust
// Good: the comparison result is used as a number, not a decision.
fn filter_branchless(input: &[f64], t: f64) -> Vec<f64> {
    let mut out = vec![0.0; input.len()];
    let mut n = 0;
    for &x in input { out[n] = x; n += (x > t) as usize; }
    out.truncate(n);
    out
}
```
Measured: 3.94ms → 1.03ms (~3.8x) at 50% selectivity, the branch predictor's worst case.
**Source:** Serhii Potapov, "Branchless Rust: Making a Filter 4x Faster by Removing an if", https://www.greyblake.com/blog/branchless-rust/ (retrieved 2026-09-03).

### R24. Batch heterogeneous records by variant/type before a hot loop, instead of branching or matching per record inside it.
**Why:** this is the batching analogue of R22/R23 — grouping first turns N unpredictable per-record branches into one predictable branch per batch, and lets each batch's inner loop run branch-free (and often auto-vectorizable), at the cost of one grouping/sort pass.
**Applies to us:** shaper applies different positioning rules per feature/lookup type per cluster. Grouping clusters by which rule applies before the tight positioning loop, rather than matching per cluster inside it, turns a per-cluster branch into a per-batch one.
**Bad / Good:**
```rust
// Bad: branches inside the hot loop, once per cluster.
for c in clusters { match c.rule { Rule::A => apply_a(c), Rule::B => apply_b(c) } }
```
```rust
// Good: partition once, then two branch-free inner loops.
let (a, b): (Vec<_>, Vec<_>) = clusters.iter().partition(|c| c.rule == Rule::A);
for c in &a { apply_a(c) }
for c in &b { apply_b(c) }
```
**Source:** mechanism generalized from R18 (enum/jump-table dispatch beats a per-call branch) and R22 (sorted data is predictable data); general technique, no single primary citation beyond those.

### R25. Use a bump arena (`bumpalo`) for a batch of allocations that share a lifetime and are all freed together — it works in `no_std` + `alloc`.
**Why:** a bump allocator hands out memory by incrementing a pointer, with no per-allocation bookkeeping and no free-list search. `bumpalo` is documented as "a `no_std` crate that depends only on the `alloc` and `core` crates," so it fits a `no_std` crate without pulling in `std`.
**Applies to us:** shaper/font-baker build short-lived per-call scratch structures — temporary cluster arrays, kerning-pair lookup tables — that are all discarded together at the end of a shape/bake call. A natural `bumpalo::Bump` per call, reset or dropped on return.
**Bad / Good:**
```rust
// Bad: N small heap allocations, N individual frees, in a no_std+alloc crate.
let mut scratch: Vec<Box<[GlyphId]>> = Vec::new();
for cluster in clusters { scratch.push(build_ids(cluster).into_boxed_slice()); }
```
```rust
// Good: one arena, pointer-bump allocation, freed once at the end of the call.
let arena = bumpalo::Bump::new();
let mut scratch: Vec<&[GlyphId]> = Vec::new();
for cluster in clusters { scratch.push(arena.alloc_slice_copy(&build_ids(cluster))); }
```
**Source:** `bumpalo`, https://github.com/fitzgen/bumpalo and https://docs.rs/bumpalo ("A fast bump allocation arena for Rust... a `no_std` crate that depends only on the `alloc` and `core` crates"; retrieved 2026-09-03).

### R26. Don't put data with independent lifetimes or per-object frees into a bump arena.
**Why:** a bump allocator can only free everything at once, when the arena itself drops or is reset — it has no mechanism to reclaim one object's space early. Putting long-lived, individually-evicted data in one turns every eviction into a leak until the whole arena goes away.
**Applies to us:** the persistent rasterized-glyph cache/atlas in baker/admission (R8's generational slots) must not live in a bump arena — glyphs are evicted independently of each other, which is exactly what a bump arena cannot do.
**Bad / Good:** n/a — the failure mode is architectural (lifetime shape), not a local snippet.
**Source:** `bumpalo` docs.rs: "optimizes for the common case of allocating many objects that share the same lifetime and can be deallocated together as a group, trading the ability to deallocate individual objects for significantly faster allocation performance", https://docs.rs/bumpalo (retrieved 2026-09-03).

### R27. Prefer iterator adapters (`iter()`, `zip`, `enumerate`, `.copied()`) to manual `for i in 0..len { a[i] }` indexing in hot loops.
**Why:** an iterator over a slice can only ever yield in-bounds elements, so LLVM can often prove no bounds check is needed inside the loop body at all; a manual index re-proves (or re-checks) boundedness at every access. `.copied()` matters too: iterating `&T` for a `Copy` type keeps a reference indirection in the loop's IR that iterating owned values removes — sometimes the difference between LLVM vectorizing the loop and not.
**Applies to us:** shaper's per-glyph/per-cluster loops and mtsdf's per-pixel loops are high-iteration-count hot paths where a bounds check per element is a real, measurable tax — this should be the default posture, not a special-case optimization.
**Bad / Good:**
```rust
// Bad: bounds-checked on every access; a and b stay behind references.
for i in 0..a.len() { out[i] = a[i] + b[i]; }
```
```rust
// Good: iterator adapters carry their own boundedness proof; .copied() hands
// LLVM plain f32 values instead of &f32.
for (o, (x, y)) in out.iter_mut().zip(a.iter().copied().zip(b.iter().copied())) {
    *o = x + y;
}
```
**Source:** The Rust Performance Book, "Bounds Checks", https://nnethercote.github.io/perf-book/bounds-checks.html (retrieved 2026-09-03).

### R28. Use `chunks_exact`/`chunks_exact_mut` instead of `chunks`/manual striding when the stride is a compile-time constant.
**Why:** because every chunk from `chunks_exact` is guaranteed exactly the requested length, LLVM's scalar-evolution analysis can eliminate bounds checks inside the chunk body that it can't eliminate for `chunks` (whose last chunk may be shorter). This unlocks auto-vectorization a residual per-element check blocks.
**Applies to us:** mtsdf pixel access with a fixed channel count (RGBA, or MSDF's 3-4 channels) is exactly the fixed-stride case `chunks_exact` targets.
**Bad / Good:**
```rust
// Bad: variable-length last chunk keeps a bounds check LLVM can't remove.
for px in pixels.chunks(4) { blend(px); }
```
```rust
// Good: fixed-size chunks; the compiler knows px.len() == 4 statically.
for px in pixels.chunks_exact(4) { blend(px); }
```
Measured on a related pattern (explicit `#[repr(C)]`/`#[repr(transparent)]` sample types plus `chunks_exact_mut(2).zip(...)`): 77.67us → 25.535us (~3x), matching hand-written SIMD intrinsics on both x86-64 and ARM without target-specific code.
**Source:** rust-lang/rust PR #75936, "Get rid of bounds check in slice::chunks_exact()"; PR #86988, "Carefully remove bounds checks from some chunk iterator functions" (retrieved 2026-09-03). Nick Wilcox, "Taking Advantage of Auto-Vectorization in Rust", https://www.nickwilcox.com/blog/autovec/ (retrieved 2026-09-03).

### R29. Give LLVM one length fact to work from — a single `assert!`/pre-slice before the loop — rather than relying on it to re-derive the same bound at every access inside the loop.
**Why:** bounds-check elision works when LLVM can prove an index is in range from facts already established in the same function. An assertion or a pre-slice before the loop establishes that fact once, in a form the optimizer can propagate; leaving it to infer the same thing repeatedly doesn't always work — the Performance Book itself calls getting this to work "tricky."
**Applies to us:** general hot-loop hygiene for shaper/mtsdf — when a loop body indexes multiple slices by the same index variable, slice all of them to a known-equal length before the loop rather than indexing the originals.
**Bad / Good:**
```rust
// Bad: index variable's range isn't visibly tied to either slice's length.
fn add(a: &[f32], b: &[f32], out: &mut [f32], n: usize) {
    for i in 0..n { out[i] = a[i] + b[i]; }
}
```
```rust
// Good: pre-slicing to a known length gives LLVM one fact to reuse.
fn add(a: &[f32], b: &[f32], out: &mut [f32], n: usize) {
    let (a, b, out) = (&a[..n], &b[..n], &mut out[..n]);
    for i in 0..n { out[i] = a[i] + b[i]; }
}
```
**Source:** The Rust Performance Book, "Bounds Checks" ("make a slice of the `Vec` before the loop..."; "Add assertions on the ranges of index variables... getting these to work can be tricky"), https://nnethercote.github.io/perf-book/bounds-checks.html (retrieved 2026-09-03).

### R30. Reach for `get_unchecked`/`get_unchecked_mut` only behind a `debug_assert!` of the bound it skips, and only after profiling has named a residual bounds check as hot and R27-R29 have failed to remove it.
**Why:** `get_unchecked` is unsafe precisely because it removes the one check standing between a bad index and undefined behavior. A `debug_assert!` restores that check in every test/debug run at zero release cost — which is where the speed is actually needed.
**Applies to us:** last resort in shaper/mtsdf's hottest per-glyph/per-pixel loops, after safe restructuring has been tried and a profile still shows the check.
**Bad / Good:**
```rust
// Bad: unsafe with no local evidence of why it's sound.
unsafe { *out.get_unchecked_mut(i) = *a.get_unchecked(i) + *b.get_unchecked(i) }
```
```rust
// Good: the safety argument is checked in every debug/test run.
debug_assert!(i < out.len() && i < a.len() && i < b.len());
unsafe { *out.get_unchecked_mut(i) = *a.get_unchecked(i) + *b.get_unchecked(i) }
```
**Source:** The Rust Performance Book, "Bounds Checks" (documents `get_unchecked`/`get_unchecked_mut` as the unsafe last resort), https://nnethercote.github.io/perf-book/bounds-checks.html (retrieved 2026-09-03).

### R31. Benchmark with `criterion` for wall-clock A/B comparisons, and wrap every benchmark input *and* output in `std::hint::black_box` — boxing only the output still lets the compiler constant-fold the input computation away.
**Why:** `black_box` blocks dead-code elimination, constant folding, and loop-invariant code motion for the value passed through it, but only for that value. Boxing the result of `a + b` doesn't stop LLVM from computing `a + b` at compile time if `a` and `b` are themselves visible constants, because the addition was never forced to happen at runtime.
**Applies to us:** every shaper/mtsdf microbenchmark written to justify a DOD change should be reviewed for this. A benchmark reporting an implausibly fast result (sub-nanosecond) is almost always this bug, not a real win.
**Bad / Good:**
```rust
// Bad: only the output is boxed; the compiler precomputes a + b before the loop.
for _ in 0..1024 { black_box(a + b); }
```
```rust
// Good: inputs are boxed too, forcing the addition to happen every iteration.
for _ in 0..1024 { black_box(black_box(a) + black_box(b)); }
```
A GF(2^8) multiplication benchmark reported "less than 1 nanosecond" per iteration with output-only `black_box` — a meaningless number, fixed once inputs were also boxed.
**Source:** Guillaume Endignoux, "Why my Rust benchmarks were wrong, or how to correctly use std::hint::black_box?", https://gendignoux.com/blog/2022/01/31/rust-benchmarks.html, 2022-01-31. `criterion`, https://docs.rs/criterion (retrieved 2026-09-03).

### R32. Use `iai-callgrind` (Valgrind's Callgrind/Cachegrind under the hood) for regression gating when wall-clock noise would hide a real change — it counts instructions and cache events deterministically instead of timing.
**Why:** `criterion` measures wall-clock time, which is sensitive to whatever else is running on the machine — especially true on shared or virtualized CI runners. `iai-callgrind` runs the benchmark once under Valgrind instrumentation and reports exact instruction/cache-access counts, which are the same on every run regardless of system noise.
**Applies to us:** shaper/mtsdf hot-loop changes benchmarked in CI need this property. A 2% wall-clock "regression" reported by criterion on a shared runner is often noise; an instruction-count regression from iai-callgrind is not.
**Bad / Good:** n/a beyond tool choice — both are used the same way, as a `#[bench]`-style attribute macro.
**Source:** `iai-callgrind`, https://github.com/iai-callgrind/iai-callgrind and https://docs.rs/iai-callgrind ("uses Valgrind's Callgrind and other Valgrind tools like DHAT, Massif, and Cachegrind"; "consistent measurements even in virtualized CI environments"; retrieved 2026-09-03).

### R33. Build wasm test/profiling binaries with debug info so browser profilers show Rust symbol names instead of `wasm-function[N]`.
**Why:** a browser's profiler reads the wasm module's `name` custom section to label call frames. Without debug info that section is absent (or stripped by a size-optimized build), and every frame in a flame chart reads as an opaque numbered function — making it impossible to tell which Rust function is hot.
**Applies to us:** directly applicable given wasm32-unknown-unknown is the primary target. Any DOD change validated by reading a Chrome DevTools flame chart needs a debug-info build, kept separate from the size-optimized build actually shipped.
**Bad / Good:** n/a beyond build configuration — keep debug symbols in the profiling build, strip them from the shipped artifact.
**Source:** "Time Profiling", Rust and WebAssembly book, https://rustwasm.github.io/book/reference/time-profiling.html (retrieved 2026-09-03).

### R34. Validate a wasm-targeted DOD change on native `cachegrind`/`criterion` first, then confirm the win survives the trip to wasm using `performance.now()`/DevTools — there is no hardware-performance-counter path available to code running inside a browser tab.
**Why:** hardware performance counters need OS- and often kernel-level access the browser sandbox deliberately withholds from page or wasm code, partly as a timing-side-channel mitigation. The only timing primitive exposed to web content is `performance.now()` (a monotonic millisecond clock), plus whatever sampling profiler the browser's own devtools provide from outside the sandbox.
**Applies to us:** this is the central verification constraint for glyph, whose primary target is wasm32-unknown-unknown. Cache-miss-level claims about a shaper/mtsdf change can only be measured natively (cachegrind) or on an equivalent native build; inside the browser, only wall-clock-level confirmation is possible.
**Bad / Good:** n/a beyond methodology — "measure the mechanism natively, confirm the outcome in-browser" is the checkable two-step practice.
**Source:** "Time Profiling", Rust and WebAssembly book, https://rustwasm.github.io/book/reference/time-profiling.html (`performance.now()`, DevTools flame graphs; retrieved 2026-09-03) — general WebAssembly-in-browser profiling constraint (no direct hardware-counter access from browser-hosted wasm), corroborated across independent 2026 WebAssembly-profiling write-ups; no single canonical spec citation found for the absence itself, treat as consistently-reported rather than formally specified.

### R35. Profile before restructuring; don't apply a DOD transform to code that isn't both hot and data-bound.
**Why:** DOD's wins come from reducing bytes moved per useful unit of work, in a loop that runs enough times for that to matter. On a cold path, or a path where each item does substantial computation (compute-bound, not data-bound), the same transform adds indirection and bookkeeping for a saving nothing ever collects.
**Applies to us:** the project states DOD as a deliberate goal, which is exactly the condition under which it gets over-applied to code that was never the bottleneck — one-time font-load parsing, plan-serialization glue. Require a profile, not the project's general philosophy, to justify each individual transform.
**Bad / Good:** n/a — the requirement is procedural (a profile attached to the change), not a code shape.
**Source:** Guillaume Endignoux, "Optimization adventures: making a parallel Rust workload even faster with data-oriented design", https://gendignoux.com/blog/2024/12/02/rust-data-oriented-design.html, 2024-12-02 — reports a Rust allocator swap that "made no noticeable difference" on allocation patterns that were already simple.

### R36. Track total wall-clock or instruction count as the acceptance metric, not a single proxy metric like cache-miss count — a change can improve the proxy and regress the total.
**Why:** a metric like L1/L3 miss count is a means, not the end. Code added to reduce misses (e.g. bit-unpacking logic inside the hot loop) has its own instruction cost, and if that cost exceeds the cycles saved by fewer misses, total time goes up even though the cache-miss dashboard number goes down.
**Applies to us:** general discipline for any shaper/mtsdf optimization PR — report the benchmark's wall-clock/instruction delta, not just "cache misses reduced by X%."
**Bad / Good:** n/a — the requirement is what number gates the PR, not a code shape.
**Source:** Guillaume Endignoux, https://gendignoux.com/blog/2024/12/02/rust-data-oriented-design.html, 2024-12-02 — a bit-packing change that cut data-cache misses nonetheless "ran at least 30% slower"; the author's own conclusion: "shows the limits of data-oriented design: by over-optimizing for one metric (data cache misses), you risk that other metrics get worse."

### R37. Before accepting a trade-off between DOD and "make illegal states unrepresentable," look for a flatter representation that is also stricter — a SoA/array refactor can delete a previously-representable invalid state instead of merely relocating the problem.
**Why:** an AoS enum can nest illegally (`SpaceAfter(SpaceAfter(x))` — structurally valid, semantically nonsense). Splitting the same data into parallel arrays with one discriminant per position can make that nesting inexpressible, because there is no longer a `Def` value for `SpaceAfter` to nest inside — the two goals align instead of trading off.
**Applies to us:** shaper's plan encoding is parser/compiler-shaped data (a sequence of positioned, typed records) — the same shape as the case study this rule is drawn from. When flattening a cluster-state enum to parallel arrays, check whether a currently-representable-but-invalid combination becomes structurally impossible in the new shape, before assuming safety was traded away for speed.
**Bad / Good:**
```rust
// Before: AoS enum can represent an illegal double-wrap.
enum Def { Type(TypeDef), Value(ValueDef), SpaceAfter(Box<Def>, Comments) }
// SpaceAfter(SpaceAfter(x, c1), c2) type-checks but should never occur.
```
```rust
// After: SoA split by concern; there is no Def value left to nest inside
// SpaceAfter, so the illegal case has no representation — not just no
// constructor that happens to produce it.
struct Defs { defs: Vec<Def>, space_after: Vec<Option<Comments>> }
enum Def { Type(TypeDef), Value(ValueDef) }
```
Measured on this exact refactor: 1.12x faster (±0.09) than the original AoS enum, 1.69x faster (±0.15) than a `Box<Def>` alternative, ~12% less memory — the illegal state eliminated as a side effect, not the goal.
**Source:** Tweede golf, "Optimizing a parser/compiler with data-oriented design: a case study", https://tweedegolf.nl/en/blog/88/data-oriented-design (retrieved 2026-09-03) — includes the explicit caveat: "DoD is not always worth it, it can create a bit of a mess of arrays and indices, and there is no safety around lifetimes and mutability. But it is an amazing tool to have in the toolbox."

### R38. When a domain invariant genuinely can't be expressed by the flat/indexed representation, keep a validating newtype constructor at the module boundary and use raw indices/arrays only inside the hot loop — not throughout the public API.
**Why:** a smart constructor (`fn new(...) -> Result<Self, E>`, reachable only through module privacy) is a one-time, boundary-crossing cost. Once a value exists, code inside the module can operate on its raw representation (indices, unpacked arrays) without re-paying validation per element, because the module's own code is the only thing that could have produced an invalid instance — and it doesn't.
**Applies to us:** general shape for any glyph API where the public surface must reject bad input (e.g. an out-of-range glyph or cluster index from a caller) but the internal hot loop over already-validated data shouldn't carry that check per iteration — validate once on the way in, trust the representation once inside.
**Bad / Good:**
```rust
// Bad: validity re-checked on every access, even deep inside a hot loop
// operating on data this module already validated on the way in.
pub fn advance(idx: usize, clusters: &[Cluster]) -> Option<f32> {
    clusters.get(idx).map(|c| c.x_advance)
}
```
```rust
// Good: validated once at construction; internal hot code trusts the type.
pub struct ClusterIndex(u32); // only built by `Clusters::validate`
impl Clusters {
    pub fn validate(&self, i: u32) -> Option<ClusterIndex> {
        if (i as usize) < self.data.len() { Some(ClusterIndex(i)) } else { None }
    }
    fn advance(&self, idx: ClusterIndex) -> f32 {
        self.data[idx.0 as usize].x_advance // no re-check; idx is proof
    }
}
```
**Source:** corrode Rust Consulting, "Make Illegal States Unrepresentable", https://corrode.dev/blog/illegal-state/ (retrieved 2026-09-03) — newtype + module-encapsulated constructor pattern.
