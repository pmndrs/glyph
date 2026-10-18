//! Test-only work counts. These observe existing owners; they are not timers or a second executor.

use core::cell::Cell;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Work {
    pub harfrust_calls: usize,
    pub harfrust_utf16_units: usize,
    /// Completed whole scratch-to-pending ShapeArena ownership transfers.
    pub shape_scratch_arena_moves: usize,
    /// Glyph rows transferred with those arenas; no glyph payload is copied.
    pub shape_scratch_moved_glyphs: usize,
    /// Glyph rows copied by ShapeArena range appends, including retained rows.
    pub shape_range_copied_glyphs: usize,
    /// Completed direct ClusterArena full builds.
    pub cluster_full_builds: usize,
    /// Old cluster rows copied by ClusterArena::copy_from, across all callers.
    pub cluster_copied_old_rows: usize,
    pub cluster_full_glyph_visits: usize,
    pub cluster_retained_glyph_loop_visits: usize,
    pub run_local_glyph_visits: usize,
    pub recomposed_flow_lines: usize,
    /// Masks examined by the retained in-place gather decision, excluding rebuilt records.
    pub gather_mask_bits: usize,
    pub gather_mask_bit_counts: [usize; 16],
    pub gather_all_masks: usize,
    pub gather_identity_mismatches: usize,
    pub measurement_ink_glyph_visits: usize,
    pub measurement_intrinsic_cluster_visits: usize,
    pub intrinsic_flow_preparations: usize,
    pub intrinsic_positioning_preparations: usize,
    pub query_serialized_records: usize,
    pub query_serialized_bytes: usize,
    pub draw_reduced_glyphs: usize,
    pub draw_folded_blocks: usize,
    pub rope_record_pushes: usize,
    pub rope_bulk_records: usize,
    pub rope_bulk_chunks: usize,
    pub rope_point_queries: usize,
    pub rope_iterator_starts: usize,
    pub copied_positioned_records: usize,
    pub copied_positioned_bytes: usize,
    pub newly_positioned_glyphs: usize,
    pub positioned_revision_visits: usize,
    pub gather_paragraph_visits: usize,
    pub gather_range_skips: usize,
    pub gather_glyph_visits: usize,
    pub gather_retained_gap_rows: usize,
    pub gather_envelope_splices: usize,
    pub gather_suffix_copy_bytes: usize,
    pub publication_commit_visits: usize,
    pub placement_key_owner_visits: usize,
    pub placement_binding_owner_visits: usize,
    pub placement_binding_glyph_visits: usize,
    /// Exact-key retained attempts; structural reconciliation stops this attempt at first mismatch.
    pub placement_slot_checks: usize,
    pub placement_reconciled_key_groups: usize,
    pub placement_segment_validation_visits: usize,
    pub placement_run_lookup_visits: usize,
    pub canonical_cluster_comparisons: usize,
    pub canonical_style_resolutions: usize,
    pub canonical_text_validations: usize,
    pub flow_shape_windows: usize,
    pub flow_shape_window_units: usize,
    pub flow_shape_window_first_start: usize,
    pub flow_shape_window_last_end: usize,
    pub flow_convergence_checks: usize,
    pub flow_dirty_end_blocks: usize,
    pub flow_cursor_mismatches: usize,
    pub flow_correction_mismatches: usize,
    pub flow_metric_mismatches: usize,
    pub flow_drop_cap_blocks: usize,
    pub placement_remap_attempts: usize,
    pub placement_remap_successes: usize,
    pub placement_remap_run_rejections: usize,
    pub placement_remap_direction_rejections: usize,
    pub placement_remap_anchor_rejections: usize,
    pub placement_remap_numeric_rejections: usize,
    pub placement_remap_numeric_prefix_only: usize,
    pub placement_remap_numeric_anchor_only: usize,
    pub placement_remap_numeric_prefix_and_anchor: usize,
    pub placement_remap_numeric_partition: usize,
    pub placement_remap_numeric_identity: usize,
    pub placement_remap_numeric_other: usize,

    pub placement_remap_glyph_rejections: usize,

    pub ordered_admission_visits: usize,
    pub codec_executed_records: usize,
    pub clean_buffer_copy_runs: usize,
    pub retained_storage_match_batch_visits: usize,
    pub ordered_instance_rewrites: usize,
    pub ordered_instance_comparisons: usize,
}

