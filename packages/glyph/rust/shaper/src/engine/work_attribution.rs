//! Test-only work counts. These observe existing owners; they are not timers or a second executor.

use core::cell::Cell;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Work {
    pub measurement_ink_glyph_visits: usize,
    pub measurement_intrinsic_cluster_visits: usize,
    pub query_serialized_records: usize,
    pub query_serialized_bytes: usize,
    pub draw_reduced_glyphs: usize,
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
    pub publication_commit_visits: usize,
    pub placement_key_owner_visits: usize,
    pub placement_binding_owner_visits: usize,
    pub placement_binding_glyph_visits: usize,
    pub placement_rollback_rows_copied: usize,
    pub placement_rollback_rows_restored: usize,
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
    pub ordered_instance_rewrites: usize,
    pub ordered_instance_comparisons: usize,
}

std::thread_local! {
    static WORK: Cell<Work> = const { Cell::new(Work {
        measurement_ink_glyph_visits: 0,
        measurement_intrinsic_cluster_visits: 0,
        query_serialized_records: 0,
        query_serialized_bytes: 0,
        draw_reduced_glyphs: 0,
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
        publication_commit_visits: 0,
        placement_key_owner_visits: 0,
        placement_binding_owner_visits: 0,
        placement_binding_glyph_visits: 0,
        placement_rollback_rows_copied: 0,
        placement_rollback_rows_restored: 0,
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
