//! Authentication-only replay of captured shipping Wasm calls. Invoked explicitly by the named Labs workflow.

use std::{collections::BTreeMap, fs, path::Path};

use serde_json::Value;

use super::{FrameTransport, UpdateBatchTransport};
use crate::{
    STATUS_OK, ShaperRegistry,
    abi_contract::ENGINE_RESULT_BYTE_LENGTH,
    engine::{
        TextEngine,
        codec_wire::parse_codec,
        font_binding_wire::parse_font_binding,
        frame_wire::parse_update_request,
        render_plan::PATCH_WRITE,
        render_plan_wire::{publication_layout, query_layout},
        work_attribution::{self, Work},
    },
    wire::read_u32,
};

fn field<'a>(event: &'a Value, key: &str) -> &'a Value {
    event
        .get(key)
        .unwrap_or_else(|| panic!("missing {key} in event {event}"))
}

fn number(event: &Value, key: &str) -> u32 {
    u32::try_from(field(event, key).as_u64().unwrap()).unwrap()
}

fn argument(event: &Value, index: usize) -> u32 {
    u32::try_from(
        field(event, "args").as_array().unwrap()[index]
            .as_u64()
            .unwrap(),
    )
    .unwrap()
}

fn blob(directory: &Path, event: &Value, key: &str) -> Vec<u8> {
    let name = field(event, key).as_str().unwrap();
    assert!(!name.contains('/') && !name.contains(".."));
    fs::read(directory.join("blobs").join(name)).unwrap()
}

fn compare_result(sequence: u64, event: &Value, expected: &[u8], actual: &[u8]) {
    if expected == actual {
        return;
    }
    let offset = expected
        .iter()
        .zip(actual)
        .position(|(a, b)| a != b)
        .unwrap_or(expected.len().min(actual.len()));
    panic!(
        "Bitmap replay result mismatch event={sequence} kind={} offset={offset} expected_len={} actual_len={} expected_byte={:?} actual_byte={:?}",
        field(event, "kind").as_str().unwrap(),
        expected.len(),
        actual.len(),
        expected.get(offset),
        actual.get(offset)
    );
}

#[derive(Clone, Copy, Default)]
struct WireTotals {
    result_bytes: usize,
    plan_write_patches: usize,
    plan_write_bytes: usize,
    session_write_patches: usize,
    session_write_bytes: usize,
    plan_payload_bytes: usize,
    session_payload_bytes: usize,
    plan_buffers: usize,
    session_buffers: usize,
    plan_retirements: usize,
    session_retirements: usize,
}