std::thread_local! {
    static WORK: Cell<Work> = const { Cell::new(Work {
        harfrust_calls: 0,
        harfrust_utf16_units: 0,
        shape_scratch_arena_moves: 0,
        shape_scratch_moved_glyphs: 0,
        shape_range_copied_glyphs: 0,
        cluster_full_builds: 0,
        cluster_copied_old_rows: 0,
        cluster_full_glyph_visits: 0,
        cluster_retained_glyph_loop_visits: 0,
        run_local_glyph_visits: 0,
        recomposed_flow_lines: 0,
        gather_mask_bits: 0,
        gather_mask_bit_counts: [0; 16],
        gather_all_masks: 0,
        gather_identity_mismatches: 0,
        measurement_ink_glyph_visits: 0,
        measurement_intrinsic_cluster_visits: 0,
        intrinsic_flow_preparations: 0,
        intrinsic_positioning_preparations: 0,
        query_serialized_records: 0,
        query_serialized_bytes: 0,
        draw_reduced_glyphs: 0,
        draw_folded_blocks: 0,
        rope_record_pushes: 0,
        rope_bulk_records: 0,
        rope_bulk_chunks: 0,
        rope_point_queries: 0,
        rope_iterator_starts: 0,
        copied_positioned_records: 0,
        copied_positioned_bytes: 0,
        newly_positioned_glyphs: 0,
        positioned_revision_visits: 0,
        gather_paragraph_visits: 0,
        gather_range_skips: 0,
        gather_glyph_visits: 0,
        gather_retained_gap_rows: 0,
        gather_envelope_splices: 0,
        gather_suffix_copy_bytes: 0,
        publication_commit_visits: 0,
        placement_key_owner_visits: 0,
        placement_binding_owner_visits: 0,
        placement_binding_glyph_visits: 0,
        placement_slot_checks: 0,
        placement_reconciled_key_groups: 0,
        placement_segment_validation_visits: 0,
        placement_run_lookup_visits: 0,
        canonical_cluster_comparisons: 0,
        canonical_style_resolutions: 0,
        canonical_text_validations: 0,
        flow_shape_windows: 0,
        flow_shape_window_units: 0,
        flow_shape_window_first_start: 0,
        flow_shape_window_last_end: 0,
        flow_convergence_checks: 0,
        flow_dirty_end_blocks: 0,
        flow_cursor_mismatches: 0,
        flow_correction_mismatches: 0,
        flow_metric_mismatches: 0,
        flow_drop_cap_blocks: 0,
        placement_remap_attempts: 0,
        placement_remap_successes: 0,
        placement_remap_run_rejections: 0,
        placement_remap_direction_rejections: 0,
        placement_remap_anchor_rejections: 0,
        placement_remap_numeric_rejections: 0,
        placement_remap_numeric_prefix_only: 0,
        placement_remap_numeric_anchor_only: 0,
        placement_remap_numeric_prefix_and_anchor: 0,
        placement_remap_numeric_partition: 0,
        placement_remap_numeric_identity: 0,
        placement_remap_numeric_other: 0,

        placement_remap_glyph_rejections: 0,

        ordered_admission_visits: 0,
        codec_executed_records: 0,
        clean_buffer_copy_runs: 0,
        retained_storage_match_batch_visits: 0,
        ordered_instance_rewrites: 0,
        ordered_instance_comparisons: 0,
    }) };
}

pub(crate) fn record(update: impl FnOnce(&mut Work)) {
    WORK.with(|cell| {
        let mut work = cell.get();
        update(&mut work);
        cell.set(work);
    });
}

pub(crate) fn reset() {
    WORK.with(|cell| cell.set(Work::default()));
}

pub(crate) fn snapshot() -> Work {
    WORK.with(Cell::get)
}
