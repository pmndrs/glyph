use super::{
    EngineError,
    cluster_state::{
        CHUNK_NEGATIVE_ADVANCE, CLUSTER_ALLOWED_BREAK, CLUSTER_HARD_BREAK, CLUSTER_REQUIRED_BREAK,
        CLUSTER_SAFE_BEFORE, CLUSTER_SPACE, ClusterArena,
    },
    frame::{WRAP_CHARACTER, WRAP_NONE, WRAP_WORD},
    layout_units::scaled_from_layout_units,
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
    /// Width of the terminating spaces this line still owns but does not charge to
    /// `advance`. Positioning lays them, and in RTL they sit visually first, so the pen
    /// has to discount them or every glyph shifts by their width.
    pub hung_advance: f64,
    pub hard_break: bool,
}

/// The f64 parity reference for [`layout_next_line_integer`]. The integer fit
/// is authoritative (D-254); this twin exists only so the parity property
/// tests can assert the sub-unit tolerance against an independent
/// formulation, and it is compiled out of the shipped module.
#[cfg(test)]
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
            hung_advance: 0.0,
            hard_break: false,
        }));
    }
    if cursor.cluster == count {
        return Ok(None);
    }

    let line_start = cursor.cluster;
    let mut advance = 0.0;
    // The parity twin shares the integer fit's single rounding site: the
    // shrink credit is the exactly-applied ratio over the accumulated space
    // sum, rounded half-up once in unit space. Over quantized (dyadic) inputs
    // the sum-in-units conversion below is exact.
    let mut space_pixels = 0.0_f64;
    let mut last_allowed = None;
    let mut last_allowed_advance = 0.0;
    let mut trailing_space_pixels = 0.0_f64;
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
        // Declared word-space shrink lends back a fraction of the consumed
        // space sum, admitting the word that would otherwise just overflow;
        // the justification pass compresses those spaces to the same bound.
        let next_space_pixels = if flags & CLUSTER_SPACE != 0 {
            space_pixels + clusters.advances[index]
        } else {
            space_pixels
        };
        let shrink_credit =
            super::layout_units::scaled_from_layout_units(super::layout_units::apply_ratio(
                (next_space_pixels * super::layout_units::LAYOUT_UNITS_PER_PIXEL) as i64,
                word_space_shrink,
            ));
        // The f64 parity twin mirrors the integer path exactly, hanging spaces on the
        // same predicate; see the integer loop for why a space cannot overflow.
        let cluster_is_space = flags & CLUSTER_SPACE != 0;
        let hanging = if required_break {
            trailing_space_pixels
        } else {
            0.0
        };
        if wrap != WRAP_NONE
            && !cluster_is_space
            && max_width.is_finite()
            && next_advance - hanging - shrink_credit > max_width
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
        space_pixels = next_space_pixels;
        trailing_space_pixels = if cluster_is_space {
            trailing_space_pixels + clusters.advances[index]
        } else {
            0.0
        };
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
    let mut visible_end = selected_end;
    if visible_end > line_start && clusters.flags[visible_end - 1] & CLUSTER_HARD_BREAK != 0 {
        visible_end -= 1;
    }
    let mut hung_advance = 0.0;
    while visible_end > line_start && clusters.flags[visible_end - 1] & CLUSTER_SPACE != 0 {
        let trimmed = clusters.advances[visible_end - 1];
        selected_advance -= trimmed;
        hung_advance += trimmed;
        visible_end -= 1;
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
        hung_advance,
        hard_break,
    }))
}

/// Integer twin of [`layout_next_line`] over the F16.16 advance stream (slice 2a of
/// the integer-layout-units plan). Widths arrive in layout units; advance and
/// space-sum accumulation is exact `i64` arithmetic, which is what admits the
/// chunk-64 kernels in slice 2b. The declared shrink fraction applies to the
/// accumulated space sum exactly — one IEEE f64 multiply and one round-half-up
/// per comparison through [`super::layout_units::apply_ratio`] — replacing the
/// Q16 budget whose 2^-17 relative ratio error grew past the one-unit tolerance
/// for space sums above ~2^16 units and whose `<<16` comparison overflowed i64
/// inside the admitted magnitude range. The parity harness below proves the
/// selection agrees with the f64 fit over quantized inputs, where f64 sums of
/// dyadic F16.16 values are themselves exact; slice 2b inverts authority and this
/// twin replaces the f64 body rather than living beside it.
pub(crate) fn layout_next_line_integer(
    clusters: &ClusterArena,
    cursor: &mut LineCursor,
    max_width_units: Option<i64>,
    wrap: u8,
    word_space_shrink: f64,
) -> Result<Option<ComposedLine>, EngineError> {
    if wrap == WRAP_WORD && !clusters.word_breaks.is_empty() {
        return layout_next_word_line_indexed(clusters, cursor, max_width_units, word_space_shrink);
    }
    layout_next_line_integer_scalar(clusters, cursor, max_width_units, wrap, word_space_shrink)
}

