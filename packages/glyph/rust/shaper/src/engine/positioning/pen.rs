//! Pen origin, alignment and justification of a fragment, and the finite-value guards they share.

use super::*;

#[inline]
pub(super) fn apply_justification(
    cluster: usize,
    clusters: &ClusterArena,
    justify: JustifyDistribution,
    cursor: &mut f64,
    space_ordinal: &mut i64,
    gap_ordinal: &mut i64,
) {
    if clusters.flags[cluster] & CLUSTER_SPACE != 0
        && cluster < justify.gap_end
        && *space_ordinal < i64::from(justify.spaces)
        && (justify.per_space_units != 0 || justify.extra_space_units != 0)
    {
        let units = justify.per_space_units + i64::from(*space_ordinal < justify.extra_space_units);
        *cursor += crate::engine::layout_units::scaled_from_layout_units(units);
        *space_ordinal += 1;
    }
    if cluster < justify.gap_end
        && *gap_ordinal < i64::from(justify.gaps)
        && (justify.per_gap_units != 0 || justify.extra_gap_units != 0)
    {
        let units = justify.per_gap_units + i64::from(*gap_ordinal < justify.extra_gap_units);
        *cursor += crate::engine::layout_units::scaled_from_layout_units(units);
        *gap_ordinal += 1;
    }
}

pub(super) fn apply_opacity(rgba: u32, opacity: f32) -> u32 {
    let alpha = ((rgba >> 24) & 0xff) as f32;
    let resolved = (alpha * opacity + 0.5) as u32;
    (rgba & 0x00ff_ffff) | (resolved << 24)
}

pub(crate) fn style_has_text_effects(style: ResolvedStyle) -> bool {
    style.outline_rgba != 0
        || style.outline_width != 0.0
        || style.shadow_rgba != 0
        || style.shadow_offset_x != 0.0
        || style.shadow_offset_y != 0.0
}

#[allow(clippy::too_many_arguments)]
/// The per-fragment pen derivation: the justify distribution and the pen's
/// starting origin (slot start plus indent shift plus alignment offset). This
/// is the ONE definition of that arithmetic — `position_fragment` walks glyphs
/// from it, and the resize equivalence proof compares it, so the proof can
/// never drift from what positioning actually computes. The indent reserves
/// inline space on the paragraph-direction start side: the LTR pen shifts
/// right; the RTL pen keeps its origin and the reduced available width moves
/// the right edge inward instead.
pub(super) fn fragment_pen(
    line: FlowLine,
    fragment: FlowFragment,
    final_line: bool,
    clusters: &ClusterArena,
    cluster_start: usize,
    cluster_end: usize,
    indent: f64,
    controls: JustifyControls,
    paragraph_level: u8,
    hung_leads: bool,
) -> (JustifyDistribution, f64) {
    let justify = justification_adjustment(
        line,
        fragment,
        final_line,
        clusters,
        cluster_start,
        cluster_end,
        indent,
        controls,
    );
    let justified = !justify.is_zero();
    (
        justify,
        fragment_pen_origin(
            line,
            fragment,
            indent,
            paragraph_level,
            justified,
            hung_leads,
        ),
    )
}

/// The exact scalar origin shared by General's fragment walk and an admitted one-line leaf.
/// Justification construction stays in `fragment_pen`; both owners use the same ordered f64
/// additions for slot start, indent, alignment and hanging-space translation.
pub(crate) fn fragment_pen_origin(
    line: FlowLine,
    fragment: FlowFragment,
    indent: f64,
    paragraph_level: u8,
    justified: bool,
    hung_leads: bool,
) -> f64 {
    let available =
        (fragment.slot_end - fragment.slot_start - indent - fragment.line.advance).max(0.0);
    let offset = if justified {
        0.0
    } else {
        alignment_offset(line.align, paragraph_level, available)
    };
    let indent_shift = if paragraph_level & 1 == 0 {
        indent
    } else {
        0.0
    };
    // A line keeps its terminating spaces but does not charge them to `advance`. Visual
    // order decides whether that is free: LTR lays them last, past the end of the line,
    // where they have no ink and no consequence. RTL lays them FIRST -- they are visually
    // leftmost -- so they occupy the pen and push every visible glyph right by their
    // width. Discounting them here puts the ink back exactly where a line with no
    // terminating space would sit, which is what makes the right edge hold still while
    // text is typed.
    let hung_shift = if hung_leads {
        fragment.line.hung_advance
    } else {
        0.0
    };
    fragment.slot_start + indent_shift + offset - hung_shift
}