fn add_work(total: &mut Work, next: Work) {
    macro_rules! add {
        ($($name:ident),+ $(,)?) => {$(total.$name += next.$name;)+};
    }
    add!(
        harfrust_calls,
        harfrust_utf16_units,
        shape_scratch_arena_moves,
        shape_scratch_moved_glyphs,
        shape_range_copied_glyphs,
        cluster_full_builds,
        cluster_copied_old_rows,
        cluster_full_glyph_visits,
        cluster_retained_glyph_loop_visits,
        run_local_glyph_visits,
        recomposed_flow_lines,
        flow_shape_windows,
        flow_shape_window_units,
        flow_convergence_checks,
        flow_dirty_end_blocks,
        flow_cursor_mismatches,
        flow_correction_mismatches,
        flow_metric_mismatches,
        measurement_ink_glyph_visits,
        measurement_intrinsic_cluster_visits,
        intrinsic_flow_preparations,
        intrinsic_positioning_preparations,
        copied_positioned_records,
        copied_positioned_bytes,
        newly_positioned_glyphs,
        positioned_revision_visits,
        positioned_rows,
        positioned_new_identities,
        positioned_prior_identities,
        positioned_zero_masks,
        positioned_nonzero_masks,
        positioned_full_masks,
        gather_glyph_visits,
        gather_paragraph_visits,
        gather_range_skips,
        gather_retained_gap_rows,
        gather_envelope_splices,
        gather_suffix_copy_bytes,
        rope_record_pushes,
        rope_bulk_records,
        rope_bulk_chunks,
        rope_point_queries,
        rope_iterator_starts,
        fresh_selected_rows,
        fresh_recordless_rows,
        retained_selected_rows,
        retained_recordless_rows,
        retained_stable_id_matches,
        retained_stable_id_mismatches,
        gather_f32_reads,
        gather_u32_reads,
        gather_f32_default_fills,
        gather_u32_default_fills,
        gather_f32_slots_written,
        gather_u32_slots_written,
        gather_f32_changed_slots,
        gather_u32_changed_slots,
        retained_owner_admissions,
        gather_output_source_rows,
        gather_output_selected_rows,
        prepared_positioned_source_rows,
        prepare_reuse_modes,
        prepare_retained_sparse_modes,
        prepare_retained_replacement_modes,
        prepare_fresh_modes,
        prepare_checkpoints,
        prepare_changed,
        ordered_admission_visits,
        placement_key_owner_visits,
        placement_binding_owner_visits,
        placement_binding_glyph_visits,
        publication_commit_visits,
        codec_executed_records,
        codec_successful_runs,
        codec_run_count_bin_overflow,
        codec_simd_eligible_groups,
        codec_eligible_scalar_tails,
        codec_active_f32_store_group_operations,
        clean_buffer_copy_runs,
        clean_buffer_copy_bytes,
        ordered_instance_comparisons,
        ordered_instance_rewrites,
        ordered_state_derivations,
        ordered_shape_nodes,
        ordered_repacks,
        ordered_comparison_bytes,
        ordered_equal_suppressed_bytes,
        ordered_emitted_write_bytes,
        query_serialized_records,
        query_serialized_bytes,
        gather_mask_bits,
        gather_all_masks,
        gather_identity_mismatches,
    );
    for bit in 0..16 {
        total.positioned_mask_bit_counts[bit] += next.positioned_mask_bit_counts[bit];
        total.gather_mask_bit_counts[bit] += next.gather_mask_bit_counts[bit];
    }
    for bin in next
        .codec_run_count_bins
        .into_iter()
        .filter(|bin| bin.invocations != 0)
    {
        if let Some(existing) = total
            .codec_run_count_bins
            .iter_mut()
            .find(|item| item.records == bin.records && item.invocations != 0)
        {
            existing.invocations += bin.invocations;
        } else if let Some(empty) = total
            .codec_run_count_bins
            .iter_mut()
            .find(|item| item.invocations == 0)
        {
            *empty = bin;
        } else {
            total.codec_run_count_bin_overflow += bin.invocations;
        }
    }
}