fn layout_next_line_integer_scalar(
    clusters: &ClusterArena,
    cursor: &mut LineCursor,
    max_width_units: Option<i64>,
    wrap: u8,
    word_space_shrink: f64,
) -> Result<Option<ComposedLine>, EngineError> {
    if max_width_units.is_some_and(|units| units < 0)
        || !(0.0..1.0).contains(&word_space_shrink)
        || !matches!(wrap, WRAP_NONE | WRAP_WORD | WRAP_CHARACTER)
    {
        return Err(EngineError::InvalidRequest);
    }
    let count = clusters.starts.len();
    if cursor.cluster > count || clusters.advance_units.len() != count {
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
            hung_advance: 0.0,
            hard_break: false,
        }));
    }
    if cursor.cluster == count {
        return Ok(None);
    }

    let line_start = cursor.cluster;
    let mut advance = 0_i64;
    // The shrinkable space sum accumulates in raw layout units WITHOUT
    // per-space rounding — a review counterexample showed per-space truncation
    // selecting earlier breaks than the f64 semantics — and the ratio applies
    // to the cumulative sum once per overfull test.
    let mut space_units = 0_i64;
    let mut last_allowed = None;
    let mut last_allowed_advance = 0_i64;
    // The advance of the space run currently sitting at the end of the accumulated line.
    let mut trailing_space_units = 0_i64;
    let mut last_safe = None;
    let mut last_safe_advance = 0_i64;
    let mut first_safe = None;
    let mut first_safe_advance = 0_i64;
    let mut selected_end = count;
    let mut selected_advance = 0_i64;
    // Chunk-64 fast path (D-245, word wrap only): a chunk whose summary fits in
    // full is consumed with three loads instead of sixty-four iterations. The last
    // break candidate inside a skipped chunk is deferred — resolved only if a break
    // is actually needed and no later scalar candidate superseded it, which the
    // monotonic scan guarantees by clearing the pending entry on any later scalar
    // candidate. Exactness holds because integer chunk sums equal the per-cluster
    // sums.
    let chunk_summaries = wrap == WRAP_WORD
        && clusters.chunk_flags_or.len() == count.div_ceil(super::cluster_state::LAYOUT_CHUNK)
        && clusters.chunk_auxiliary_sums.len() == clusters.chunk_flags_or.len();
    let mut pending_allowed: Option<(usize, i64)> = None;
    let mut pending_safe: Option<(usize, i64)> = None;

    let mut index = line_start;
    while index < count {
        if chunk_summaries
            && index.is_multiple_of(super::cluster_state::LAYOUT_CHUNK)
            && index + super::cluster_state::LAYOUT_CHUNK <= count
        {
            let chunk = index / super::cluster_state::LAYOUT_CHUNK;
            let flags_or = clusters.chunk_flags_or[chunk];
            if flags_or & (CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) == 0 {
                let next_advance = advance.saturating_add(clusters.chunk_advance_sums[chunk]);
                let has_spaces = flags_or & CLUSTER_SPACE != 0;
                let next_space_units = if has_spaces {
                    space_units.saturating_add(clusters.chunk_auxiliary_sums[chunk])
                } else {
                    space_units
                };
                let fits = if flags_or & CHUNK_NEGATIVE_ADVANCE == 0 {
                    max_width_units.is_none_or(|units| {
                        next_advance.saturating_sub(super::layout_units::apply_ratio(
                            next_space_units,
                            word_space_shrink,
                        )) <= units
                    })
                } else if !has_spaces {
                    // The tagged auxiliary is this chunk's maximum advance
                    // prefix. Existing spaces precede the chunk, so their
                    // shrink credit is constant across every local prefix.
                    max_width_units.is_none_or(|units| {
                        advance
                            .saturating_add(clusters.chunk_auxiliary_sums[chunk])
                            .saturating_sub(super::layout_units::apply_ratio(
                                space_units,
                                word_space_shrink,
                            ))
                            <= units
                    })
                } else {
                    // Combining spaces with any negative advance can make
                    // hanging-space removal and shrink credit non-monotonic.
                    // Resolve this rare mixed chunk through the exact scalar path.
                    false
                };
                if fits {
                    if flags_or & CLUSTER_ALLOWED_BREAK != 0 {
                        pending_allowed = Some((chunk, advance));
                    }
                    if flags_or & CLUSTER_SAFE_BEFORE != 0 {
                        pending_safe = Some((chunk, advance));
                    }
                    advance = next_advance;
                    space_units = next_space_units;
                    index += super::cluster_state::LAYOUT_CHUNK;
                    continue;
                }
            }
        }
        let flags = clusters.flags[index];
        if index > line_start && flags & CLUSTER_SAFE_BEFORE != 0 {
            if first_safe.is_none() {
                first_safe = Some(index);
                first_safe_advance = advance;
            }
            let fits = wrap != WRAP_WORD
                || max_width_units.is_none_or(|units| {
                    advance.saturating_sub(super::layout_units::apply_ratio(
                        space_units,
                        word_space_shrink,
                    )) <= units
                });
            if fits {
                last_safe = Some(index);
                last_safe_advance = advance;
                pending_safe = None;
            }
        }
        let required_break = flags & CLUSTER_REQUIRED_BREAK != 0;
        let cluster_advance = clusters.advance_units[index];
        let next_advance = advance.saturating_add(cluster_advance);
        let next_space_units = if flags & CLUSTER_SPACE != 0 {
            space_units.saturating_add(cluster_advance)
        } else {
            space_units
        };
        // A word space at a soft wrap hangs: CSS Text 3 removes it from the line it
        // terminates, and this engine's justification pass already trims it before
        // counting (`justifiable_span`). So a space can never overflow the measure --
        // either the line ends here and the space hangs, or the line continues and the
        // space becomes interior, charged by the next non-space cluster's own test.
        // Testing it would refuse words the line has room for, and did.
        let cluster_is_space = flags & CLUSTER_SPACE != 0;
        let next_trailing_space_units = if cluster_is_space {
            trailing_space_units.saturating_add(cluster_advance)
        } else if required_break {
            // A hard-break control does not make the spaces immediately before it
            // interior. They still terminate this line and hang from its measure.
            trailing_space_units
        } else {
            0
        };
        let word_segment_end = wrap == WRAP_WORD
            && (flags & CLUSTER_ALLOWED_BREAK != 0 || required_break || index + 1 == count);
        // Word wrapping evaluates only a completed shaped segment. Its terminating
        // spaces hang and are removed from both visible advance and shrink budget,
        // exactly like the indexed fitter. Character wrap retains its per-cluster
        // overflow test.
        let hanging_units = if wrap == WRAP_WORD && word_segment_end {
            next_trailing_space_units
        } else if required_break {
            trailing_space_units
        } else {
            0
        };
        let visible_space_units = if wrap == WRAP_WORD {
            next_space_units.saturating_sub(hanging_units)
        } else {
            next_space_units
        };
        let tests_overflow = match wrap {
            WRAP_WORD => word_segment_end,
            WRAP_CHARACTER => !cluster_is_space,
            WRAP_NONE => false,
            _ => unreachable!(),
        };
        if tests_overflow
            && max_width_units.is_some_and(|units| {
                next_advance.saturating_sub(hanging_units).saturating_sub(
                    super::layout_units::apply_ratio(visible_space_units, word_space_shrink),
                ) > units
            })
            && index > line_start
        {
            // A pending chunk candidate is always later than any recorded scalar
            // candidate, so it resolves first.
            if let Some((end, break_advance)) = pending_allowed.and_then(|(chunk, entry)| {
                resolve_last_flagged(clusters, chunk, entry, CLUSTER_ALLOWED_BREAK, line_start)
            }) {
                selected_end = end;
                selected_advance = break_advance;
            } else if let Some(end) = last_allowed.filter(|end| *end > line_start) {
                selected_end = end;
                selected_advance = last_allowed_advance;
            } else if let Some((end, break_advance)) = pending_safe.and_then(|(chunk, entry)| {
                resolve_last_flagged(clusters, chunk, entry, CLUSTER_SAFE_BEFORE, line_start)
            }) {
                selected_end = end;
                selected_advance = break_advance;
            } else if let Some(end) = last_safe.filter(|end| *end > line_start) {
                selected_end = end;
                selected_advance = last_safe_advance;
            } else if let Some(end) = first_safe.filter(|end| *end > line_start) {
                // No shaping-safe boundary fits (for example, the first glyph
                // cluster itself is wider than the measure). Break at the first
                // available boundary so unavoidable overflow stays minimal.
                selected_end = end;
                selected_advance = first_safe_advance;
            } else {
                advance = next_advance;
                if (wrap == WRAP_WORD && word_segment_end) || required_break || index + 1 == count {
                    // The first complete word has no earlier legal fallback. Keep
                    // that word intact and let it overflow, instead of carrying an
                    // already-overfull prefix through every later opportunity.
                    selected_end = index + 1;
                    selected_advance = advance;
                    break;
                }
                index += 1;
                continue;
            }
            break;
        }
        advance = next_advance;
        space_units = next_space_units;
        trailing_space_units = next_trailing_space_units;
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
            pending_allowed = None;
        }
        index += 1;
    }
    // A line that runs off the end of the text — including through a final chunk
    // skip, which never executes the per-cluster tail — selects the full advance.
    if index >= count && selected_end == count {
        selected_advance = advance;
    }

    if selected_end <= line_start {
        selected_end = line_start + 1;
        selected_advance = clusters.advance_units[line_start];
    }
    // The line still CONTAINS its terminating spaces -- they keep their clusters and
    // their text range -- but they contribute no width, exactly as `justifiable_span`
    // assumes when it trims them before distributing a deficit. Trimming here rather
    // than during accumulation covers every selection path at once: scalar, resolved
    // chunk candidate, forced overflow, and end of text.
    let mut visible_end = selected_end;
    if visible_end > line_start && clusters.flags[visible_end - 1] & CLUSTER_HARD_BREAK != 0 {
        visible_end -= 1;
    }
    let mut hung_units = 0_i64;
    while visible_end > line_start && clusters.flags[visible_end - 1] & CLUSTER_SPACE != 0 {
        let trimmed = clusters.advance_units[visible_end - 1];
        selected_advance = selected_advance.saturating_sub(trimmed);
        hung_units = hung_units.saturating_add(trimmed);
        visible_end -= 1;
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
        hung_advance: scaled_from_layout_units(hung_units),
        hard_break,
    }))
}

