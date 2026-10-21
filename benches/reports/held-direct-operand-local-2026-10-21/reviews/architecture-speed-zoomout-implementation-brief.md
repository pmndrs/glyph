# Canonical row stream feasibility and the next bounded wave

21 October 2026. Read-only source brief; no product edits, benchmarks or profile captures. This refines [the independent architecture diagnosis](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/architecture-speed-zoomout-sol-high.md) without changing it. Source references are to the frozen isolated checkout HEAD `277417596afbe2a8cd87454317d05607dc9ba51b` plus the ten corrected E5 Rust modifications; that dirty source matches the preserved `be6c7960dd7eda8917bc43422edadca1970c1278` snapshot. The same shipped E5 archive is `83949860ae65b99fe6d7471b9782398234852668b54412870fafa81878c366a3`.

## Decision first

**Do not assign a literal single-pass owner-to-output stream as the next implementation.** The current ordered compiler requires indexed, stable `PlanGlyph` and change-mask metadata across several passes and batch reordering. A borrowed forward-only iterator would need to materialize that metadata or duplicate the compiler. It also cannot remove the selected-record to source-coordinate mapping without replacing it with a rank/select index, a repeated scan, or a new per-row map. No existing source evidence shows a net deletion of both E5's 20-byte locators and its candidate workspace while retaining cold/late-error and renderer rollback semantics. The strong Option 3 from the first report is therefore a research hypothesis, not a coherent ready-to-code wave.

**One concrete compatible next wave is a bounded E5 row-view repair:** construct the existing positioned semantic slice arrays once per record or four-lane group, lazily at the first active codec load, and reuse them for later operations. This removes repeated array/view construction while keeping the one codec interpreter, packed SIMD path, existing source lookup, program order, candidate workspace and fallback. It is a falsification experiment for a possible partial gain, not a parity claim. Start this experiment from preserved corrected **E5 `be6c7960…`**, in an isolated checkout or equivalent snapshot. E5 already contains committed **E4/HEAD `27741759…`** input-plan reductions, so they are preserved automatically. Keep E4/HEAD as the immediate whole-source fallback and E2 `a829b86…`/archive `28fd0413…` as the measured latency control and independent fallback. Do not reset the shared held checkout to make the experiment. E4 versus E2's own eight-block matrix classified 1 faster, 2 slower, 142 neutral (dense 512/1,024 neutral); retaining its small source-read deletion is a combination choice, not an elapsed-speed claim. [E4 comparison](/Volumes/Depot/Developer/glyph/.cache/held-gather-input-plan-20261020/evidence/matrix-prior-e2-data/summary.md).

## Why a stream cannot simply feed the current compiler

The producer walk is `state.rs::build_direct_candidate` (`3089–3195`) through `CodecGatherWorkspace::append_direct_from/append_from_internal` (`codec_gather.rs:1651–1914`). It walks source glyphs in active paragraph order. Selection calls `FontRenderBinding::select`; recordless glyphs still append `GatherSource` but emit no `PlanGlyph`. A selected row resolves technique/program, optionally gathers fields, resolves resource/placement in `plan_glyph`, then appends `PlanGlyph`, placement slot, change mask and (E5 only) `DirectRowLocator`. A previous `GatherSource` rope and old `PlanGlyph` record certify identity/selection/topology. `direct_candidate_admissible` (`state.rs:2960–3036`) first checks all owners, ranges, declared semantic/binding source totality and dense whole-owner eligibility; a miss returns to the packed path. These walks are distinct today.

`RenderPlanCompiler::prepare_owned_with_source` passes a borrowed `PlanInput` plus optional `DirectOperandSource` to the same `OrderedPlanCompiler` (`render_plan_compiler.rs:250–305`; `ordered_plan.rs:255–276,522–599`). `PlanInput` is indexed arrays of glyphs, placement slots, masks and fields (`plan_input.rs:33–50`). `prepare_complete_topology` scans indexed glyphs to resolve programs, resource masks and batch keys and builds `input_batches/input_slots`; `layout_pending_instances` uses destination-sorted `(physical slot,input index)` pairs (`ordered_plan.rs:917–1108,1340–1443`). The retained topology path compares indexed old and new instances (`1199–1296`). `prepare_batch/write_changed_ranges` revisits input indices in physical batch/range order, derives active buffers, copies clean prior bytes, executes codec runs, compares physical bytes and emits patches (`1445–1935`). `compile_bindings/compile_draw_spans` consumes the same metadata again (`1953–2444`). Batch order need not equal source order. The indexed metadata snapshot is functional input, not just a staging accident; deleting it would require reworking several compiler passes and their error/transaction order.