pub(crate) fn alignment_offset(align: u8, paragraph_level: u8, available: f64) -> f64 {
    match align {
        ALIGN_CENTER => available * 0.5,
        ALIGN_END if paragraph_level & 1 == 0 => available,
        ALIGN_START if paragraph_level & 1 != 0 => available,
        _ => 0.0,
    }
}

/// Resolve one constraint's typography for positioning and measurement.
pub(crate) fn constraint_typography(
    constraint: &crate::engine::semantic_wire::FlowConstraint,
) -> ThreadTypography {
    ThreadTypography {
        first_line_indent: f64::from(constraint.first_line_indent),
        justify: JustifyControls {
            minimum_word_space_ratio: constraint.justify_min_word_space_ratio,
            maximum_word_space_ratio: constraint.justify_max_word_space_ratio,
            letter_space_expansion: constraint.justify_letter_space_expansion,
            last_line_justify: constraint.last_line == crate::engine::frame::LAST_LINE_JUSTIFY,
        },
    }
}
impl JustifyDistribution {
    pub(crate) fn is_zero(&self) -> bool {
        self.per_space_units == 0
            && self.extra_space_units == 0
            && self.per_gap_units == 0
            && self.extra_gap_units == 0
    }

    /// The exact total the distribution adds to the line, in layout units.
    pub(crate) fn total_units(&self) -> i64 {
        self.per_space_units * i64::from(self.spaces)
            + self.extra_space_units
            + self.per_gap_units * i64::from(self.gaps)
            + self.extra_gap_units
    }
}

/// Splits an exact unit total over `count` sites: every site takes the euclidean
/// quotient and the first `remainder` sites take one more unit, in either sign.
pub(super) fn distribute_units(total: i64, count: u32) -> (i64, i64) {
    if count == 0 {
        return (0, 0);
    }
    let divisor = i64::from(count);
    (total.div_euclid(divisor), total.rem_euclid(divisor))
}