fn work_json(work: Work, count: usize, wire: WireTotals, phase: &str, kind: &str) -> Value {
    serde_json::json!({
        "phase": phase, "kind": kind, "events": count,
        "shaping": {"harfrustCalls": work.harfrust_calls, "utf16Units": work.harfrust_utf16_units,
            "scratchArenaMoves": work.shape_scratch_arena_moves,
            "scratchMovedGlyphs": work.shape_scratch_moved_glyphs,
            "rangeCopiedGlyphs": work.shape_range_copied_glyphs,
            "clusterFullBuilds": work.cluster_full_builds,
            "clusterCopiedOldRows": work.cluster_copied_old_rows,
            "clusterFullGlyphVisits": work.cluster_full_glyph_visits,
            "clusterRetainedGlyphVisits": work.cluster_retained_glyph_loop_visits,
            "runLocalGlyphVisits": work.run_local_glyph_visits,
            "recomposedFlowLines": work.recomposed_flow_lines,
            "shapeWindows": work.flow_shape_windows,
            "shapeWindowUnits": work.flow_shape_window_units,
            "convergenceChecks": work.flow_convergence_checks,
            "dirtyEndBlocks": work.flow_dirty_end_blocks,
            "cursorMismatches": work.flow_cursor_mismatches,
            "correctionMismatches": work.flow_correction_mismatches,
            "metricMismatches": work.flow_metric_mismatches,
            "measurementInkGlyphVisits": work.measurement_ink_glyph_visits,
            "measurementIntrinsicClusterVisits": work.measurement_intrinsic_cluster_visits,
            "intrinsicFlowPreparations": work.intrinsic_flow_preparations,
            "intrinsicPositioningPreparations": work.intrinsic_positioning_preparations},
        "positioning": {"rows": work.positioned_rows,
            "newIdentities": work.positioned_new_identities,
            "priorIdentities": work.positioned_prior_identities,
            "zeroMasks": work.positioned_zero_masks,
            "nonzeroMasks": work.positioned_nonzero_masks,
            "fullMasks": work.positioned_full_masks,
            "maskBitCounts": work.positioned_mask_bit_counts,
            "narrowerRevisionVisits": work.positioned_revision_visits,
            "copiedRecords": work.copied_positioned_records,
            "copiedBytes": work.copied_positioned_bytes,
            "newlyPositionedGlyphs": work.newly_positioned_glyphs},
        "preparation": {"reuse": work.prepare_reuse_modes,
            "retainedSparse": work.prepare_retained_sparse_modes,
            "retainedReplacement": work.prepare_retained_replacement_modes,
            "fresh": work.prepare_fresh_modes,
            "checkpoints": work.prepare_checkpoints,
            "preparationChanged": work.prepare_changed,
            "retainedOwnerAdmissions": work.retained_owner_admissions,
            "preparedPositionedSourceRows": if work.prepare_reuse_modes == 0 {
                Some(work.prepared_positioned_source_rows)
            } else { None },
            "positionedSourceRowsAvailableGatherEvents": work.prepare_fresh_modes
                + work.prepare_retained_sparse_modes + work.prepare_retained_replacement_modes,
            "sourceOutputRows": work.gather_output_source_rows,
            "selectedOutputRows": work.gather_output_selected_rows},
        "gather": {"visitedSourceRows": work.gather_glyph_visits,
            "paragraphVisits": work.gather_paragraph_visits,
            "retainedRangeSkips": work.gather_range_skips,
            "retainedGapRows": work.gather_retained_gap_rows,
            "envelopeSplices": work.gather_envelope_splices,
            "suffixCopyBytes": work.gather_suffix_copy_bytes,
            "ropeRecordPushes": work.rope_record_pushes,
            "ropeBulkRecords": work.rope_bulk_records,
            "ropeBulkChunks": work.rope_bulk_chunks,
            "ropePointQueries": work.rope_point_queries,
            "ropeIteratorStarts": work.rope_iterator_starts,
            "freshSelectedRows": work.fresh_selected_rows,
            "freshRecordlessRows": work.fresh_recordless_rows,
            "retainedSelectedVisits": work.retained_selected_rows,
            "retainedRecordlessVisits": work.retained_recordless_rows,
            "retainedStableIdMatches": work.retained_stable_id_matches,
            "retainedStableIdMismatches": work.retained_stable_id_mismatches,
            "f32Reads": work.gather_f32_reads, "u32Reads": work.gather_u32_reads,
            "f32DefaultFills": work.gather_f32_default_fills,
            "u32DefaultFills": work.gather_u32_default_fills,
            "f32SlotsWritten": work.gather_f32_slots_written,
            "u32SlotsWritten": work.gather_u32_slots_written,
            "f32ChangedSlots": work.gather_f32_changed_slots,
            "u32ChangedSlots": work.gather_u32_changed_slots,
            "generalRetainedMaskBits": work.gather_mask_bits,
            "generalRetainedMaskBitCounts": work.gather_mask_bit_counts,
            "generalRetainedFullMasks": work.gather_all_masks,
            "generalRetainedIdentityMismatches": work.gather_identity_mismatches},
        "codec": {"executedRecords": work.codec_executed_records,
            "successfulRuns": work.codec_successful_runs,
            "runHistogram": work.codec_run_count_bins.iter().filter(|bin| bin.invocations != 0)
                .map(|bin| serde_json::json!({"records": bin.records, "invocations": bin.invocations}))
                .collect::<Vec<_>>(),
            "runHistogramOverflow": work.codec_run_count_bin_overflow,
            "eligibleFourRowGroups": work.codec_simd_eligible_groups,
            "eligibleScalarTails": work.codec_eligible_scalar_tails,
            "activeF32StoreGroupOperations": work.codec_active_f32_store_group_operations},
        "ordered": {"admissionVisits": work.ordered_admission_visits,
            "placementKeyOwnerVisits": work.placement_key_owner_visits,
            "placementBindingOwnerVisits": work.placement_binding_owner_visits,
            "placementBindingGlyphVisits": work.placement_binding_glyph_visits,
            "publicationCommitVisits": work.publication_commit_visits,
            "stateDerivations": work.ordered_state_derivations,
            "shapeNodes": work.ordered_shape_nodes,
            "repacks": work.ordered_repacks,
            "instanceComparisons": work.ordered_instance_comparisons,
            "instanceRewrites": work.ordered_instance_rewrites,
            "cleanCopyRuns": work.clean_buffer_copy_runs,
            "cleanCopyBytes": work.clean_buffer_copy_bytes,
            "comparisonBytes": work.ordered_comparison_bytes,
            "equalSuppressedBytes": work.ordered_equal_suppressed_bytes,
            "emittedWriteBytes": work.ordered_emitted_write_bytes},
        "wire": {"encodedResultBytes": wire.result_bytes,
            "planWritePatches": wire.plan_write_patches,
            "planWriteBytes": wire.plan_write_bytes,
            "sessionWritePatches": wire.session_write_patches,
            "sessionWriteBytes": wire.session_write_bytes,
            "planPayloadBytes": wire.plan_payload_bytes,
            "sessionPayloadBytes": wire.session_payload_bytes,
            "planBuffers": wire.plan_buffers,
            "sessionBuffers": wire.session_buffers,
            "planRetirements": wire.plan_retirements,
            "sessionRetirements": wire.session_retirements,
            "querySerializedRecords": work.query_serialized_records,
            "querySerializedBytes": work.query_serialized_bytes}
    })
}

