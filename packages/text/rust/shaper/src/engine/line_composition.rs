use super::{
    EngineError,
    cluster_state::{
        CLUSTER_ALLOWED_BREAK, CLUSTER_HARD_BREAK, CLUSTER_REQUIRED_BREAK, CLUSTER_SAFE_BEFORE,
        CLUSTER_SPACE, ClusterArena,
    },
    frame::{WRAP_CHARACTER, WRAP_NONE, WRAP_WORD},
    layout_units::{scaled_from_layout_units},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct LineCursor {
    cluster: usize,
    trailing_empty: bool,
}

impl LineCursor {
    pub(crate) const fn at_cluster(cluster: usize) -> Self {
        Self {
            cluster,
            trailing_empty: false,
        }
    }

    pub(crate) const fn cluster(self) -> usize {
        self.cluster
    }

    pub(crate) const fn is_complete(self, cluster_count: usize) -> bool {
        self.cluster == cluster_count && !self.trailing_empty
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ComposedLine {
    pub cluster_start: u32,
    pub cluster_end: u32,
    pub text_start: u32,
    pub text_end: u32,
    pub advance: f64,
    pub hard_break: bool,
}

pub(crate) fn layout_next_line(
    clusters: &ClusterArena,
    cursor: &mut LineCursor,
    max_width: f64,
    wrap: u8,
    word_space_shrink: f64,
) -> Result<Option<ComposedLine>, EngineError> {
    if max_width.is_nan()
        || max_width < 0.0
        || !(0.0..1.0).contains(&word_space_shrink)
        || !matches!(wrap, WRAP_NONE | WRAP_WORD | WRAP_CHARACTER)
    {
        return Err(EngineError::InvalidRequest);
    }
    let count = clusters.starts.len();
    if cursor.cluster > count {
        return Err(EngineError::InvalidRequest);
    }
    if cursor.trailing_empty {
        cursor.trailing_empty = false;
        cursor.cluster = count;
        let text_end = clusters.ends.last().copied().unwrap_or(0);
        let count = u32::try_from(count).map_err(|_| EngineError::ResultTooLarge)?;
        return Ok(Some(ComposedLine {
            cluster_start: count,
            cluster_end: count,
            text_start: text_end,
            text_end,
            advance: 0.0,
            hard_break: false,
        }));
    }
    if cursor.cluster == count {
        return Ok(None);
    }

    let line_start = cursor.cluster;
    let mut advance = 0.0;
    let mut shrinkable = 0.0;
    let mut last_allowed = None;
    let mut last_allowed_advance = 0.0;
    let mut last_safe = None;
    let mut last_safe_advance = 0.0;
    let mut selected_end = count;
    let mut selected_advance = 0.0;

    for index in line_start..count {
        let flags = clusters.flags[index];
        if index > line_start && flags & CLUSTER_SAFE_BEFORE != 0 {
            last_safe = Some(index);
            last_safe_advance = advance;
        }
        let required_break = flags & CLUSTER_REQUIRED_BREAK != 0;
        let next_advance = advance + clusters.advances[index];
        // Declared word-space shrink lends back a fraction of every consumed
        // space, admitting the word that would otherwise just overflow; the
        // justification pass compresses those spaces to the same bound.
        let next_shrinkable = if flags & CLUSTER_SPACE != 0 {
            shrinkable + clusters.advances[index] * word_space_shrink
        } else {
            shrinkable
        };
        if wrap != WRAP_NONE
            && max_width.is_finite()
            && next_advance - next_shrinkable > max_width
            && index > line_start
        {
            if let Some(end) = last_allowed.filter(|end| *end > line_start) {
                selected_end = end;
                selected_advance = last_allowed_advance;
            } else if let Some(end) = last_safe.filter(|end| *end > line_start) {
                selected_end = end;
                selected_advance = last_safe_advance;
            } else {
                advance = next_advance;
                if required_break || index + 1 == count {
                    selected_end = index + 1;
                    selected_advance = advance;
                    break;
                }
                continue;
            }
            break;
        }
        advance = next_advance;
        shrinkable = next_shrinkable;
        if required_break {
            selected_end = index + 1;
            selected_advance = advance;
            break;
        }
        let allowed = match wrap {
            WRAP_WORD => flags & CLUSTER_ALLOWED_BREAK != 0,
            WRAP_CHARACTER => {
                index + 1 == count || clusters.flags[index + 1] & CLUSTER_SAFE_BEFORE != 0
            }
            WRAP_NONE => false,
            _ => unreachable!(),
        };
        if allowed {
            last_allowed = Some(index + 1);
            last_allowed_advance = advance;
        }
        if index + 1 == count {
            selected_advance = advance;
        }
    }

    if selected_end <= line_start {
        selected_end = line_start + 1;
        selected_advance = clusters.advances[line_start];
    }
    let last = selected_end - 1;
    let hard_break = clusters.flags[last] & CLUSTER_HARD_BREAK != 0;
    let text_start = clusters.starts[line_start];
    let text_end = if hard_break {
        clusters.starts[last]
    } else {
        clusters.ends[last]
    };
    cursor.cluster = selected_end;
    cursor.trailing_empty = selected_end == count && hard_break;
    Ok(Some(ComposedLine {
        cluster_start: u32::try_from(line_start).map_err(|_| EngineError::ResultTooLarge)?,
        cluster_end: u32::try_from(selected_end).map_err(|_| EngineError::ResultTooLarge)?,
        text_start,
        text_end,
        advance: selected_advance,
        hard_break,
    }))
}

/// Integer twin of [`layout_next_line`] over the F26.6 advance stream (slice 2a of
/// the integer-layout-units plan). Widths arrive in layout units and the shrink
/// fraction as a Q16 ratio; accumulation is exact `i64` arithmetic, which is what
/// admits the chunk-64 kernels in slice 2b. The parity harness below proves the
/// selection agrees with the f64 fit over quantized inputs, where f64 sums of
/// dyadic F26.6 values are themselves exact; slice 2b inverts authority and this
/// twin replaces the f64 body rather than living beside it.
pub(crate) fn layout_next_line_integer(
    clusters: &ClusterArena,
    cursor: &mut LineCursor,
    max_width_units: Option<i64>,
    wrap: u8,
    word_space_shrink_q16: i64,
) -> Result<Option<ComposedLine>, EngineError> {
    if max_width_units.is_some_and(|units| units < 0)
        || !(0..65_536).contains(&word_space_shrink_q16)
        || !matches!(wrap, WRAP_NONE | WRAP_WORD | WRAP_CHARACTER)
    {
        return Err(EngineError::InvalidRequest);
    }
    let count = clusters.starts.len();
    if cursor.cluster > count || clusters.advances_f26.len() != count {
        return Err(EngineError::InvalidRequest);
    }
    if cursor.trailing_empty {
        cursor.trailing_empty = false;
        cursor.cluster = count;
        let text_end = clusters.ends.last().copied().unwrap_or(0);
        let count = u32::try_from(count).map_err(|_| EngineError::ResultTooLarge)?;
        return Ok(Some(ComposedLine {
            cluster_start: count,
            cluster_end: count,
            text_start: text_end,
            text_end,
            advance: 0.0,
            hard_break: false,
        }));
    }
    if cursor.cluster == count {
        return Ok(None);
    }

    let line_start = cursor.cluster;
    let mut advance = 0_i64;
    // The shrink budget accumulates in Q16-scaled layout units WITHOUT per-space
    // truncation, so the overflow comparison is exact integer arithmetic: a review
    // counterexample showed per-space `>> 16` truncation selecting earlier breaks
    // than the f64 semantics whenever space advances carry odd units.
    let mut shrinkable_q16 = 0_i64;
    let mut last_allowed = None;
    let mut last_allowed_advance = 0_i64;
    let mut last_safe = None;
    let mut last_safe_advance = 0_i64;
    let mut selected_end = count;
    let mut selected_advance = 0_i64;

    for index in line_start..count {
        let flags = clusters.flags[index];
        if index > line_start && flags & CLUSTER_SAFE_BEFORE != 0 {
            last_safe = Some(index);
            last_safe_advance = advance;
        }
        let required_break = flags & CLUSTER_REQUIRED_BREAK != 0;
        let cluster_advance = i64::from(clusters.advances_f26[index]);
        let next_advance = advance + cluster_advance;
        let next_shrinkable_q16 = if flags & CLUSTER_SPACE != 0 {
            shrinkable_q16 + cluster_advance * word_space_shrink_q16
        } else {
            shrinkable_q16
        };
        if wrap != WRAP_NONE
            && max_width_units
                .is_some_and(|units| (next_advance << 16) - next_shrinkable_q16 > units << 16)
            && index > line_start
        {
            if let Some(end) = last_allowed.filter(|end| *end > line_start) {
                selected_end = end;
                selected_advance = last_allowed_advance;
            } else if let Some(end) = last_safe.filter(|end| *end > line_start) {
                selected_end = end;
                selected_advance = last_safe_advance;
            } else {
                advance = next_advance;
                if required_break || index + 1 == count {
                    selected_end = index + 1;
                    selected_advance = advance;
                    break;
                }
                continue;
            }
            break;
        }
        advance = next_advance;
        shrinkable_q16 = next_shrinkable_q16;
        if required_break {
            selected_end = index + 1;
            selected_advance = advance;
            break;
        }
        let allowed = match wrap {
            WRAP_WORD => flags & CLUSTER_ALLOWED_BREAK != 0,
            WRAP_CHARACTER => {
                index + 1 == count || clusters.flags[index + 1] & CLUSTER_SAFE_BEFORE != 0
            }
            WRAP_NONE => false,
            _ => unreachable!(),
        };
        if allowed {
            last_allowed = Some(index + 1);
            last_allowed_advance = advance;
        }
        if index + 1 == count {
            selected_advance = advance;
        }
    }

    if selected_end <= line_start {
        selected_end = line_start + 1;
        selected_advance = i64::from(clusters.advances_f26[line_start]);
    }
    let last = selected_end - 1;
    let hard_break = clusters.flags[last] & CLUSTER_HARD_BREAK != 0;
    let text_start = clusters.starts[line_start];
    let text_end = if hard_break {
        clusters.starts[last]
    } else {
        clusters.ends[last]
    };
    cursor.cluster = selected_end;
    cursor.trailing_empty = selected_end == count && hard_break;
    Ok(Some(ComposedLine {
        cluster_start: u32::try_from(line_start).map_err(|_| EngineError::ResultTooLarge)?,
        cluster_end: u32::try_from(selected_end).map_err(|_| EngineError::ResultTooLarge)?,
        text_start,
        text_end,
        advance: scaled_from_layout_units(selected_advance),
        hard_break,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn make_clusters(advances: &[f64], flags: &[u8]) -> ClusterArena {
        let count = advances.len();
        ClusterArena {
            starts: (0..count as u32).collect(),
            ends: (1..=count as u32).collect(),
            advances: advances.to_vec(),
            advances_f26: advances
                .iter()
                .map(|advance| super::super::layout_units::layout_units_from_scaled(*advance))
                .collect(),
            flags: flags.to_vec(),
            style_indexes: vec![0; count],
            source_runs: vec![0; count],
            font_handles: vec![1; count],
            index_at: (0..=count as u32).collect(),
            ..ClusterArena::default()
        }
    }

    /// Clusters whose f64 advances are exactly the dyadic values their F26.6
    /// quantization names, so both fits sum identical quantities and f64 addition
    /// itself is exact: the parity obligation of the integer-layout-units plan.
    fn make_quantized_clusters(advances: &[f64], flags: &[u8]) -> ClusterArena {
        let mut clusters = make_clusters(advances, flags);
        for (advance, units) in clusters.advances.iter_mut().zip(&clusters.advances_f26) {
            *advance = scaled_from_layout_units(i64::from(*units));
        }
        clusters
    }

    fn fit_all(
        clusters: &ClusterArena,
        max_width: f64,
        wrap: u8,
        shrink: f64,
    ) -> alloc::vec::Vec<ComposedLine> {
        let mut cursor = LineCursor::default();
        let mut lines = alloc::vec::Vec::new();
        while let Some(line) = layout_next_line(clusters, &mut cursor, max_width, wrap, shrink).unwrap() {
            lines.push(line);
        }
        lines
    }

    fn fit_all_integer(
        clusters: &ClusterArena,
        max_width_units: Option<i64>,
        wrap: u8,
        shrink_q16: i64,
    ) -> alloc::vec::Vec<ComposedLine> {
        let mut cursor = LineCursor::default();
        let mut lines = alloc::vec::Vec::new();
        while let Some(line) =
            layout_next_line_integer(clusters, &mut cursor, max_width_units, wrap, shrink_q16).unwrap()
        {
            lines.push(line);
        }
        lines
    }

    #[test]
    fn integer_fit_matches_the_f64_fit_exactly_across_a_fractional_width_sweep() {
        use super::super::layout_units::layout_units_from_scaled;
        // Word-shaped advances with spaces, an allowed break per word, one hard
        // break, and deliberately non-dyadic raw values that quantization snaps.
        let mut advances = alloc::vec::Vec::new();
        let mut flags = alloc::vec::Vec::new();
        for word in 0..40 {
            let letters = 2 + (word * 7) % 5;
            for letter in 0..letters {
                advances.push(7.31 + f64::from((word * 13 + letter * 3) % 17) * 0.373);
                flags.push(0);
            }
            advances.push(3.17);
            flags.push(CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE);
            if word == 19 {
                advances.push(0.0);
                flags.push(CLUSTER_HARD_BREAK | CLUSTER_REQUIRED_BREAK);
            }
        }
        let clusters = make_quantized_clusters(&advances, &flags);
        for wrap in [WRAP_WORD, WRAP_CHARACTER, WRAP_NONE] {
            let mut width = 11.0_f64;
            while width < 260.0 {
                // The constraint quantizes once at the boundary; both fits then
                // consume identical dyadic quantities and must agree bit for bit.
                let width_units = i64::from(layout_units_from_scaled(width));
                let scalar = fit_all(&clusters, scaled_from_layout_units(width_units), wrap, 0.0);
                let integer = fit_all_integer(&clusters, Some(width_units), wrap, 0);
                assert_eq!(integer, scalar, "wrap {wrap} width {width}");
                width += 0.107;
            }
        }
        // Unconstrained width agrees as well.
        assert_eq!(
            fit_all_integer(&clusters, None, WRAP_WORD, 0),
            fit_all(&clusters, f64::INFINITY, WRAP_WORD, 0.0),
        );
    }

    #[test]
    fn integer_shrink_matches_f64_shrink_for_odd_units_and_non_dyadic_ratios() {
        use super::super::layout_units::{layout_units_from_scaled, ratio_q16};
        // The Sol review's counterexample: one-unit spaces at width 64 units with a
        // 0.5 shrink. Per-space truncation broke here; exact Q16 accumulation must
        // agree with the f64 fit evaluated at the dequantized ratio.
        let mut flags = [0_u8; 3];
        flags[0] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        flags[1] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters = make_quantized_clusters(&[1.0 / 64.0, 1.0 / 64.0, 63.0 / 64.0], &flags);
        let scalar = fit_all(&clusters, 1.0, WRAP_WORD, 0.5);
        let integer = fit_all_integer(&clusters, Some(64), WRAP_WORD, 32_768);
        assert_eq!(integer, scalar);
        assert_eq!(integer[0].cluster_end, 3, "shrink admits the third cluster");

        // Non-dyadic declared ratios quantize once at the boundary; both fits then
        // consume the same dequantized fraction and must agree across a sweep of
        // odd-unit space advances and fractional widths.
        for declared in [0.3_f64, 0.37, 0.61] {
            let ratio = ratio_q16(declared);
            let dequantized = ratio as f64 / 65_536.0;
            let mut advances = alloc::vec::Vec::new();
            let mut sweep_flags = alloc::vec::Vec::new();
            for word in 0..24 {
                for letter in 0..3 + (word % 4) {
                    advances.push(5.0 + f64::from((word * 5 + letter) % 9) * 0.359);
                    sweep_flags.push(0);
                }
                advances.push(2.484_375 + f64::from(word % 3) / 64.0);
                sweep_flags.push(CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE);
            }
            let clusters = make_quantized_clusters(&advances, &sweep_flags);
            let mut width = 17.0_f64;
            while width < 130.0 {
                let width_units = i64::from(layout_units_from_scaled(width));
                let scalar = fit_all(
                    &clusters,
                    scaled_from_layout_units(width_units),
                    WRAP_WORD,
                    dequantized,
                );
                let integer = fit_all_integer(&clusters, Some(width_units), WRAP_WORD, ratio);
                assert_eq!(integer, scalar, "ratio {declared} width {width}");
                width += 0.173;
            }
        }
    }

    #[test]
    fn integer_shrink_matches_f64_shrink_when_the_q16_product_is_exact() {
        // Space advances are multiples of 64 units and the ratio is a dyadic 0.5,
        // so the Q16 truncation names the exact product and elastic selection must
        // match the f64 fit at every swept width.
        let mut flags = [0_u8; 10];
        flags[4] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters = make_quantized_clusters(&[1.0; 10], &flags);
        let mut width = 8.0_f64;
        while width < 11.0 {
            let width_units =
                i64::from(super::super::layout_units::layout_units_from_scaled(width));
            let scalar = fit_all(&clusters, scaled_from_layout_units(width_units), WRAP_WORD, 0.5);
            let integer = fit_all_integer(&clusters, Some(width_units), WRAP_WORD, 32_768);
            assert_eq!(integer, scalar, "width {width}");
            width += 0.03125;
        }
    }

    #[test]
    fn declared_word_space_shrink_admits_the_word_that_would_just_overflow() {
        // Ten 1.0-advance clusters with one shrinkable space after "aaaa": at
        // width 9.5 the rigid line breaks after the space, while a 0.5 shrink
        // fraction lends 0.5 back and the whole run fits on one line.
        let mut flags = [0_u8; 10];
        flags[4] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters = make_clusters(&[1.0; 10], &flags);
        let mut rigid = LineCursor::default();
        assert_eq!(
            layout_next_line(&clusters, &mut rigid, 9.5, WRAP_WORD, 0.0)
                .unwrap()
                .unwrap()
                .cluster_end,
            5
        );
        let mut elastic = LineCursor::default();
        let line = layout_next_line(&clusters, &mut elastic, 9.5, WRAP_WORD, 0.5)
            .unwrap()
            .unwrap();
        assert_eq!(line.cluster_end, 10);
        assert_eq!(line.advance, 10.0);
    }

    #[test]
    fn composes_word_character_and_unwrapped_lines_without_allocating() {
        let clusters = make_clusters(
            &[4.0, 4.0, 4.0, 4.0],
            &[
                CLUSTER_SAFE_BEFORE,
                CLUSTER_SAFE_BEFORE | CLUSTER_ALLOWED_BREAK,
                CLUSTER_SAFE_BEFORE,
                CLUSTER_SAFE_BEFORE,
            ],
        );
        let mut cursor = LineCursor::default();
        assert_eq!(
            layout_next_line(&clusters, &mut cursor, 10.0, WRAP_WORD, 0.0).unwrap(),
            Some(ComposedLine {
                cluster_start: 0,
                cluster_end: 2,
                text_start: 0,
                text_end: 2,
                advance: 8.0,
                hard_break: false,
            })
        );
        assert_eq!(
            layout_next_line(&clusters, &mut cursor, 10.0, WRAP_WORD, 0.0)
                .unwrap()
                .unwrap()
                .cluster_end,
            4
        );
        assert_eq!(
            layout_next_line(&clusters, &mut cursor, 10.0, WRAP_WORD, 0.0).unwrap(),
            None
        );

        let mut character = LineCursor::default();
        assert_eq!(
            layout_next_line(&clusters, &mut character, 5.0, WRAP_CHARACTER, 0.0)
                .unwrap()
                .unwrap()
                .cluster_end,
            1
        );
        let mut unwrapped = LineCursor::default();
        assert_eq!(
            layout_next_line(&clusters, &mut unwrapped, 1.0, WRAP_NONE, 0.0)
                .unwrap()
                .unwrap()
                .advance,
            16.0
        );

        let unsafe_boundary = make_clusters(
            &[4.0, 4.0, 4.0],
            &[CLUSTER_SAFE_BEFORE, 0, CLUSTER_SAFE_BEFORE],
        );
        let mut unsafe_cursor = LineCursor::default();
        let line = layout_next_line(&unsafe_boundary, &mut unsafe_cursor, 5.0, WRAP_WORD, 0.0)
            .unwrap()
            .unwrap();
        assert_eq!((line.cluster_end, line.advance), (2, 8.0));

        let oversized = make_clusters(&[7.0, 3.0], &[CLUSTER_SAFE_BEFORE, CLUSTER_SAFE_BEFORE]);
        let mut oversized_cursor = LineCursor::default();
        let line = layout_next_line(&oversized, &mut oversized_cursor, 5.0, WRAP_WORD, 0.0)
            .unwrap()
            .unwrap();
        assert_eq!((line.cluster_end, line.advance), (1, 7.0));
    }

    #[test]
    fn required_break_and_trailing_empty_line_match_paragraph_semantics() {
        let clusters = make_clusters(
            &[3.0, 0.0],
            &[
                CLUSTER_SAFE_BEFORE,
                CLUSTER_SAFE_BEFORE | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK,
            ],
        );
        let mut cursor = LineCursor::default();
        let first = layout_next_line(&clusters, &mut cursor, f64::INFINITY, WRAP_WORD, 0.0)
            .unwrap()
            .unwrap();
        assert_eq!(
            (first.text_start, first.text_end, first.advance),
            (0, 1, 3.0)
        );
        assert!(first.hard_break);
        let trailing = layout_next_line(&clusters, &mut cursor, 0.0, WRAP_WORD, 0.0)
            .unwrap()
            .unwrap();
        assert_eq!((trailing.cluster_start, trailing.cluster_end), (2, 2));
        assert_eq!((trailing.text_start, trailing.text_end), (2, 2));
        assert_eq!(
            layout_next_line(&clusters, &mut cursor, 0.0, WRAP_WORD, 0.0).unwrap(),
            None
        );
    }
}