fn layout_next_word_line_indexed(
    clusters: &ClusterArena,
    cursor: &mut LineCursor,
    max_width_units: Option<i64>,
    word_space_shrink: f64,
) -> Result<Option<ComposedLine>, EngineError> {
    if max_width_units.is_some_and(|units| units < 0) || !(0.0..1.0).contains(&word_space_shrink) {
        return Err(EngineError::InvalidRequest);
    }
    let count = clusters.starts.len();
    if cursor.cluster > count || clusters.advance_units.len() != count {
        return Err(EngineError::InvalidRequest);
    }
    if cursor.trailing_empty || cursor.cluster == count {
        return layout_next_line_integer_scalar(
            clusters,
            cursor,
            max_width_units,
            WRAP_WORD,
            word_space_shrink,
        );
    }
    let line_start = cursor.cluster;
    let first_break = clusters
        .word_breaks
        .partition_point(|record| record.cluster_end as usize <= line_start);
    if first_break == 0 {
        if line_start != 0 {
            return layout_next_line_integer_scalar(
                clusters,
                cursor,
                max_width_units,
                WRAP_WORD,
                word_space_shrink,
            );
        }
    } else {
        let previous = clusters.word_breaks[first_break - 1];
        if previous.cluster_end as usize != line_start {
            return layout_next_line_integer_scalar(
                clusters,
                cursor,
                max_width_units,
                WRAP_WORD,
                word_space_shrink,
            );
        }
    }
    let mut selected = None;
    let mut line_advance = 0_i64;
    let mut line_spaces = 0_i64;
    for index in first_break..clusters.word_breaks.len() {
        let record = clusters.word_breaks[index];
        let end = usize::try_from(record.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        let next_advance = line_advance.saturating_add(i64::from(record.advance_units));
        let next_spaces = line_spaces.saturating_add(i64::from(record.space_units));
        let trailing = trailing_space_units(clusters, line_start, end);
        let visible_advance = next_advance.saturating_sub(trailing);
        let visible_spaces = next_spaces.saturating_sub(trailing);
        let effective = visible_advance.saturating_sub(super::layout_units::apply_ratio(
            visible_spaces,
            word_space_shrink,
        ));
        if max_width_units.is_some_and(|width| effective > width) {
            if index == first_break {
                return layout_next_line_integer_scalar(
                    clusters,
                    cursor,
                    max_width_units,
                    WRAP_WORD,
                    word_space_shrink,
                );
            }
            break;
        }
        line_advance = next_advance;
        line_spaces = next_spaces;
        selected = Some((record, line_advance));
        if clusters.flags[end - 1] & (CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) != 0
            || end == count
        {
            break;
        }
    }
    let (record, full_advance) = selected.ok_or(EngineError::InvalidRequest)?;
    let selected_end =
        usize::try_from(record.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
    if selected_end <= line_start || selected_end > count {
        return Err(EngineError::InvalidRequest);
    }
    let last = selected_end - 1;
    let hard_break = clusters.flags[last] & CLUSTER_HARD_BREAK != 0;
    let hung_units = trailing_space_units(clusters, line_start, selected_end);
    let selected_advance = full_advance.saturating_sub(hung_units);
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
        cluster_end: record.cluster_end,
        text_start,
        text_end,
        advance: scaled_from_layout_units(selected_advance),
        hung_advance: scaled_from_layout_units(hung_units),
        hard_break,
    }))
}