#[test]
#[ignore = "requires an authenticated shipping-package trace from benchmark:bitmap-native-replay-capture"]
fn authenticate() {
    let trace = std::env::var("GLYPH_BITMAP_REPLAY_TRACE")
        .expect("named workflow must supply GLYPH_BITMAP_REPLAY_TRACE");
    let directory = Path::new(&trace).parent().unwrap();
    let mut registry = ShaperRegistry::default();
    let mut engine = TextEngine::default();
    let mut batch = UpdateBatchTransport::default();
    let mut frames = BTreeMap::<u32, FrameTransport>::new();
    let mut count = 0_usize;
    let mut initialized = false;
    let mut totals = [Work::default(); 6];
    let mut event_counts = [0_usize; 6];
    let mut wires = [WireTotals::default(); 6];
    for line in fs::read_to_string(&trace).unwrap().lines() {
        let event: Value = serde_json::from_str(line).unwrap();
        let sequence = field(&event, "sequence").as_u64().unwrap();
        assert_eq!(sequence, count as u64);
        let kind = field(&event, "kind").as_str().unwrap();
        assert_eq!(
            number(&event, "status"),
            STATUS_OK,
            "captured event {sequence} failed"
        );
        if kind != "initialize" {
            assert!(
                initialized,
                "event {sequence} preceded engine initialization"
            );
        }
        let phase = field(&event, "phase").as_str().unwrap();
        let bucket = match (phase, kind) {
            ("initial", "measureParagraph") => Some(0),
            ("initial", "textUpdateBatch") => Some(1),
            ("forward", "measureParagraph") => Some(2),
            ("forward", "textUpdateBatch") => Some(3),
            ("reverse", "measureParagraph") => Some(4),
            ("reverse", "textUpdateBatch") => Some(5),
            (_, "measureParagraph" | "textUpdateBatch") => panic!("unexpected phase {phase}"),
            _ => None,
        };
        let mut event_wire = WireTotals::default();
        work_attribution::reset();
        match kind {
            "initialize" => {
                assert_eq!(sequence, 0, "initialization must be first and unique");
                assert!(!initialized);
                assert!(field(&event, "args").as_array().unwrap().is_empty());
                assert_eq!(registry.initialize(), Ok(()));
                engine.initialize().unwrap();
                initialized = true;
            }
            "registerFont" => {
                let sfnt = blob(directory, &event, "sfnt");
                let extents = blob(directory, &event, "extents");
                let availability = blob(directory, &event, "availability");
                assert_eq!(
                    registry.register_font(
                        argument(&event, 0),
                        &sfnt,
                        &extents,
                        &availability,
                        argument(&event, 7),
                        argument(&event, 8)
                    ),
                    STATUS_OK
                );
            }
            "disposeFont" => {
                assert!(!engine.references_shaping_font(argument(&event, 0)));
                assert_eq!(registry.dispose_font(argument(&event, 0)), STATUS_OK);
                engine.dispose_bindings_for_shaping_font(argument(&event, 0));
            }
            "registerCodec" => {
                let bytes = blob(directory, &event, "bytes");
                let parsed = parse_codec(&bytes).unwrap();
                engine.register_codec(argument(&event, 0), parsed).unwrap();
            }
            "disposeCodec" => engine.dispose_codec(argument(&event, 0)).unwrap(),
            "registerFontBinding" => {
                let bytes = blob(directory, &event, "bytes");
                let shaping = argument(&event, 1);
                let glyph_count = registry.glyph_count(shaping).unwrap();
                let parsed = parse_font_binding(&bytes).unwrap();
                engine
                    .register_font_binding(argument(&event, 0), shaping, glyph_count, parsed)
                    .unwrap();
            }
            "disposeFontBinding" => engine.dispose_font_binding(argument(&event, 0)),
            "registerFontStack" => {
                let bytes = blob(directory, &event, "bytes");
                assert_eq!(bytes.len(), argument(&event, 2) as usize * 4);
                let fonts: Vec<u32> = bytes
                    .chunks_exact(4)
                    .map(|word| u32::from_le_bytes(word.try_into().unwrap()))
                    .collect();
                for font in &fonts {
                    let shaping = engine.shaping_handle_for_binding(*font).unwrap();
                    assert!(registry.contains_font(shaping));
                }
                engine
                    .register_font_stack(argument(&event, 0), &fonts)
                    .unwrap();
            }
            "disposeFontStack" => engine.dispose_font_stack(argument(&event, 0)).unwrap(),
            "createRoot" => {
                let root = argument(&event, 0);
                let transport =
                    FrameTransport::new(argument(&event, 1), argument(&event, 2)).unwrap();
                engine.create_root(root).unwrap();
                let text_capacity = match argument(&event, 3) {
                    0 => crate::engine::frame::DEFAULT_ROOT_TEXT_CAPACITY,
                    capacity => capacity,
                };
                engine.reserve_root_text(root, text_capacity).unwrap();
                assert!(frames.insert(root, transport).is_none());
            }
            "reserveRoot" => {
                let root = argument(&event, 0);
                frames
                    .get_mut(&root)
                    .unwrap()
                    .reserve(argument(&event, 1), argument(&event, 2))
                    .unwrap();
                if argument(&event, 3) != 0 {
                    engine.reserve_root_text(root, argument(&event, 3)).unwrap();
                }
            }
            "resetRoot" => engine.reset_root(argument(&event, 0)).unwrap(),
            "disposeRoot" => {
                engine.dispose_root(argument(&event, 0)).unwrap();
                frames.remove(&argument(&event, 0)).unwrap();
            }
            "reserveUpdateBatch" => {
                batch.reserve(argument(&event, 0)).unwrap();
            }
            "measureParagraph" => {
                let root = argument(&event, 0);
                let paragraph = argument(&event, 3);
                let request_bytes = blob(directory, &event, "request");
                let expected = blob(directory, &event, "result");
                let transport = frames.get_mut(&root).unwrap();
                assert!(request_bytes.len() <= transport.request.capacity() as usize);
                transport.request.bytes_mut()[..request_bytes.len()]
                    .copy_from_slice(&request_bytes);
                let revision = engine.root_revision(root).unwrap();
                let request = parse_update_request(
                    transport
                        .request_at(transport.request_pointer(), request_bytes.len() as u32)
                        .unwrap(),
                    root,
                )
                .unwrap();
                let measured = engine
                    .measure_paragraph_with_shaper(&mut registry, request, paragraph)
                    .unwrap();
                let views = engine.measured_semantic_views(measured).unwrap();
                let layout = query_layout(views).unwrap();
                assert!(layout.byte_length <= request.limits.max_output_bytes);
                transport
                    .ensure_publish_capacity(layout.byte_length)
                    .unwrap();
                transport.stage_query(root, revision, views).unwrap();
                engine.commit_measure(measured).unwrap();
                let length =
                    read_u32(transport.output.bytes(), ENGINE_RESULT_BYTE_LENGTH).unwrap() as usize;
                compare_result(
                    sequence,
                    &event,
                    &expected,
                    &transport.output.bytes()[..length],
                );
                event_wire.result_bytes = length;
            }
            "textUpdateBatch" => {
                let entries = field(&event, "entries").as_array().unwrap();
                let responses = field(&event, "responses").as_array().unwrap();
                assert_eq!(entries.len(), 1, "capture supports one ordered batch entry");
                assert!(
                    batch.capacity() >= 1,
                    "batch arena must be reserved before publication"
                );
                assert_eq!(entries.len(), responses.len());
                for (entry, response) in entries.iter().zip(responses) {
                    let root = number(entry, "rootId");
                    assert_eq!(root, number(response, "rootId"));
                    let request_bytes = blob(directory, entry, "request");
                    assert_eq!(request_bytes.len(), number(entry, "requestLength") as usize);
                    let expected = blob(directory, response, "result");
                    let transport = frames.get_mut(&root).unwrap();
                    assert!(request_bytes.len() <= transport.request.capacity() as usize);
                    transport.request.bytes_mut()[..request_bytes.len()]
                        .copy_from_slice(&request_bytes);
                    let request = parse_update_request(
                        transport
                            .request_at_current(request_bytes.len() as u32)
                            .unwrap(),
                        root,
                    )
                    .unwrap();
                    let generation = transport.next_publication_generation().unwrap();
                    let prepared = engine
                        .prepare_update_with_shaper(&mut registry, request, generation)
                        .unwrap();
                    let plan = engine.prepared_plan(prepared).unwrap();
                    event_wire.plan_buffers = plan.buffers.len();
                    event_wire.session_buffers = plan.session_buffers.len();
                    event_wire.plan_retirements = plan.retirements.len();
                    event_wire.session_retirements = plan.session_retirements.len();
                    event_wire.plan_payload_bytes = plan.payload.len();
                    event_wire.session_payload_bytes = plan.session_payload.len();
                    for patch in plan
                        .patches
                        .iter()
                        .filter(|patch| patch.opcode == PATCH_WRITE)
                    {
                        event_wire.plan_write_patches += 1;
                        event_wire.plan_write_bytes += patch.byte_length as usize;
                    }
                    for patch in plan
                        .session_patches
                        .iter()
                        .filter(|patch| patch.opcode == PATCH_WRITE)
                    {
                        event_wire.session_write_patches += 1;
                        event_wire.session_write_bytes += patch.byte_length as usize;
                    }
                    let semantic = engine.prepared_semantic_views(prepared).unwrap();
                    let layout = publication_layout(plan, semantic).unwrap();
                    assert!(layout.byte_length <= request.limits.max_output_bytes);
                    transport
                        .reserve_publish_capacity(layout.byte_length)
                        .unwrap();
                    let staged = transport.stage_publication(plan, semantic, layout).unwrap();
                    let committed = engine.commit_update(prepared).unwrap();
                    transport.publish_success(committed, staged);
                    let length = read_u32(transport.output.bytes(), ENGINE_RESULT_BYTE_LENGTH)
                        .unwrap() as usize;
                    compare_result(
                        sequence,
                        &event,
                        &expected,
                        &transport.output.bytes()[..length],
                    );
                    event_wire.result_bytes += length;
                }
            }
            _ => panic!("unhandled captured event {kind} at {sequence}"),
        }
        let observed = work_attribution::snapshot();
        if let Some(index) = bucket {
            add_work(&mut totals[index], observed);
            event_counts[index] += 1;
            let wire = &mut wires[index];
            wire.result_bytes += event_wire.result_bytes;
            wire.plan_write_patches += event_wire.plan_write_patches;
            wire.plan_write_bytes += event_wire.plan_write_bytes;
            wire.session_write_patches += event_wire.session_write_patches;
            wire.session_write_bytes += event_wire.session_write_bytes;
            wire.plan_payload_bytes += event_wire.plan_payload_bytes;
            wire.session_payload_bytes += event_wire.session_payload_bytes;
            wire.plan_buffers += event_wire.plan_buffers;
            wire.session_buffers += event_wire.session_buffers;
            wire.plan_retirements += event_wire.plan_retirements;
            wire.session_retirements += event_wire.session_retirements;
        }
        count += 1;
    }
    assert_eq!(count, 6157);
    assert!(initialized);
    assert!(frames.is_empty(), "every captured root must be disposed");
    assert_eq!(event_counts, [2048, 1, 1024, 1, 1024, 1]);
    for index in [1, 3, 5] {
        assert_eq!(
            totals[index].ordered_emitted_write_bytes, wires[index].plan_write_bytes,
            "ordered write bytes must equal emitted plan write patch bytes"
        );
    }
    let report = serde_json::json!({
        "result": "exact-byte-pass",
        "eventCount": count,
        "scope": "native direct one-entry engine/frame replay; excludes batch descriptor processing, allocation, host buffers, timing, GC, and seven-family parity",
        "nativeScalar": true,
        "totals": [
            work_json(totals[0], event_counts[0], wires[0], "initial", "queryPreparation"),
            work_json(totals[1], event_counts[1], wires[1], "initial", "publication"),
            work_json(totals[2], event_counts[2], wires[2], "forward", "queryPreparation"),
            work_json(totals[3], event_counts[3], wires[3], "forward", "publication"),
            work_json(totals[4], event_counts[4], wires[4], "reverse", "queryPreparation"),
            work_json(totals[5], event_counts[5], wires[5], "reverse", "publication"),
        ]
    });
    let output = std::env::var("GLYPH_BITMAP_WORK_REPORT")
        .expect("named workflow must supply GLYPH_BITMAP_WORK_REPORT");
    fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    println!("authenticated {count} exact shipping Wasm events");
}