pub(super) fn justifiable_span(
    clusters: &ClusterArena,
    start: usize,
    mut end: usize,
) -> JustifiableSpan {
    // A hard break is a zero-advance sentinel that ends the line, so the spaces behind it
    // are still the line's terminating spaces. Stopping at the sentinel would leave them
    // justifiable here while the fit hangs them, and the two stages must agree on which
    // spaces exist — that disagreement is the whole subject of D-257.
    if end > start && clusters.flags[end - 1] & CLUSTER_HARD_BREAK != 0 {
        end -= 1;
    }
    while end > start && clusters.flags[end - 1] & CLUSTER_SPACE != 0 {
        end -= 1;
    }
    let mut spaces = 0_u32;
    let mut space_advance_units = 0_i64;
    // The D-245 flag-mask kernel scans sixteen cluster flags per step on
    // simd128 builds; the visit order matches the scalar loop exactly, and the
    // integer sum matches the fit's chunk-summarized space totals.
    crate::engine::line_kernels::for_each_flagged(
        &clusters.flags,
        start,
        end,
        CLUSTER_SPACE,
        |cluster| {
            spaces = spaces.saturating_add(1);
            space_advance_units =
                space_advance_units.saturating_add(clusters.advance_units[cluster]);
        },
    );
    JustifiableSpan {
        spaces,
        space_advance_units,
        trimmed_end: end,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn justification_adjustment(
    line: FlowLine,
    fragment: FlowFragment,
    final_line: bool,
    clusters: &ClusterArena,
    cluster_start: usize,
    cluster_end: usize,
    indent: f64,
    controls: JustifyControls,
) -> JustifyDistribution {
    let justified = line.align == ALIGN_JUSTIFY
        && (controls.last_line_justify || (!fragment.line.hard_break && !final_line));
    if !justified {
        return JustifyDistribution::default();
    }
    let span = justifiable_span(clusters, cluster_start, cluster_end);
    if span.spaces == 0 {
        return JustifyDistribution::default();
    }
    // ONE quantization site per fragment: the signed deficit rounds half-up into
    // layout units, and every bound below is exact integer arithmetic from here.
    let deficit_units = crate::engine::layout_units::layout_units_from_scaled(
        fragment.slot_end - fragment.slot_start - indent - fragment.line.advance,
    );
    if deficit_units >= 0 {
        // Expansion: word spaces grow up to the declared cap — the excess ratio
        // is applied once with the shared half-up layout-unit contract — then
        // the remainder spills into inter-cluster gaps bounded per gap; any
        // residue stays unfilled and the line reads as under-full.
        let space_growth = if controls.maximum_word_space_ratio > 0.0 {
            deficit_units.min(crate::engine::layout_units::apply_ratio(
                span.space_advance_units,
                f64::from(controls.maximum_word_space_ratio) - 1.0,
            ))
        } else {
            deficit_units
        };
        let gaps = u32::try_from(
            span.trimmed_end
                .saturating_sub(cluster_start)
                .saturating_sub(1),
        )
        .unwrap_or(u32::MAX);
        let remainder = deficit_units - space_growth;
        let gap_growth = if controls.letter_space_expansion > 0.0 && gaps > 0 && remainder > 0 {
            remainder.min(
                crate::engine::layout_units::layout_units_from_scaled(f64::from(
                    controls.letter_space_expansion,
                ))
                .saturating_mul(i64::from(gaps)),
            )
        } else {
            0
        };
        let (per_space_units, extra_space_units) = distribute_units(space_growth, span.spaces);
        let (per_gap_units, extra_gap_units) = distribute_units(gap_growth, gaps);
        JustifyDistribution {
            spaces: span.spaces,
            per_space_units,
            extra_space_units,
            gaps,
            per_gap_units,
            extra_gap_units,
            gap_end: span.trimmed_end,
        }
    } else if controls.minimum_word_space_ratio > 0.0 {
        // Compression: an overfull line shrinks its word spaces, never below the
        // declared minimum of their natural advance sum. The capacity applies
        // the SAME exact-ratio expression the integer fit used to admit the
        // line, so positioning can always shrink what the fit promised to
        // within the rounding contract's half unit.
        let capacity = crate::engine::layout_units::apply_ratio(
            span.space_advance_units,
            1.0 - f64::from(controls.minimum_word_space_ratio),
        );
        let shrink = (-deficit_units).min(capacity);
        let (per_space_units, extra_space_units) = distribute_units(-shrink, span.spaces);
        JustifyDistribution {
            spaces: span.spaces,
            per_space_units,
            extra_space_units,
            gaps: 0,
            per_gap_units: 0,
            extra_gap_units: 0,
            gap_end: span.trimmed_end,
        }
    } else {
        JustifyDistribution::default()
    }
}

/// The inline extent one fragment occupies: its (possibly justified) advance
/// plus the paragraph first-line indent when the fragment starts the thread.
pub(crate) fn positioned_fragment_advance(
    line: FlowLine,
    fragment: FlowFragment,
    final_line: bool,
    clusters: &ClusterArena,
    indent: f64,
    controls: JustifyControls,
) -> Result<f64, EngineError> {
    let cluster_start =
        usize::try_from(fragment.line.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
    let cluster_end =
        usize::try_from(fragment.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
    let distribution = justification_adjustment(
        line,
        fragment,
        final_line,
        clusters,
        cluster_start,
        cluster_end,
        indent,
        controls,
    );
    // The distributed total is exact in layout units and dyadic in f64, so this
    // advance agrees bit-for-bit with the adjustments positioning applies.
    Ok(indent
        + fragment.line.advance
        + crate::engine::layout_units::scaled_from_layout_units(distribution.total_units()))
}

pub(super) fn finite_f32(value: f64) -> Result<f32, EngineError> {
    let value = value as f32;
    value
        .is_finite()
        .then_some(value)
        .ok_or(EngineError::InvalidRequest)
}

pub(crate) fn placed_f32(local: f32, translation: f32) -> Result<f32, EngineError> {
    let value = local + translation;
    value
        .is_finite()
        .then_some(value)
        .ok_or(EngineError::InvalidRequest)
}

pub(super) fn nonnegative_f32(value: f64) -> Result<f32, EngineError> {
    let value = finite_f32(value)?;
    (value >= 0.0)
        .then_some(value)
        .ok_or(EngineError::InvalidRequest)
}