fn trailing_space_units(clusters: &ClusterArena, start: usize, mut end: usize) -> i64 {
    if end > start && clusters.flags[end - 1] & CLUSTER_HARD_BREAK != 0 {
        end -= 1;
    }
    let mut trailing = 0_i64;
    while end > start && clusters.flags[end - 1] & CLUSTER_SPACE != 0 {
        trailing = trailing.saturating_add(clusters.advance_units[end - 1]);
        end -= 1;
    }
    trailing
}

/// Resolves the deferred break candidate inside a fully consumed chunk: the LAST
/// cluster carrying `flag`, with the exact prefix advance the scalar loop would have
/// recorded there. Allowed breaks break after their cluster; safe breaks break
/// before theirs, so their prefix excludes the flagged cluster.
fn resolve_last_flagged(
    clusters: &ClusterArena,
    chunk: usize,
    entry_advance: i64,
    flag: u8,
    line_start: usize,
) -> Option<(usize, i64)> {
    let start = chunk * super::cluster_state::LAYOUT_CHUNK;
    let end = start + super::cluster_state::LAYOUT_CHUNK;
    let position = (start..end).rev().find(|&index| {
        clusters.flags[index] & flag != 0 && (flag != CLUSTER_SAFE_BEFORE || index > line_start)
    })?;
    let mut advance = entry_advance;
    let prefix_end = if flag == CLUSTER_SAFE_BEFORE {
        position
    } else {
        position + 1
    };
    for index in start..prefix_end {
        advance = advance.saturating_add(clusters.advance_units[index]);
    }
    let break_at = if flag == CLUSTER_SAFE_BEFORE {
        position
    } else {
        position + 1
    };
    Some((break_at, advance))
}

#[cfg(test)]
mod tests {
    use super::super::cluster_state::WordBreakRecord;
    use super::*;
    use alloc::vec;

    fn make_clusters(advances: &[f64], flags: &[u8]) -> ClusterArena {
        let count = advances.len();
        let mut clusters = ClusterArena {
            starts: (0..count as u32).collect(),
            ends: (1..=count as u32).collect(),
            advances: advances.to_vec(),
            flags: flags.to_vec(),
            style_indexes: vec![0; count],
            source_runs: vec![0; count],
            font_handles: vec![1; count],
            index_at: (0..=count as u32).collect(),
            ..ClusterArena::default()
        };
        clusters.refresh_layout_units().unwrap();
        clusters
    }