E5 `DirectRowLocator` stores paragraph index, source glyph index, binding index, selected strike/resource key and strike row (20 bytes, `codec_gather.rs:603–617`). The ordered compiler calls codec in physical-run order; `plan_packing::execute_run_with_source` feeds `codec::execute_direct_buffers`, and `CodecInputs::Direct` resolves any indexed input record through that locator (`plan_packing.rs:125–245`, `codec.rs:402–440,988–1000,1096–1245,1339–1445`, `state.rs:641–730`). Recordless glyphs mean emitted record ordinal is not source ordinal. `GatherSource` has `RopeSummary.fragments` and prefix counts, but no existing constant-time selected-record-to-source map. Replacing locators with rope rank/select and owner-prefix lookup would create a random-access operation per record or group, re-resolve binding/selection, and require a new index or O(log S) tree walk. It might save 184,320 locator bytes for the exact Bitmap 9,216-selected-row witness, but the current source provides no speed or error-order proof for the added traversal. Storing only glyph indices plus owner boundaries is still a coordinate map and has to handle batch reorder and recordless rows. It is not a genuine zero-metadata stream.

The second candidate workspace also has a concrete lifetime job. `state.rs::prepare_update_inner` borrows the prior `gather` as the accepted comparison baseline while `direct_candidate` builds new metadata; only `commit_update` swaps the candidate into `gather` after ordered/session preflight and result encoding (`state.rs:2052–2240,2300–2550`; `render_plan_compiler.rs:300–365`; `ordered_plan.rs:649–860`). A failed candidate may fall back to packed gather. A mutation that later fails invalidates the derived root, while renderer rejection after Rust commit retains prepared semantic state and requests a checkpoint. In-place replacement would have to retain old `GatherSource` and `PlanGlyph` rows while appending new ones, preserve their provenance through late misses, and repair exact cache mode on abort. That is still overlapping old/new metadata, whether stored in a second workspace, a larger vector tail or a cloned rope. It is possible to redesign this transaction, but E5's +1,377,716 requested-live bytes alone does not prove such a redesign saves peak memory or latency. It would be a separate algorithm and lifetime proof, not a free consequence of a row iterator.

## Error and operation-order constraints

Packed `codec_gather.rs::append_from_internal` resolves binding, selection and program, then calls `gather_fields` **before** `plan_glyph` for each selected row (`1740–1895,2051–2114`). `gather_fields` reads declared fields in f32 then u32 order, including the program's unused declarations, and may report `SourceFieldMissing` before a later resource/placement failure. E5 direct construction reaches `plan_glyph` before codec operands are read. Its conservative `direct_semantic_sources_total/direct_binding_sources_total` (`418–525`) and owner admission prevent a missing declared source from changing an old packed success/error into a late direct error; metadata-only fallback also has a totality guard (`state.rs:2120–2136`). Codec `execute_program` validates output shape, then executes only operations whose reverse dependency mask reaches active buffers. Scalar and SIMD paths preserve operation order; SIMD groups four records and reads lanes in order (`codec.rs:1096–1245,1339–1445`). A proposed stream must not eagerly fetch every declared operand or turn a late source failure into an early one. It must preserve selection/recordless/strike behavior, zero masks, active-buffer masks and real error precedence. If a new resolver requires wider pre-reading or a parallel interpreter, stop.

## Implementable bounded repair: call-scoped semantic view

Own the edit in `state.rs::{DirectRowContext,DirectOperandSource}` and `codec.rs::{execute_scalar_records,execute_simd_records}`. Keep `codec_gather.rs::{source_f32,source_u32}` as the single semantic/binding derivation authority, `plan_packing::execute_run_with_source` as the bridge, and ordered/session compiler unchanged. The current `DirectRowContext::f32/u32` calls `positioned.semantic_f32()` and `.semantic_u32()` for **every active load**, rebuilding arrays of 9 f32 and 8 u32 slice references and a `LayoutPlanInput` (`state.rs:681–730`; `positioning.rs:36–39,1674–1680`). Native Bitmap counts are 138,240 f32 and 36,864 u32 loads per direction. The deletion is specific: array construction moves from each of those 175,104 load calls to at most one per selected record, and only for records with an active load. The source reads and output bytes remain.

Call-scoped shape, illustrative rather than a second implementation:

```rust
// In state.rs. Borrows prepared positioning, binding and selection; no allocation.
struct DirectRowView<'a> {
    row: DirectRowContext<'a>,
    f32: [&'a [f32]; SEMANTIC_F32_FIELD_COUNT],
    u32: [&'a [u32]; SEMANTIC_U32_FIELD_COUNT],
}
impl<'a> DirectRowContext<'a> {
    fn view(self) -> DirectRowView<'a> {
        DirectRowView {
            f32: self.positioned.semantic_f32(),
            u32: self.positioned.semantic_u32(),
            row: self,
        }
    }
}
impl DirectRowView<'_> {
    fn f32(&self, source: InputSource) -> Result<u32, GatherError> {
        let input = self.row.input(&self.f32, &self.u32);
        source_f32(source.scope, source.field, input,
                   self.row.glyph_index, self.row.binding, self.row.selected)
            .map(f32::to_bits)
    }
    // u32 uses the same input and existing source_u32.
}
// In the existing scalar interpreter, within each record, keep its current
// direct_row: Option<DirectRowContext> setup and packed match branch.
let mut view = None;
for active_operation in program_order {
    match active_operation {
        LoadF32 { field, .. } => {
            let row = direct_row.ok_or(CodecExecutionError::InputLength)?;
            let v = view.get_or_insert_with(|| row.view());
            load = v.f32(program.inputs[field])?;
        }
        LoadU32 { field, .. } => { /* same lazy view and source_u32 */ }
        other => { /* unchanged interpreter branch */ }
    }
}
// SIMD: lazily build the four views at the first active Load in the group;
// keep the current lane 0..3 read order and packed v128_load path.
```

The Rust lifetime must be expressed without a self-referential `LayoutPlanInput` stored inside `DirectRowView`: the view owns slice-reference arrays and makes a short borrowed `LayoutPlanInput` inside each load. This still constructs that small descriptor per load, but removes the 17 slice-array extractions. Construct views lazily so no active load means no new setup; this also keeps all `source_f32/u32` calls and their error order. `DirectRowContext::row()` stays once per scalar record/four per SIMD group as it is now. No new persistent metadata, public API/ABI, data layout, cache or executor is needed. Keep all direct eligibility and fallback gates unchanged in this wave; fusing the owner preflight with construction would add a second independent error-order/late-miss question and obscure attribution.

Let `P` be selected records, `L` active codec loads, `F=17` positioned slice references, `S` source glyphs and `B` compared/emitted physical bytes. Current E5 performs O(L·F) slice-reference setup plus O(L) source reads, O(S) candidate selection, O(P) locator storage and O(B) physical compare/write. The repair targets O(P_loaded·F) setup, with `P_loaded≤P`, while retaining O(L+S+B), locators and the candidate workspace. It does **not** eliminate the observed 184,320 locator bytes, 589,824 comparison bytes, 368,640 emitted bytes, or semantic setter preparation. The profile's direct getters have 103.546 ms total self samples over 80 callbacks, roughly 1.29 ms per callback as a diagnostic upper context, not a removable elapsed bound. E5 is ~1.84 ms slower than E2 and ~4.96 ms slower than main on dense 1,024 pooled p50, so this repair has no credible parity promise by itself.

## Falsifiable gate and disposition

First prove in source/native attribution on the existing exact Bitmap replay that the same 6,157 events, 4,099 results and 1,977,392 bytes pass, active operand load counts and physical compare/emission bytes stay exact, and slice-array construction drops from per-active-load to per-loaded-record/group. Add only that focused counter if existing attribution cannot express it. Then independent cold engine semantic/layout/ID/query/split comparisons after each setter and exact cold physical/host bytes after publication must pass. Cover 0/1/2/3 SIMD tails; packed↔direct↔packed mode transitions; selected/recordless, strike/resource/zero-mask, missing declared and unused fields, decorations, count-changing topology; active-buffer and custom codec operations; allocation/overflow, abort, failed result encode, renderer rejection/checkpoint and borrowed lease expiry. Native source tests do not prove shipping Wasm SIMD utilization, so authenticate named/shipping artifacts and real Wasm bytes. Use one frozen package to run the complete seven-family main/release/E2 matrix with pooled absolute p50/p95 and original Labs block CIs, exclusions and calibration warnings; separately review raw/gzip size, scoped live/peak and whole-app memory, ABI/peers, browser/hero and lifetime. A measured partial gain may be retained as a whole correct variant without a percentage floor. If it has no supported complete-operation gain against E2 or adverse memory/size/sparse costs dominate, retire the direct branch from active source and return to E4/HEAD, preserving E5 and the repair as named artifacts. E2 remains the latency comparator; E4's source-read component can stay only as its own supported combination choice.

No further architecture wave is authorized by this brief. If the call-scoped repair fails to justify E5, the exact obstacle to the strong stream remains: random-access physical compilation plus recordless source mapping and old/new transactional ownership. A subsequent design must prove a real replacement for those obligations and an actual deleted pass before implementation. If compatible source waves cannot remove the remaining dense gap, the opt-in bulk transaction from the architecture report is a **user-approved public contract change**, not a hidden optimization of existing synchronous setters.