    /// Clusters whose f64 advances are exactly the dyadic values their F16.16
    /// quantization names, so both fits sum identical quantities and f64 addition
    /// itself is exact: the parity obligation of the integer-layout-units plan.
    fn make_quantized_clusters(advances: &[f64], flags: &[u8]) -> ClusterArena {
        let mut clusters = make_clusters(advances, flags);
        for (index, advance) in clusters.advances.iter_mut().enumerate() {
            *advance = scaled_from_layout_units(clusters.advance_units[index]);
        }
        clusters.refresh_layout_units().unwrap();
        clusters.ensure_word_breaks().unwrap();
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
        while let Some(line) =
            layout_next_line(clusters, &mut cursor, max_width, wrap, shrink).unwrap()
        {
            lines.push(line);
        }
        lines
    }

    fn fit_all_integer(
        clusters: &ClusterArena,
        max_width_units: Option<i64>,
        wrap: u8,
        shrink: f64,
    ) -> alloc::vec::Vec<ComposedLine> {
        let mut cursor = LineCursor::default();
        let mut lines = alloc::vec::Vec::new();
        while let Some(line) =
            layout_next_line_integer(clusters, &mut cursor, max_width_units, wrap, shrink).unwrap()
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
                flags.push(CLUSTER_SAFE_BEFORE);
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
                let width_units = layout_units_from_scaled(width);
                let scalar = fit_all(&clusters, scaled_from_layout_units(width_units), wrap, 0.0);
                let integer = fit_all_integer(&clusters, Some(width_units), wrap, 0.0);
                assert_eq!(integer, scalar, "wrap {wrap} width {width}");
                width += 0.107;
            }
        }
        // Unconstrained width agrees as well.
        assert_eq!(
            fit_all_integer(&clusters, None, WRAP_WORD, 0.0),
            fit_all(&clusters, f64::INFINITY, WRAP_WORD, 0.0),
        );
    }

    #[test]
    fn chunked_fit_matches_the_scalar_fit_across_multi_chunk_lines() {
        use super::super::cluster_state::LAYOUT_CHUNK;
        use super::super::layout_units::layout_units_from_scaled;
        // ~1,500 clusters so wide lines span many chunks, with words straddling
        // chunk boundaries, shrinkable spaces, and one hard break mid-corpus. The
        // chunked integer fit must select byte-identical lines to the f64 reference
        // at every width, including widths that land the break inside a skipped
        // chunk (deferred resolution) and directly on chunk boundaries.
        let mut advances = alloc::vec::Vec::new();
        let mut flags = alloc::vec::Vec::new();
        let mut word = 0_u32;
        while advances.len() < 24 * LAYOUT_CHUNK {
            for letter in 0..2 + (word % 6) {
                advances.push(4.0 + f64::from((word * 11 + letter * 7) % 13) * 0.417);
                flags.push(CLUSTER_SAFE_BEFORE);
            }
            advances.push(2.75);
            flags.push(CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE);
            if word == 400 {
                advances.push(0.0);
                flags.push(CLUSTER_HARD_BREAK | CLUSTER_REQUIRED_BREAK);
            }
            word += 1;
        }
        let clusters = make_quantized_clusters(&advances, &flags);
        assert!(
            clusters.chunk_flags_or.len() >= 24,
            "the corpus must span many chunks"
        );
        for width in [
            33.0_f64, 129.31, 260.07, 517.5, 1041.13, 2087.0, 4200.9, 8500.0,
        ] {
            let width_units = layout_units_from_scaled(width);
            for shrink in [0.0_f64, 13_107.0 / 65_536.0] {
                let scalar = fit_all(
                    &clusters,
                    scaled_from_layout_units(width_units),
                    WRAP_WORD,
                    shrink,
                );
                let integer = fit_all_integer(&clusters, Some(width_units), WRAP_WORD, shrink);
                assert_eq!(integer, scalar, "width {width} shrink {shrink}");
            }
        }
        // Unconstrained: one line consumes every chunk.
        assert_eq!(
            fit_all_integer(&clusters, None, WRAP_WORD, 0.0),
            fit_all(&clusters, f64::INFINITY, WRAP_WORD, 0.0),
        );
    }

    #[test]
    fn integer_fit_saturates_extreme_caller_derived_advance_sums() {
        let count = 1_025;
        let clusters = make_clusters(&vec![f64::MAX; count], &vec![0; count]);
        for wrap in [WRAP_NONE, WRAP_WORD] {
            let lines = fit_all_integer(&clusters, None, wrap, 0.0);
            assert_eq!(lines.len(), 1);
            assert_eq!(lines[0].cluster_end, count as u32);
            assert_eq!(
                lines[0].advance,
                scaled_from_layout_units(i64::MAX),
                "wrap {wrap} must saturate instead of wrapping the accumulated line advance",
            );
        }
    }

    #[test]
    fn an_oversized_sparse_word_index_falls_back_to_the_exact_scalar_fit() {
        use super::super::layout_units::layout_units_from_scaled;

        let mut flags = [0_u8; 8];
        flags[2] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        flags[7] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters =
            make_quantized_clusters(&[32_768.0, 1.0, 1.0, 2.0, 3.0, 4.0, 5.0, 1.0], &flags);
        assert!(
            clusters.word_breaks.is_empty(),
            "a word advance outside the compact i32 sidecar domain selects the scalar kernel",
        );
        for width in [1.0_f64, 32_767.0, 32_768.0, 32_769.0, 32_770.0, 32_786.0] {
            let width_units = layout_units_from_scaled(width);
            assert_eq!(
                fit_all_integer(&clusters, Some(width_units), WRAP_WORD, 0.0),
                fit_all(
                    &clusters,
                    scaled_from_layout_units(width_units),
                    WRAP_WORD,
                    0.0,
                ),
                "width {width}",
            );
        }
    }

    #[test]
    fn an_oversized_negative_stream_cannot_take_the_monotonic_chunk_path() {
        use super::super::{cluster_state::LAYOUT_CHUNK, layout_units::layout_units_from_scaled};

        let mut advances = vec![0.0; LAYOUT_CHUNK];
        let mut flags = vec![0; LAYOUT_CHUNK];
        advances[10] = 32_768.0;
        flags[10] = CLUSTER_ALLOWED_BREAK;
        advances[20] = -32_768.0;
        flags[20] = CLUSTER_ALLOWED_BREAK;
        flags[LAYOUT_CHUNK - 1] = CLUSTER_ALLOWED_BREAK;
        let mut clusters = make_clusters(&advances, &flags);
        clusters.ensure_word_breaks().unwrap();
        assert!(
            clusters.word_breaks.is_empty(),
            "the first segment exceeds the i32 sidecar domain"
        );
        assert!(clusters.chunk_flags_or[0] & CHUNK_NEGATIVE_ADVANCE != 0);

        let line = layout_next_line_integer(
            &clusters,
            &mut LineCursor::default(),
            Some(layout_units_from_scaled(1.0)),
            WRAP_WORD,
            0.0,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            line.cluster_end, 11,
            "the later negative segment cannot pull an overflowing word back"
        );
    }

    #[test]
    fn dense_negative_chunks_match_scalar_and_f64_without_a_word_sidecar() {
        use super::super::{cluster_state::LAYOUT_CHUNK, layout_units::layout_units_from_scaled};

        let count = LAYOUT_CHUNK * 5;
        let mut advances = vec![1.0; count];
        let mut flags = vec![CLUSTER_SAFE_BEFORE | CLUSTER_ALLOWED_BREAK; count];
        flags[20] |= CLUSTER_SPACE;
        advances[80] = -3.0;
        advances[150] = 0.0;
        flags[150] = CLUSTER_SAFE_BEFORE | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK;
        advances[200] = -0.25;
        flags[200] |= CLUSTER_SPACE;

        let dense = make_quantized_clusters(&advances, &flags);
        assert!(dense.word_breaks.is_empty());
        assert_eq!(dense.word_breaks.capacity(), 0);
        assert!(dense.word_breaks_valid);
        assert!(dense.chunk_flags_or[1] & CHUNK_NEGATIVE_ADVANCE != 0);
        assert_eq!(dense.chunk_flags_or[1] & CLUSTER_SPACE, 0);
        assert_eq!(dense.chunk_auxiliary_sums[1], 60 * 65_536);
        assert_eq!(
            dense.chunk_flags_or[3] & (CHUNK_NEGATIVE_ADVANCE | CLUSTER_SPACE),
            CHUNK_NEGATIVE_ADVANCE | CLUSTER_SPACE,
        );
        assert_eq!(dense.chunk_auxiliary_sums[3], -16_384);

        let mut scalar = make_quantized_clusters(&advances, &flags);
        scalar.chunk_flags_or.clear();
        for width in [1.0_f64, 7.0, 31.0, 63.0, 127.0, 511.0] {
            let width_units = layout_units_from_scaled(width);
            for shrink in [0.0_f64, 0.25, 0.61] {
                let reference = fit_all(
                    &dense,
                    scaled_from_layout_units(width_units),
                    WRAP_WORD,
                    shrink,
                );
                assert_eq!(
                    fit_all_integer(&dense, Some(width_units), WRAP_WORD, shrink),
                    reference,
                    "chunk width {width} shrink {shrink}",
                );
                assert_eq!(
                    fit_all_integer(&scalar, Some(width_units), WRAP_WORD, shrink),
                    reference,
                    "scalar width {width} shrink {shrink}",
                );
            }
        }

        let word_pointer = dense.word_breaks.as_ptr();
        let word_capacity = dense.word_breaks.capacity();
        let chunk_pointer = dense.chunk_auxiliary_sums.as_ptr();
        let chunk_capacity = dense.chunk_auxiliary_sums.capacity();
        for width in 1..=256 {
            let mut cursor = LineCursor::default();
            let mut line_count = 0;
            while let Some(line) = layout_next_line_integer(
                &dense,
                &mut cursor,
                Some(i64::from(width) * 65_536),
                WRAP_WORD,
                0.37,
            )
            .unwrap()
            {
                assert!(line.cluster_end > line.cluster_start);
                line_count += 1;
            }
            assert!(line_count > 0);
        }
        assert_eq!(dense.word_breaks.as_ptr(), word_pointer);
        assert_eq!(dense.word_breaks.capacity(), word_capacity);
        assert_eq!(dense.chunk_auxiliary_sums.as_ptr(), chunk_pointer);
        assert_eq!(dense.chunk_auxiliary_sums.capacity(), chunk_capacity);
    }

    #[test]
    fn sparse_negative_words_keep_index_scalar_and_f64_parity() {
        use super::super::layout_units::layout_units_from_scaled;

        let count = 257;
        let mut advances = vec![1.0; count];
        let mut flags = vec![CLUSTER_SAFE_BEFORE; count];
        for end in (6..count).step_by(7) {
            flags[end] |= CLUSTER_ALLOWED_BREAK;
        }
        flags[20] |= CLUSTER_SPACE;
        advances[9] = -0.5;
        advances[48] = -0.25;
        flags[48] |= CLUSTER_SPACE;
        advances[128] = 0.0;
        flags[128] = CLUSTER_SAFE_BEFORE | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK;

        let indexed = make_quantized_clusters(&advances, &flags);
        assert!(!indexed.word_breaks.is_empty());
        let mut scalar = make_quantized_clusters(&advances, &flags);
        scalar.word_breaks.clear();
        scalar.chunk_flags_or.clear();
        for width in [1.0_f64, 4.0, 8.0, 16.0, 32.0, 128.0] {
            let width_units = layout_units_from_scaled(width);
            for shrink in [0.0_f64, 0.25, 0.61] {
                let reference = fit_all(
                    &indexed,
                    scaled_from_layout_units(width_units),
                    WRAP_WORD,
                    shrink,
                );
                assert_eq!(
                    fit_all_integer(&indexed, Some(width_units), WRAP_WORD, shrink),
                    reference,
                    "indexed width {width} shrink {shrink}",
                );
                assert_eq!(
                    fit_all_integer(&scalar, Some(width_units), WRAP_WORD, shrink),
                    reference,
                    "scalar width {width} shrink {shrink}",
                );
            }
        }
    }

    #[test]
    fn integer_shrink_matches_f64_shrink_for_odd_units_and_non_dyadic_ratios() {
        use super::super::layout_units::{LAYOUT_UNITS_PER_PIXEL, layout_units_from_scaled};
        // The Sol review's counterexample: one-unit spaces at width 65,536 units with a
        // 0.5 shrink. Per-space truncation broke here; the cumulative space sum
        // under the exactly-applied ratio must agree with the f64 fit.
        let mut flags = [0_u8; 3];
        flags[0] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        flags[1] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters = make_quantized_clusters(
            &[
                1.0 / LAYOUT_UNITS_PER_PIXEL,
                1.0 / LAYOUT_UNITS_PER_PIXEL,
                (LAYOUT_UNITS_PER_PIXEL - 1.0) / LAYOUT_UNITS_PER_PIXEL,
            ],
            &flags,
        );
        let scalar = fit_all(&clusters, 1.0, WRAP_WORD, 0.5);
        let integer = fit_all_integer(&clusters, Some(65_536), WRAP_WORD, 0.5);
        assert_eq!(integer, scalar);
        assert_eq!(integer[0].cluster_end, 3, "shrink admits the third cluster");

        // Non-dyadic declared ratios apply exactly — no fixed-point round trip —
        // so both fits consume the same fraction and must agree across a sweep
        // of odd-unit space advances and fractional widths.
        for declared in [0.3_f64, 0.37, 0.61] {
            let dequantized = declared;
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
                let width_units = layout_units_from_scaled(width);
                let scalar = fit_all(
                    &clusters,
                    scaled_from_layout_units(width_units),
                    WRAP_WORD,
                    dequantized,
                );
                let integer = fit_all_integer(&clusters, Some(width_units), WRAP_WORD, declared);
                assert_eq!(integer, scalar, "ratio {declared} width {width}");
                width += 0.173;
            }
        }
    }

    #[test]
    fn integer_shrink_matches_f64_shrink_when_the_product_is_exact() {
        // Space advances are multiples of 64 units and the ratio is a dyadic 0.5,
        // so the exactly-applied product carries no rounding and elastic
        // selection must match the f64 fit at every swept width.
        let mut flags = [0_u8; 10];
        flags[4] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters = make_quantized_clusters(&[1.0; 10], &flags);
        let mut width = 8.0_f64;
        while width < 11.0 {
            let width_units = super::super::layout_units::layout_units_from_scaled(width);
            let scalar = fit_all(
                &clusters,
                scaled_from_layout_units(width_units),
                WRAP_WORD,
                0.5,
            );
            let integer = fit_all_integer(&clusters, Some(width_units), WRAP_WORD, 0.5);
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
    fn word_fit_waits_for_the_shaped_word_before_breaking() {
        // The second word has an early positive cluster followed by a negative
        // shaped adjustment. Its completed advance fits exactly after the
        // declared space compression; breaking at the early crossing leaves
        // avoidable whitespace and disagrees with word-level composition.
        let mut flags = [CLUSTER_SAFE_BEFORE; 8];
        flags[4] |= CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let mut clusters =
            make_quantized_clusters(&[1.0, 1.0, 1.0, 1.0, 1.0, 6.0, -4.0, 1.0], &flags);
        clusters.word_breaks = vec![
            WordBreakRecord {
                cluster_end: 5,
                advance_units: 5 * 65_536,
                space_units: 65_536,
            },
            WordBreakRecord {
                cluster_end: 8,
                advance_units: 3 * 65_536,
                space_units: 0,
            },
        ];
        assert!(!clusters.word_breaks.is_empty());
        let mut cursor = LineCursor::default();
        let line = layout_next_line_integer(
            &clusters,
            &mut cursor,
            Some(super::super::layout_units::layout_units_from_scaled(7.5)),
            WRAP_WORD,
            0.5,
        )
        .unwrap()
        .unwrap();
        assert_eq!(line.cluster_end, 8);
        assert_eq!(line.advance, 8.0);
        let mut scalar_clusters = clusters;
        scalar_clusters.word_breaks.clear();
        let mut scalar_cursor = LineCursor::default();
        let scalar = layout_next_line_integer(
            &scalar_clusters,
            &mut scalar_cursor,
            Some(super::super::layout_units::layout_units_from_scaled(7.5)),
            WRAP_WORD,
            0.5,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            scalar, line,
            "the sparse index is only an optimization and cannot select a different break",
        );
    }

    #[test]
    fn overlong_word_uses_the_last_safe_boundary_inside_the_measure() {
        let mut flags = vec![CLUSTER_SAFE_BEFORE; 81];
        flags[80] |= CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters = make_quantized_clusters(&vec![1.0; 81], &flags);
        assert!(!clusters.word_breaks.is_empty());
        let expected = ComposedLine {
            cluster_start: 0,
            cluster_end: 10,
            text_start: 0,
            text_end: 10,
            advance: 10.0,
            hung_advance: 0.0,
            hard_break: false,
        };

        let mut indexed = LineCursor::default();
        assert_eq!(
            layout_next_line_integer(&clusters, &mut indexed, Some(10 * 65_536), WRAP_WORD, 0.0)
                .unwrap()
                .unwrap(),
            expected,
        );

        let mut scalar_clusters = clusters;
        scalar_clusters.word_breaks.clear();
        let mut integer_scalar = LineCursor::default();
        assert_eq!(
            layout_next_line_integer(
                &scalar_clusters,
                &mut integer_scalar,
                Some(10 * 65_536),
                WRAP_WORD,
                0.0,
            )
            .unwrap()
            .unwrap(),
            expected,
        );
        let mut reference = LineCursor::default();
        assert_eq!(
            layout_next_line(&scalar_clusters, &mut reference, 10.0, WRAP_WORD, 0.0)
                .unwrap()
                .unwrap(),
            expected,
        );
    }

    #[test]
    fn the_line_terminating_space_hangs_instead_of_consuming_the_measure() {
        // "aaaa bbbb": four ink clusters, a space, four more. Every advance is 1.0,
        // so the visible ink of the first word is 4.0 and the space sits at index 4.
        let mut flags = [0_u8; 9];
        flags[4] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters = make_clusters(&[1.0; 9], &flags);

        // At width 4.0 only the first word fits. The line still owns the space
        // cluster, but the space contributes no width -- so the recorded advance is
        // the visible ink, which is what alignment and justification measure against.
        let mut cursor = LineCursor::default();
        let line = layout_next_line(&clusters, &mut cursor, 4.0, WRAP_WORD, 0.0)
            .unwrap()
            .unwrap();
        assert_eq!(line.cluster_end, 5, "the line retains the space cluster");
        assert_eq!(line.advance, 4.0, "the hung space contributes no advance");

        // The integer fit is authoritative and must agree exactly.
        let mut integer_cursor = LineCursor::default();
        let integer = layout_next_line_integer(
            &clusters,
            &mut integer_cursor,
            Some(super::super::layout_units::layout_units_from_scaled(4.0)),
            WRAP_WORD,
            0.0,
        )
        .unwrap()
        .unwrap();
        assert_eq!(integer, line);

        // And the measure the space used to consume is now available to the fit: a
        // width that admits "aaaa" plus the space's worth of ink admits nothing more,
        // but one that admits five ink clusters takes the second word's first cluster
        // rather than stopping a space short of the edge.
        let mut wider = LineCursor::default();
        let wider_line = layout_next_line(&clusters, &mut wider, 5.0, WRAP_WORD, 0.0)
            .unwrap()
            .unwrap();
        assert_eq!(wider_line.cluster_end, 5);
        assert_eq!(wider_line.advance, 4.0);
    }

    #[test]
    fn a_space_before_a_hard_break_hangs_like_any_other_terminating_space() {
        // "ab\n": four units of ink, a one-unit space, then the hard break. At width 4 the
        // visible ink is exactly the measure, so the paragraph is one hard-broken line
        // plus the trailing empty line the hard break implies. Charging the space would
        // overflow at the hard-break cluster and split the line in two.
        let clusters = make_clusters(
            &[4.0, 1.0, 0.0],
            &[
                0,
                CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE,
                CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK | CLUSTER_SAFE_BEFORE,
            ],
        );
        let lines = fit_all(&clusters, 4.0, WRAP_WORD, 0.0);
        assert_eq!(
            lines.len(),
            2,
            "one hard-broken line and its trailing empty line"
        );
        assert_eq!(
            lines[0].cluster_end, 3,
            "the hard break belongs to the line it ends"
        );
        assert_eq!(
            lines[0].advance, 4.0,
            "the space before the hard break hangs"
        );
        assert!(lines[0].hard_break);

        // The integer fit is authoritative and must agree exactly.
        let integer = fit_all_integer(
            &clusters,
            Some(super::super::layout_units::layout_units_from_scaled(4.0)),
            WRAP_WORD,
            0.0,
        );
        assert_eq!(integer, lines);
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
                hung_advance: 0.0,
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
