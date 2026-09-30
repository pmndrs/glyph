use super::{
    EngineError,
    cluster_state::{
        CHUNK_NEGATIVE_ADVANCE, CLUSTER_ALLOWED_BREAK, CLUSTER_BREAK_CORRECTION,
        CLUSTER_HARD_BREAK, CLUSTER_REQUIRED_BREAK, CLUSTER_SAFE_BEFORE, CLUSTER_SPACE,
        ClusterArena,
    },
    frame::{WRAP_CHARACTER, WRAP_NONE, WRAP_WORD},
    layout_units::{apply_ratio, scaled_from_layout_units},
};

/// What breaking a line at a shaping-unsafe legal boundary changes about that line (#216),
/// in layout units: its advance, its shrinkable space sum, and its hung terminating run.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Correction {
    pub advance: i32,
    pub space: i32,
    pub trailing: i32,
}

impl Correction {
    pub(crate) const ZERO: Self = Self {
        advance: 0,
        space: 0,
        trailing: 0,
    };
}

/// Corrections for boundaries flagged [`CLUSTER_ALLOWED_BREAK`] and [`CLUSTER_BREAK_CORRECTION`].
pub(crate) trait BreakCorrections {
    /// `L(boundary)`: the change to a line that ENDS at cluster boundary `boundary`.
    fn left(&mut self, boundary: usize) -> Result<Correction, EngineError>;
    /// `R(boundary)`: the change to a line that STARTS at cluster boundary `boundary`.
    fn right(&mut self, boundary: usize) -> Result<Correction, EngineError>;
    /// The total for the line `[start, end)` when its head and tail islands overlap, so
    /// `R(start) + L(end)` is not additive (rule 6); `None` when they are independent.
    fn whole_line(&mut self, start: usize, end: usize) -> Result<Option<Correction>, EngineError>;
}

/// Every boundary keeps its base width, as on main.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct NoCorrections;

impl BreakCorrections for NoCorrections {
    fn left(&mut self, _: usize) -> Result<Correction, EngineError> {
        Ok(Correction::ZERO)
    }
    fn right(&mut self, _: usize) -> Result<Correction, EngineError> {
        Ok(Correction::ZERO)
    }
    fn whole_line(&mut self, _: usize, _: usize) -> Result<Option<Correction>, EngineError> {
        Ok(None)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct LineCursor {
    cluster: usize,
    trailing_empty: bool,
    /// `R(cluster)` for the line about to compose (rule 1); zero after an uncorrected end.
    pub(crate) start_correction: Correction,
}

impl LineCursor {
    pub(crate) const fn at_cluster(cluster: usize) -> Self {
        Self {
            cluster,
            trailing_empty: false,
            start_correction: Correction::ZERO,
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
    /// Visible width including any start and end corrections and excluding `hung_advance`.
    pub advance: f64,
    /// Width of the terminating spaces this line still owns but does not charge to
    /// `advance`. Positioning lays them, and in RTL they sit visually first, so the pen
    /// has to discount them or every glyph shifts by their width.
    pub hung_advance: f64,
    pub hard_break: bool,
    /// `R(cluster_start)` charged to this line; zero when a whole-line total replaced it.
    pub start_correction: Correction,
    /// `L(cluster_end)` on top of `start_correction`, or the whole-line total (rule 6).
    pub end_correction: Correction,
}

/// A corrected end's charge: `L(end)` over the seed, or the whole-line total replacing both (rule 6).
#[derive(Clone, Copy)]
enum EndCharge {
    Left(Correction),
    Whole(Correction),
}

impl EndCharge {
    const NONE: Self = Self::Left(Correction::ZERO);
}

/// Running base sums at a candidate end, as main accumulates them; corrections go on top.
#[derive(Clone, Copy, Default)]
struct Base {
    advance: i64,
    space: i64,
}

impl Base {
    const fn new(advance: i64, space: i64) -> Self {
        Self { advance, space }
    }
}

/// The terms charged beyond base widths, applied in one saturation order wherever a width
/// is tested or reported.
#[derive(Clone, Copy)]
struct Charged {
    start: Correction,
    end: Correction,
    seed_trailing: i32,
    end_trailing: i32,
}

impl Charged {
    fn advance(&self, base: i64) -> i64 {
        add(add(base, self.start.advance), self.end.advance)
    }
    fn hung(&self, base: i64) -> i64 {
        add(add(base, self.seed_trailing), self.end_trailing)
    }
    fn visible(&self, trimmed: i64) -> i64 {
        self.advance(trimmed)
            .saturating_sub(i64::from(self.seed_trailing))
            .saturating_sub(i64::from(self.end_trailing))
    }
}

fn add(sum: i64, term: i32) -> i64 {
    sum.saturating_add(i64::from(term))
}

/// One line's fit, shared by the scalar, chunk-64, and indexed kernels, which differ only
/// in how they accumulate base sums. Corrections (#216) enter at the seed (rule 1), the
/// first overflow (rule 2), and the settled end (rule 3); without any, it fits as on main.
struct LineFit<'a, C> {
    clusters: &'a ClusterArena,
    corrections: &'a mut C,
    line_start: usize,
    /// `R(line_start)`: a constant offset added at every test, never folded into the sums.
    seed: Correction,
    max_width_units: Option<i64>,
    word_space_shrink: f64,
    /// Character wrap never charges a correction.
    word_wrap: bool,
    /// Rule 2 is spent once a corrected candidate has been admitted on this line.
    rescued: bool,
}

impl<C: BreakCorrections> LineFit<'_, C> {
    /// A boundary the fitter may break at only by charging its correction.
    fn corrected(&self, boundary: usize) -> bool {
        const CORRECTED: u8 = CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;
        self.word_wrap && boundary > 0 && self.clusters.flags[boundary - 1] & CORRECTED == CORRECTED
    }

    /// The end of `[line_start, end)` with a trailing hard break skipped.
    fn visible_end(&self, end: usize) -> usize {
        let hard = end > self.line_start && self.clusters.flags[end - 1] & CLUSTER_HARD_BREAK != 0;
        end - usize::from(hard)
    }

    fn charged(&self, end: usize, charge: EndCharge) -> Charged {
        let flags = &self.clusters.flags;
        let visible_end = self.visible_end(end);
        let is_space = |index: usize| flags[index] & CLUSTER_SPACE != 0;
        // The seed's delta hangs only while the line is just its terminating run; a
        // whole-line total's only after a hung space.
        match charge {
            EndCharge::Left(left) => Charged {
                start: self.seed,
                end: left,
                seed_trailing: if self.seed.trailing != 0
                    && (self.line_start..visible_end).all(is_space)
                {
                    self.seed.trailing
                } else {
                    0
                },
                end_trailing: left.trailing,
            },
            EndCharge::Whole(whole) => Charged {
                start: Correction::ZERO,
                end: whole,
                seed_trailing: 0,
                end_trailing: if visible_end > self.line_start && is_space(visible_end - 1) {
                    whole.trailing
                } else {
                    0
                },
            },
        }
    }

    /// The chunk-64 and shaping-safe tests: base sums under the seed alone, nothing hung.
    fn fits_seeded(&self, advance: i64, space: i64) -> bool {
        let credit = apply_ratio(add(space, self.seed.space), self.word_space_shrink);
        let width = add(advance, self.seed.advance).saturating_sub(credit);
        self.max_width_units.is_none_or(|units| width <= units)
    }

    /// Whether `[line_start, end)` fits: base sums (`hanging` the base terminating space
    /// run) with the seed and `charge` on top; with none, exactly main's test.
    fn fits(&self, end: usize, base: Base, hanging: i64, charge: EndCharge) -> bool {
        let charged = self.charged(end, charge);
        let hung = charged.hung(hanging);
        let space = add(add(base.space, charged.start.space), charged.end.space);
        let credit = apply_ratio(space.saturating_sub(hung), self.word_space_shrink);
        let width = charged
            .advance(base.advance)
            .saturating_sub(hung)
            .saturating_sub(credit);
        self.max_width_units.is_none_or(|units| width <= units)
    }

    fn end_charge(&mut self, end: usize) -> Result<EndCharge, EngineError> {
        if self.corrected(self.line_start)
            && let Some(whole) = self.corrections.whole_line(self.line_start, end)?
        {
            return Ok(EndCharge::Whole(whole));
        }
        Ok(EndCharge::Left(self.corrections.left(end)?))
    }

    /// Rule 2: whether `end` overflows. Only the FIRST overflowing candidate of a line, at
    /// a corrected boundary, is re-tested with its correction charged (greedy, as CSS wraps).
    fn overflows(&mut self, end: usize, base: Base, hanging: i64) -> Result<bool, EngineError> {
        if self.fits(end, base, hanging, EndCharge::NONE) {
            return Ok(false);
        }
        if self.rescued || !self.corrected(end) {
            return Ok(true);
        }
        let charge = self.end_charge(end)?;
        self.rescued = self.fits(end, base, hanging, charge);
        Ok(!self.rescued)
    }

    /// Rule 3: the selected candidate must fit with its end charged, else it steps back
    /// through the accepted candidates via `step_back` (an uncorrected one fits as it
    /// stands). Yields the end, base advance, charge, and fit; when none fit, the earliest.
    fn settle(
        &mut self,
        first: (usize, Base),
        mut step_back: impl FnMut((usize, Base)) -> Option<(usize, Base)>,
    ) -> Result<(usize, i64, EndCharge, bool), EngineError> {
        let (mut end, mut base) = first;
        loop {
            let mut charge = EndCharge::NONE;
            let mut fits = true;
            if self.corrected(end) {
                charge = self.end_charge(end)?;
                let hanging = trailing_space_units(self.clusters, self.line_start, end);
                fits = self.fits(end, base, hanging, charge);
            }
            match (!fits).then(|| step_back((end, base))).flatten() {
                Some(previous) => (end, base) = previous,
                None => return Ok((end, base.advance, charge, fits)),
            }
        }
    }

    /// Reports the selected line `[line_start, end)` from its base `advance` and seeds the
    /// cursor with `R(end)` (rule 1). The line still CONTAINS its terminating spaces, as
    /// `justifiable_span` assumes, but they contribute no width: they are trimmed one at a
    /// time from the end (main's order, which saturation forbids reordering), then charged.
    fn compose(
        &mut self,
        cursor: &mut LineCursor,
        end: usize,
        advance: i64,
        charge: EndCharge,
    ) -> Result<Option<ComposedLine>, EngineError> {
        let clusters = self.clusters;
        let count = clusters.starts.len();
        if end <= self.line_start || end > count {
            return Err(EngineError::InvalidRequest);
        }
        let mut visible_end = self.visible_end(end);
        let mut visible = advance;
        let mut hung = 0_i64;
        while visible_end > self.line_start && clusters.flags[visible_end - 1] & CLUSTER_SPACE != 0
        {
            let trimmed = clusters.advance_units[visible_end - 1];
            visible = visible.saturating_sub(trimmed);
            hung = hung.saturating_add(trimmed);
            visible_end -= 1;
        }
        let charged = self.charged(end, charge);
        let last = end - 1;
        let hard_break = clusters.flags[last] & CLUSTER_HARD_BREAK != 0;
        let text_end = if hard_break {
            clusters.starts[last]
        } else {
            clusters.ends[last]
        };
        cursor.cluster = end;
        cursor.trailing_empty = end == count && hard_break;
        cursor.start_correction = if self.corrected(end) {
            self.corrections.right(end)?
        } else {
            Correction::ZERO
        };
        Ok(Some(ComposedLine {
            cluster_start: u32::try_from(self.line_start)
                .map_err(|_| EngineError::ResultTooLarge)?,
            cluster_end: u32::try_from(end).map_err(|_| EngineError::ResultTooLarge)?,
            text_start: clusters.starts[self.line_start],
            text_end,
            advance: scaled_from_layout_units(charged.visible(visible)),
            hung_advance: scaled_from_layout_units(charged.hung(hung)),
            hard_break,
            start_correction: charged.start,
            end_correction: charged.end,
        }))
    }
}

// Counts the chunk-64 skips the scalar fit takes on this thread; the skip tests prove
// a corrected start still consumes whole chunks.
#[cfg(test)]
extern crate std;
#[cfg(test)]
std::thread_local! {
    static CHUNK_SKIPS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
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
            start_correction: Correction::ZERO,
            end_correction: Correction::ZERO,
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
        start_correction: Correction::ZERO,
        end_correction: Correction::ZERO,
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
    corrections: &mut impl BreakCorrections,
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
        cursor.start_correction = Correction::ZERO;
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
            start_correction: Correction::ZERO,
            end_correction: Correction::ZERO,
        }));
    }
    if cursor.cluster == count {
        return Ok(None);
    }
    let mut fit = LineFit {
        clusters,
        corrections,
        line_start: cursor.cluster,
        seed: cursor.start_correction,
        max_width_units,
        word_space_shrink,
        word_wrap: wrap == WRAP_WORD,
        rescued: false,
    };
    if fit.word_wrap
        && let Some(line) = layout_next_word_line_indexed(&mut fit, cursor)?
    {
        return Ok(Some(line));
    }
    // The scalar fit owns the safe and emergency chains and starts rule 2 afresh.
    fit.rescued = false;
    layout_next_line_integer_scalar(&mut fit, cursor, wrap)
}

fn layout_next_line_integer_scalar<C: BreakCorrections>(
    fit: &mut LineFit<'_, C>,
    cursor: &mut LineCursor,
    wrap: u8,
) -> Result<Option<ComposedLine>, EngineError> {
    let clusters = fit.clusters;
    let count = clusters.starts.len();
    let line_start = fit.line_start;
    let mut advance = 0_i64;
    // The shrinkable space sum accumulates in raw layout units WITHOUT
    // per-space rounding — a review counterexample showed per-space truncation
    // selecting earlier breaks than the f64 semantics — and the ratio applies
    // to the cumulative sum once per overfull test.
    let mut space_units = 0_i64;
    let mut last_allowed = None;
    let mut last_allowed_base = Base::default();
    // The advance of the space run currently sitting at the end of the accumulated line.
    let mut trailing_space_units = 0_i64;
    let mut last_safe = None;
    let mut last_safe_advance = 0_i64;
    let mut first_safe = None;
    let mut first_safe_advance = 0_i64;
    let mut selected_end = count;
    let mut selected_advance = 0_i64;
    let mut charge = EndCharge::NONE;
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
    let mut pending_allowed: Option<(usize, Base)> = None;
    let mut pending_safe: Option<(usize, Base)> = None;
    // Rule 3 retracts a selection cluster by cluster to the previous allowed boundary.
    let step_back = |(mut end, mut base): (usize, Base)| {
        while end > line_start + 1 {
            end -= 1;
            let cluster_advance = clusters.advance_units[end];
            base.advance = base.advance.saturating_sub(cluster_advance);
            if clusters.flags[end] & CLUSTER_SPACE != 0 {
                base.space = base.space.saturating_sub(cluster_advance);
            }
            if clusters.flags[end - 1] & CLUSTER_ALLOWED_BREAK != 0 {
                return Some((end, base));
            }
        }
        None
    };

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
                    fit.fits_seeded(next_advance, next_space_units)
                } else if !has_spaces {
                    // The tagged auxiliary is this chunk's maximum advance prefix; preceding
                    // spaces contribute constant shrink credit across every local prefix.
                    fit.fits_seeded(
                        advance.saturating_add(clusters.chunk_auxiliary_sums[chunk]),
                        space_units,
                    )
                } else {
                    // Spaces plus a negative advance make hanging-space shrink non-monotonic,
                    // so this rare mixed chunk uses the exact scalar path.
                    false
                };
                if fits {
                    #[cfg(test)]
                    CHUNK_SKIPS.with(|skips| skips.set(skips.get() + 1));
                    let entry = Base::new(advance, space_units);
                    if flags_or & CLUSTER_ALLOWED_BREAK != 0 {
                        pending_allowed = Some((chunk, entry));
                    }
                    if flags_or & CLUSTER_SAFE_BEFORE != 0 {
                        pending_safe = Some((chunk, entry));
                    }
                    trailing_space_units = if has_spaces {
                        trailing_space_units_after_chunk(
                            clusters,
                            index,
                            index + super::cluster_state::LAYOUT_CHUNK,
                            trailing_space_units,
                        )
                    } else {
                        0
                    };
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
            let fits = wrap != WRAP_WORD || fit.fits_seeded(advance, space_units);
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
        // Word wrap fits completed shaped segments after hanging terminal spaces;
        // character wrap retains its per-cluster overflow test.
        let hanging_units = if wrap == WRAP_WORD && word_segment_end {
            next_trailing_space_units
        } else if required_break {
            trailing_space_units
        } else {
            0
        };
        let tests_overflow = match wrap {
            WRAP_WORD => word_segment_end,
            WRAP_CHARACTER => !cluster_is_space,
            WRAP_NONE => false,
            _ => unreachable!(),
        };
        let base = Base::new(next_advance, next_space_units);
        let overflows = tests_overflow
            && index > line_start
            && if wrap == WRAP_WORD {
                fit.overflows(index + 1, base, hanging_units)?
            } else {
                fit.max_width_units.is_some_and(|units| {
                    next_advance
                        .saturating_sub(hanging_units)
                        .saturating_sub(apply_ratio(next_space_units, fit.word_space_shrink))
                        > units
                })
            };
        if overflows {
            // A pending chunk candidate is always later than any recorded scalar
            // candidate, so it resolves first; the safe chain answers when nothing settles.
            let settled = pending_allowed
                .and_then(|(chunk, entry)| {
                    resolve_last_flagged(clusters, chunk, entry, CLUSTER_ALLOWED_BREAK, line_start)
                })
                .or(last_allowed
                    .filter(|end| *end > line_start)
                    .map(|end| (end, last_allowed_base)))
                .map(|first| fit.settle(first, step_back))
                .transpose()?;
            let (end, break_advance, break_charge) =
                if let Some((end, break_advance, break_charge, true)) = settled {
                    (end, break_advance, break_charge)
                } else if let Some((end, entry)) = pending_safe.and_then(|(chunk, entry)| {
                    resolve_last_flagged(clusters, chunk, entry, CLUSTER_SAFE_BEFORE, line_start)
                }) {
                    (end, entry.advance, EndCharge::NONE)
                } else if let Some(end) = last_safe.filter(|end| *end > line_start) {
                    (end, last_safe_advance, EndCharge::NONE)
                } else if let Some(end) = first_safe.filter(|end| *end > line_start) {
                    // If no shaping-safe boundary fits, break at the first one to minimize overflow.
                    (end, first_safe_advance, EndCharge::NONE)
                } else if let Some((end, break_advance, break_charge, false)) = settled {
                    (end, break_advance, break_charge)
                } else {
                    advance = next_advance;
                    if !(word_segment_end || required_break || index + 1 == count) {
                        index += 1;
                        continue;
                    }
                    // With no earlier legal fallback, keep the first complete word intact.
                    let (end, break_advance, break_charge, _) =
                        fit.settle((index + 1, base), |_| None)?;
                    (end, break_advance, break_charge)
                };
            selected_end = end;
            selected_advance = break_advance;
            charge = break_charge;
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
            last_allowed_base = Base::new(advance, space_units);
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
    fit.compose(cursor, selected_end, selected_advance, charge)
}

/// The sparse word-index twin of the scalar word fit. `None` hands the line to the scalar
/// fit: no index, a line off a record boundary, a first record that overflows even
/// corrected, or a selection whose corrected candidates are all exhausted.
fn layout_next_word_line_indexed<C: BreakCorrections>(
    fit: &mut LineFit<'_, C>,
    cursor: &mut LineCursor,
) -> Result<Option<ComposedLine>, EngineError> {
    let clusters = fit.clusters;
    let line_start = fit.line_start;
    let first_break = clusters
        .word_breaks
        .partition_point(|record| record.cluster_end as usize <= line_start);
    let aligned = first_break
        .checked_sub(1)
        .map_or(line_start == 0, |previous| {
            clusters.word_breaks[previous].cluster_end as usize == line_start
        });
    if clusters.word_breaks.is_empty() || !aligned {
        return Ok(None);
    }
    let mut selected: Option<(usize, usize)> = None;
    let mut base = Base::default();
    for index in first_break..clusters.word_breaks.len() {
        let record = clusters.word_breaks[index];
        let end = usize::try_from(record.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        let next = Base::new(
            base.advance.saturating_add(i64::from(record.advance_units)),
            base.space.saturating_add(i64::from(record.space_units)),
        );
        if fit.overflows(end, next, trailing_space_units(clusters, line_start, end))? {
            let Some((mut index, end)) = selected else {
                return Ok(None);
            };
            // Rule 3 retracts a selection one record at a time.
            let (end, advance, charge, fits) = fit.settle((end, base), |(_, base)| {
                (index > first_break).then(|| {
                    let record = clusters.word_breaks[index];
                    index -= 1;
                    let base = Base::new(
                        base.advance.saturating_sub(i64::from(record.advance_units)),
                        base.space.saturating_sub(i64::from(record.space_units)),
                    );
                    (clusters.word_breaks[index].cluster_end as usize, base)
                })
            })?;
            if !fits {
                return Ok(None);
            }
            return fit.compose(cursor, end, advance, charge);
        }
        base = next;
        selected = Some((index, end));
        if clusters.flags[end - 1] & (CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) != 0
            || end == clusters.starts.len()
        {
            break;
        }
    }
    let (_, selected_end) = selected.ok_or(EngineError::InvalidRequest)?;
    fit.compose(cursor, selected_end, base.advance, EndCharge::NONE)
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

/// Returns the exact trailing-space run after a chunk; incoming space carries only through an all-space chunk.
/// No-space chunks clear without reading per-cluster lanes, while other chunks read only their trailing suffix.
fn trailing_space_units_after_chunk(
    clusters: &ClusterArena,
    start: usize,
    mut end: usize,
    incoming: i64,
) -> i64 {
    if clusters.flags[end - 1] & CLUSTER_SPACE == 0 {
        return 0;
    }
    let mut trailing = 0_i64;
    while end > start && clusters.flags[end - 1] & CLUSTER_SPACE != 0 {
        trailing = trailing.saturating_add(clusters.advance_units[end - 1]);
        end -= 1;
    }
    if end == start {
        incoming.saturating_add(trailing)
    } else {
        trailing
    }
}

/// Resolves the deferred break candidate inside a fully consumed chunk: the LAST
/// cluster carrying `flag`, with the exact prefix sums the scalar loop would have
/// recorded there. Allowed breaks break after their cluster; safe breaks break
/// before theirs, so their prefix excludes the flagged cluster.
fn resolve_last_flagged(
    clusters: &ClusterArena,
    chunk: usize,
    mut base: Base,
    flag: u8,
    line_start: usize,
) -> Option<(usize, Base)> {
    let start = chunk * super::cluster_state::LAYOUT_CHUNK;
    let end = start + super::cluster_state::LAYOUT_CHUNK;
    let position = (start..end).rev().find(|&index| {
        clusters.flags[index] & flag != 0 && (flag != CLUSTER_SAFE_BEFORE || index > line_start)
    })?;
    let prefix_end = if flag == CLUSTER_SAFE_BEFORE {
        position
    } else {
        position + 1
    };
    for index in start..prefix_end {
        let cluster_advance = clusters.advance_units[index];
        base.advance = base.advance.saturating_add(cluster_advance);
        if clusters.flags[index] & CLUSTER_SPACE != 0 {
            base.space = base.space.saturating_add(cluster_advance);
        }
    }
    let break_at = if flag == CLUSTER_SAFE_BEFORE {
        position
    } else {
        position + 1
    };
    Some((break_at, base))
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
        while let Some(line) = layout_next_line_integer(
            clusters,
            &mut cursor,
            max_width_units,
            wrap,
            shrink,
            &mut NoCorrections,
        )
        .unwrap()
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
    fn exact_integer_fit_edge_is_inclusive_and_stable() {
        let full_width_units = 39_000_001_i64;
        let first_word_units = 6_553_600_i64;
        let mut advances = vec![0.0; 65];
        advances[0] = scaled_from_layout_units(first_word_units);
        advances[64] = scaled_from_layout_units(full_width_units - first_word_units);
        let mut flags = vec![0; 65];
        flags[0] = CLUSTER_ALLOWED_BREAK;
        let indexed = make_quantized_clusters(&advances, &flags);
        assert!(!indexed.word_breaks.is_empty());
        let mut scalar = make_quantized_clusters(&advances, &flags);
        scalar.word_breaks.clear();
        scalar.chunk_flags_or.clear();

        for (width_units, expected_end) in [
            (full_width_units - 1, 1),
            (full_width_units, 65),
            (full_width_units + 1, 65),
        ] {
            for clusters in [&indexed, &scalar] {
                let line = layout_next_line_integer(
                    clusters,
                    &mut LineCursor::default(),
                    Some(width_units),
                    WRAP_WORD,
                    0.0,
                    &mut NoCorrections,
                )
                .unwrap()
                .unwrap();
                assert_eq!(line.cluster_end, expected_end, "width {width_units}");
            }
        }
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
            &mut NoCorrections,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            line.cluster_end, 11,
            "the later negative segment cannot pull an overflowing word back"
        );
    }

    fn assert_skipped_chunk_trailing_space_parity(
        advances: &[f64],
        flags: &[u8],
        line_start: usize,
        expected_end: u32,
    ) {
        use super::super::layout_units::layout_units_from_scaled;

        let clusters = make_clusters(advances, flags);
        assert!(clusters.word_breaks.is_empty());
        let width_units = layout_units_from_scaled(5.0);
        let mut chunk_cursor = LineCursor::at_cluster(line_start);
        let chunked = layout_next_line_integer(
            &clusters,
            &mut chunk_cursor,
            Some(width_units),
            WRAP_WORD,
            0.0,
            &mut NoCorrections,
        )
        .unwrap()
        .unwrap();

        let mut scalar = make_clusters(advances, flags);
        scalar.chunk_flags_or.clear();
        let mut scalar_cursor = LineCursor::at_cluster(line_start);
        let scalar = layout_next_line_integer(
            &scalar,
            &mut scalar_cursor,
            Some(width_units),
            WRAP_WORD,
            0.0,
            &mut NoCorrections,
        )
        .unwrap()
        .unwrap();

        let mut f64_cursor = LineCursor::at_cluster(line_start);
        let f64 = layout_next_line(
            &clusters,
            &mut f64_cursor,
            scaled_from_layout_units(width_units),
            WRAP_WORD,
            0.0,
        )
        .unwrap()
        .unwrap();

        assert_eq!(chunked, scalar);
        assert_eq!(chunked, f64);
        assert_eq!(chunked.cluster_end, expected_end);
        assert!(chunked.hard_break);
    }

    #[test]
    fn skipped_no_space_chunk_clears_a_negative_trailing_space() {
        use super::super::cluster_state::LAYOUT_CHUNK;

        let count = LAYOUT_CHUNK * 2 + 1;
        let line_start = LAYOUT_CHUNK - 2;
        let mut advances = vec![0.0; count];
        let mut flags = vec![0; count];
        advances[line_start] = 5.0;
        flags[line_start] = CLUSTER_ALLOWED_BREAK;
        advances[line_start + 1] = -2.0;
        flags[line_start + 1] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        advances[LAYOUT_CHUNK] = -1.0;
        advances[LAYOUT_CHUNK * 2 - 1] = 2.0;
        flags[LAYOUT_CHUNK * 2 - 1] = CLUSTER_ALLOWED_BREAK;
        flags[LAYOUT_CHUNK * 2] = CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK;

        assert_skipped_chunk_trailing_space_parity(&advances, &flags, line_start, count as u32);
    }

    #[test]
    fn skipped_trailing_space_chunk_replaces_an_earlier_negative_space_run() {
        use super::super::cluster_state::LAYOUT_CHUNK;

        let count = LAYOUT_CHUNK * 2 + 1;
        let line_start = LAYOUT_CHUNK - 2;
        let mut advances = vec![0.0; count];
        let mut flags = vec![0; count];
        advances[line_start] = 5.0;
        flags[line_start] = CLUSTER_ALLOWED_BREAK;
        advances[line_start + 1] = -2.0;
        flags[line_start + 1] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        advances[LAYOUT_CHUNK * 2 - 1] = 1.0;
        flags[LAYOUT_CHUNK * 2 - 1] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        flags[LAYOUT_CHUNK * 2] = CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK;

        assert_skipped_chunk_trailing_space_parity(&advances, &flags, line_start, count as u32);
    }

    #[test]
    fn an_all_space_chunk_carries_the_incoming_trailing_run() {
        use super::super::cluster_state::LAYOUT_CHUNK;

        let mut advances = vec![0.0; LAYOUT_CHUNK];
        let flags = vec![CLUSTER_SPACE; LAYOUT_CHUNK];
        advances[LAYOUT_CHUNK - 1] = 1.0;
        let clusters = make_clusters(&advances, &flags);

        assert_eq!(
            trailing_space_units_after_chunk(&clusters, 0, LAYOUT_CHUNK, -2 * 65_536),
            -65_536,
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
        assert_eq!(
            dense.word_sidecar_mode,
            crate::engine::cluster_state::WordSidecarMode::Dense
        );
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
                &mut NoCorrections,
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
        // A later negative adjustment makes the whole second word fit after space compression.
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
            &mut NoCorrections,
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
            &mut NoCorrections,
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
            start_correction: Correction::ZERO,
            end_correction: Correction::ZERO,
        };

        let mut indexed = LineCursor::default();
        assert_eq!(
            layout_next_line_integer(
                &clusters,
                &mut indexed,
                Some(10 * 65_536),
                WRAP_WORD,
                0.0,
                &mut NoCorrections
            )
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
                &mut NoCorrections,
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
            &mut NoCorrections,
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
                start_correction: Correction::ZERO,
                end_correction: Correction::ZERO,
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

    // ---- Break corrections (#216) ------------------------------------------------------

    use alloc::collections::BTreeMap;

    const UNIT: f64 = 1.0 / 65_536.0;

    /// A fixed correction table: `L`/`R` per corrected boundary and optional whole-line
    /// totals per `(start, end)` pair. Counts every fetch so tests can prove the fitter
    /// only asks where a corrected break is evaluated.
    #[derive(Default)]
    struct TableCorrections {
        left: BTreeMap<usize, Correction>,
        right: BTreeMap<usize, Correction>,
        whole: BTreeMap<(usize, usize), Correction>,
        fetches: usize,
    }

    impl BreakCorrections for TableCorrections {
        fn left(&mut self, boundary: usize) -> Result<Correction, EngineError> {
            self.fetches += 1;
            Ok(self.left.get(&boundary).copied().unwrap_or_default())
        }

        fn right(&mut self, boundary: usize) -> Result<Correction, EngineError> {
            self.fetches += 1;
            Ok(self.right.get(&boundary).copied().unwrap_or_default())
        }

        fn whole_line(
            &mut self,
            start: usize,
            end: usize,
        ) -> Result<Option<Correction>, EngineError> {
            Ok(self.whole.get(&(start, end)).copied())
        }
    }

    const fn units(advance: i32, space: i32, trailing: i32) -> Correction {
        Correction {
            advance,
            space,
            trailing,
        }
    }

    fn fit_all_corrected(
        clusters: &ClusterArena,
        max_width_units: Option<i64>,
        shrink: f64,
        corrections: &mut impl BreakCorrections,
    ) -> alloc::vec::Vec<ComposedLine> {
        let mut cursor = LineCursor::default();
        let mut lines = alloc::vec::Vec::new();
        while let Some(line) = layout_next_line_integer(
            clusters,
            &mut cursor,
            max_width_units,
            WRAP_WORD,
            shrink,
            corrections,
        )
        .unwrap()
        {
            lines.push(line);
        }
        lines
    }

    fn is_corrected(clusters: &ClusterArena, end: usize) -> bool {
        const BOTH: u8 = CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;
        end > 0 && clusters.flags[end - 1] & BOTH == BOTH
    }

    #[derive(Debug, Default, PartialEq, Eq)]
    struct ReferenceStats {
        /// Rule 2: first-overflowing candidates admitted by their own correction.
        rescues: usize,
        /// Rule 3: selections that stepped back at least once.
        step_backs: usize,
        /// Rule 3 exhausted: no candidate fit; the earliest was charged.
        exhausted: usize,
        /// Lines priced from a whole-line total (rule 6).
        whole_lines: usize,
    }

    /// Which correction a candidate's width was computed with.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Charge {
        Plain,
        Left(Correction),
        Whole(Correction),
    }

    /// One candidate line `[start, end)` priced from first principles: base cluster
    /// sums plus the seed `R(start)` plus `L(end)`, or base plus the whole-line total
    /// when both islands overlap (the total REPLACES seed and `L`). The hung width is
    /// the terminating space run; the seed's trailing delta counts only while the line
    /// is nothing but that run, the whole-line trailing delta only when the line ends
    /// in hung space. All sums saturate in `i64`: base sums first, in cluster order,
    /// then each correction term. The reported visible width trims the terminating
    /// spaces off the base advance one cluster at a time from the end — main's order,
    /// which saturating arithmetic does not let us reorder — before the corrections.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct CandidateWidth {
        /// Hung terminating width including corrections.
        hung: i64,
        /// Width charged against the measure.
        effective: i64,
        /// Reported visible width.
        visible: i64,
        start_correction: Correction,
        end_correction: Correction,
    }

    /// The brute-force word fit the three kernels must reproduce. It shares no helper
    /// with the fitter: every candidate is priced from scratch, and the plan's greedy
    /// rules are applied literally — seed with `R(start)`; test on base widths; at the
    /// FIRST overflowing candidate, and at most once per line, re-test a corrected
    /// boundary with its correction and accept it if that fits; the selected candidate
    /// must fit with its correction or the selection steps back through the accepted
    /// candidates; when none fits, the earliest is charged. The corpus must carry no
    /// shaping-safe flags, so main's safe chain never engages.
    fn reference_word_lines(
        clusters: &ClusterArena,
        max_width_units: Option<i64>,
        shrink: f64,
        table: &TableCorrections,
    ) -> (alloc::vec::Vec<ComposedLine>, ReferenceStats) {
        assert!(
            clusters
                .flags
                .iter()
                .all(|flags| flags & CLUSTER_SAFE_BEFORE == 0),
            "the reference models no safe chain"
        );
        let count = clusters.starts.len();
        let flagged = |index: usize, flag: u8| clusters.flags[index] & flag != 0;
        let corrected = |end: usize| {
            end > 0
                && flagged(end - 1, CLUSTER_ALLOWED_BREAK)
                && flagged(end - 1, CLUSTER_BREAK_CORRECTION)
        };
        let overflows = |width: i64| max_width_units.is_some_and(|units| width > units);

        // Price `[start, end)` under one charge.
        let price = |start: usize, end: usize, seed: Correction, charge: Charge| {
            let mut base_advance = 0_i64;
            let mut base_space = 0_i64;
            for index in start..end {
                base_advance = base_advance.saturating_add(clusters.advance_units[index]);
                if flagged(index, CLUSTER_SPACE) {
                    base_space = base_space.saturating_add(clusters.advance_units[index]);
                }
            }
            let mut visible_end = end;
            if visible_end > start && flagged(visible_end - 1, CLUSTER_HARD_BREAK) {
                visible_end -= 1;
            }
            let ends_in_space = visible_end > start && flagged(visible_end - 1, CLUSTER_SPACE);
            let mut base_trailing = 0_i64;
            let mut base_visible = base_advance;
            while visible_end > start && flagged(visible_end - 1, CLUSTER_SPACE) {
                let trimmed = clusters.advance_units[visible_end - 1];
                base_trailing = base_trailing.saturating_add(trimmed);
                base_visible = base_visible.saturating_sub(trimmed);
                visible_end -= 1;
            }
            let only_spaces = visible_end == start;
            let seed_trailing = if only_spaces {
                i64::from(seed.trailing)
            } else {
                0
            };
            let add = |sum: i64, term: i32| sum.saturating_add(i64::from(term));
            let (total, space, hung, visible, start_correction, end_correction) = match charge {
                Charge::Plain => (
                    add(base_advance, seed.advance),
                    add(base_space, seed.space),
                    base_trailing.saturating_add(seed_trailing),
                    add(base_visible, seed.advance).saturating_sub(seed_trailing),
                    seed,
                    Correction::ZERO,
                ),
                Charge::Left(left) => (
                    add(add(base_advance, seed.advance), left.advance),
                    add(add(base_space, seed.space), left.space),
                    add(base_trailing.saturating_add(seed_trailing), left.trailing),
                    add(add(base_visible, seed.advance), left.advance)
                        .saturating_sub(seed_trailing)
                        .saturating_sub(i64::from(left.trailing)),
                    seed,
                    left,
                ),
                Charge::Whole(whole) => {
                    let whole_trailing = if ends_in_space {
                        i64::from(whole.trailing)
                    } else {
                        0
                    };
                    (
                        add(base_advance, whole.advance),
                        add(base_space, whole.space),
                        base_trailing.saturating_add(whole_trailing),
                        add(base_visible, whole.advance).saturating_sub(whole_trailing),
                        Correction::ZERO,
                        whole,
                    )
                }
            };
            CandidateWidth {
                hung,
                effective: total
                    .saturating_sub(hung)
                    .saturating_sub(apply_ratio(space.saturating_sub(hung), shrink)),
                visible,
                start_correction,
                end_correction,
            }
        };
        // The charge a corrected end owes on a line from `start`.
        let charge_of = |start: usize, end: usize| {
            if corrected(start)
                && let Some(whole) = table.whole.get(&(start, end))
            {
                Charge::Whole(*whole)
            } else {
                Charge::Left(table.left.get(&end).copied().unwrap_or_default())
            }
        };

        let mut lines = alloc::vec::Vec::new();
        let mut stats = ReferenceStats::default();
        let mut start = 0_usize;
        let mut seed = Correction::ZERO;
        while start < count {
            let mut accepted: alloc::vec::Vec<usize> = alloc::vec::Vec::new();
            let mut rescued = false;
            let mut selection = None;
            let mut settle = false;
            for index in start..count {
                let end = index + 1;
                let required = flagged(index, CLUSTER_REQUIRED_BREAK);
                let allowed = flagged(index, CLUSTER_ALLOWED_BREAK);
                if (allowed || required || end == count)
                    && index > start
                    && overflows(price(start, end, seed, Charge::Plain).effective)
                {
                    let rescue = !rescued
                        && corrected(end)
                        && !overflows(price(start, end, seed, charge_of(start, end)).effective);
                    if rescue {
                        rescued = true;
                        stats.rescues += 1;
                    } else {
                        selection = Some(accepted.last().copied().unwrap_or(end));
                        settle = true;
                        break;
                    }
                }
                if required {
                    selection = Some(end);
                    break;
                }
                if allowed {
                    accepted.push(end);
                }
                if end == count {
                    selection = Some(end);
                }
            }
            let mut end = selection.expect("every line selects an end");
            let mut charge = Charge::Plain;
            if settle {
                let mut remaining = accepted
                    .iter()
                    .position(|candidate| *candidate == end)
                    .map_or(0, |at| at + 1);
                let first = end;
                while corrected(end) {
                    charge = charge_of(start, end);
                    if !overflows(price(start, end, seed, charge).effective) {
                        break;
                    }
                    if remaining <= 1 {
                        stats.exhausted += 1;
                        break;
                    }
                    stats.step_backs += usize::from(end == first);
                    remaining -= 1;
                    end = accepted[remaining - 1];
                    charge = Charge::Plain;
                }
            }
            stats.whole_lines += usize::from(matches!(charge, Charge::Whole(_)));

            let width = price(start, end, seed, charge);
            let last = end - 1;
            let hard_break = flagged(last, CLUSTER_HARD_BREAK);
            lines.push(ComposedLine {
                cluster_start: start as u32,
                cluster_end: end as u32,
                text_start: clusters.starts[start],
                text_end: if hard_break {
                    clusters.starts[last]
                } else {
                    clusters.ends[last]
                },
                advance: scaled_from_layout_units(width.visible),
                hung_advance: scaled_from_layout_units(width.hung),
                hard_break,
                start_correction: width.start_correction,
                end_correction: width.end_correction,
            });
            seed = if corrected(end) {
                table.right.get(&end).copied().unwrap_or_default()
            } else {
                Correction::ZERO
            };
            start = end;
            if start == count && hard_break {
                let text_end = clusters.ends.last().copied().unwrap_or(0);
                lines.push(ComposedLine {
                    cluster_start: count as u32,
                    cluster_end: count as u32,
                    text_start: text_end,
                    text_end,
                    advance: 0.0,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                });
            }
        }
        (lines, stats)
    }

    /// Deterministic 64-bit LCG; `next_below(n)` is uniform enough for a fixture.
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 33
        }

        fn below(&mut self, bound: u64) -> u64 {
            self.next() % bound
        }

        fn signed(&mut self, magnitude: i64) -> i32 {
            (self.below(2 * magnitude as u64 + 1) as i64 - magnitude) as i32
        }
    }

    /// A prose-shaped corpus without safe flags: words of one to six clusters, a hung
    /// space at most word ends, some space-free word ends, a hard break now and then, and
    /// `CLUSTER_BREAK_CORRECTION` on about a third of the allowed boundaries. Advances are
    /// whole layout units so quantization is exact.
    fn corrected_corpus(seed: u64, target: usize) -> (alloc::vec::Vec<f64>, alloc::vec::Vec<u8>) {
        let mut random = Lcg(seed);
        let mut advances = alloc::vec::Vec::new();
        let mut flags = alloc::vec::Vec::new();
        while advances.len() < target {
            let letters = 1 + random.below(6) as usize;
            for _ in 0..letters {
                advances.push((4 * 65_536 + random.below(6 * 65_536) as i64) as f64 * UNIT);
                flags.push(0);
            }
            let corrected = if random.below(3) == 0 {
                CLUSTER_BREAK_CORRECTION
            } else {
                0
            };
            if random.below(5) == 0 {
                *flags.last_mut().unwrap() |= CLUSTER_ALLOWED_BREAK | corrected;
            } else {
                advances.push((2 * 65_536 + random.below(2 * 65_536) as i64) as f64 * UNIT);
                flags.push(CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE | corrected);
            }
            if random.below(40) == 0 {
                advances.push(0.0);
                flags.push(CLUSTER_HARD_BREAK | CLUSTER_REQUIRED_BREAK);
            }
        }
        (advances, flags)
    }

    /// Corrections for every corrected boundary of `clusters`: mostly a fraction of a
    /// word either way, occasionally far too wide to ever fit (exhaustion), plus whole-line
    /// totals for a sample of `(start, end)` pairs.
    fn random_table(seed: u64, clusters: &ClusterArena) -> TableCorrections {
        let mut random = Lcg(seed);
        let mut table = TableCorrections::default();
        let corrected: alloc::vec::Vec<usize> = (1..=clusters.starts.len())
            .filter(|end| is_corrected(clusters, *end))
            .collect();
        for &end in &corrected {
            let wide = random.below(12) == 0;
            let left = if wide {
                units(20 * 65_536, 0, 0)
            } else {
                units(
                    random.signed(3 * 65_536),
                    random.signed(65_536),
                    random.signed(65_536 / 2),
                )
            };
            table.left.insert(end, left);
            table.right.insert(
                end,
                units(
                    random.signed(2 * 65_536),
                    random.signed(65_536 / 2),
                    random.signed(65_536 / 4),
                ),
            );
        }
        for (position, &start) in corrected.iter().enumerate() {
            for &end in corrected.iter().skip(position + 1).take(3) {
                if random.below(2) == 0 {
                    table.whole.insert(
                        (start, end),
                        units(
                            random.signed(4 * 65_536),
                            random.signed(65_536),
                            random.signed(65_536 / 2),
                        ),
                    );
                }
            }
        }
        table
    }

    fn three_kernels(advances: &[f64], flags: &[u8]) -> [(ClusterArena, &'static str); 3] {
        let indexed = make_quantized_clusters(advances, flags);
        assert!(
            !indexed.word_breaks.is_empty(),
            "the corpus must be sparse enough to index"
        );
        let mut chunked = make_quantized_clusters(advances, flags);
        chunked.word_breaks.clear();
        assert!(
            chunked.chunk_flags_or.len() >= 8,
            "the corpus must span chunks"
        );
        let mut scalar = make_quantized_clusters(advances, flags);
        scalar.word_breaks.clear();
        scalar.chunk_flags_or.clear();
        [
            (indexed, "indexed"),
            (chunked, "chunked"),
            (scalar, "scalar"),
        ]
    }

    fn chunk_skips() -> usize {
        CHUNK_SKIPS.with(|skips| skips.get())
    }

    #[test]
    fn a_zero_table_leaves_every_kernel_bit_identical_to_the_uncorrected_fit() {
        let (advances, flags) = corrected_corpus(7, 12 * super::super::cluster_state::LAYOUT_CHUNK);
        for (clusters, name) in three_kernels(&advances, &flags) {
            assert!((1..=clusters.starts.len()).any(|end| is_corrected(&clusters, end)));
            for width in [40.0_f64, 97.3, 233.0, 610.5, 1_597.0] {
                let width_units = super::super::layout_units::layout_units_from_scaled(width);
                for shrink in [0.0_f64, 0.31] {
                    let mut empty = TableCorrections::default();
                    let uncorrected =
                        fit_all_integer(&clusters, Some(width_units), WRAP_WORD, shrink);
                    let zeroed =
                        fit_all_corrected(&clusters, Some(width_units), shrink, &mut empty);
                    assert_eq!(zeroed, uncorrected, "{name} width {width} shrink {shrink}");
                    assert!(zeroed.iter().all(|line| {
                        line.start_correction == Correction::ZERO
                            && line.end_correction == Correction::ZERO
                    }));
                    let reference =
                        reference_word_lines(&clusters, Some(width_units), shrink, &empty).0;
                    assert_eq!(
                        zeroed, reference,
                        "{name} width {width} shrink {shrink} against the reference"
                    );
                }
            }
        }
    }

    #[test]
    fn a_random_table_keeps_scalar_chunked_and_indexed_fits_on_the_reference() {
        let chunk = super::super::cluster_state::LAYOUT_CHUNK;
        let mut total = ReferenceStats::default();
        for seed in [1_u64, 2, 3, 5, 8] {
            let (advances, flags) = corrected_corpus(seed, 14 * chunk);
            for (clusters, name) in three_kernels(&advances, &flags) {
                for width in [37.0_f64, 91.7, 150.0, 333.3, 800.0, 2_500.0] {
                    let width_units = super::super::layout_units::layout_units_from_scaled(width);
                    for shrink in [0.0_f64, 0.27] {
                        let mut table = random_table(seed * 31 + 11, &clusters);
                        let (expected, stats) =
                            reference_word_lines(&clusters, Some(width_units), shrink, &table);
                        let skips_before = chunk_skips();
                        let lines =
                            fit_all_corrected(&clusters, Some(width_units), shrink, &mut table);
                        assert_eq!(
                            lines, expected,
                            "{name} seed {seed} width {width} shrink {shrink}"
                        );
                        if name == "chunked" && width >= 800.0 {
                            assert!(chunk_skips() > skips_before, "{name} must skip chunks");
                        }
                        total.rescues += stats.rescues;
                        total.step_backs += stats.step_backs;
                        total.exhausted += stats.exhausted;
                        total.whole_lines += stats.whole_lines;
                    }
                }
            }
        }
        assert!(
            total.rescues > 0,
            "rule 2 never admitted a candidate: {total:?}"
        );
        assert!(total.step_backs > 0, "rule 3 never stepped back: {total:?}");
        assert!(
            total.exhausted > 0,
            "rule 3 never exhausted a line: {total:?}"
        );
        assert!(
            total.whole_lines > 0,
            "rule 6 never priced a line: {total:?}"
        );
        // Unconstrained width composes one line per paragraph, uncorrected.
        let (advances, flags) = corrected_corpus(13, 8 * chunk);
        for (clusters, name) in three_kernels(&advances, &flags) {
            let mut table = random_table(99, &clusters);
            assert_eq!(
                fit_all_corrected(&clusters, None, 0.0, &mut table),
                reference_word_lines(&clusters, None, 0.0, &table).0,
                "{name} unconstrained"
            );
        }
    }

    #[test]
    fn a_negative_left_correction_admits_the_first_overflowing_candidate() {
        // `aaaa b cc` with hung spaces; the boundary after `b`'s space (7) is corrected.
        // Base `aaaa b` is 6.0 - 0.5 hung = 5.5 wide and the measure is one unit short.
        let mut flags = [0_u8; 10];
        flags[4] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        flags[6] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE | CLUSTER_BREAK_CORRECTION;
        flags[9] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters =
            make_quantized_clusters(&[1.0, 1.0, 1.0, 1.0, 0.5, 1.0, 0.5, 1.0, 1.0, 0.5], &flags);
        let width = 5 * 65_536 + 32_768 - 1;
        let mut table = TableCorrections::default();
        table.left.insert(7, units(-1, 0, 0));
        let lines = fit_all_corrected(&clusters, Some(width), 0.0, &mut table);
        assert_eq!(
            lines
                .iter()
                .map(|line| line.cluster_end)
                .collect::<alloc::vec::Vec<_>>(),
            [7, 10],
            "L(7) = -1 unit makes `aaaa b` fit: {lines:?}"
        );
        assert_eq!(lines[0].end_correction, units(-1, 0, 0));
        assert_eq!(
            lines[0].advance,
            scaled_from_layout_units(5 * 65_536 + 32_768 - 1)
        );
        assert_eq!(lines[0].hung_advance, 0.5);
        assert_eq!(
            table.fetches, 3,
            "one fetch each for rule 2, rule 3, and the next line's seed"
        );

        // A zero correction at the same boundary leaves the base overflow standing and
        // the first word breaks alone, as on main.
        let mut zero = TableCorrections::default();
        let lines = fit_all_corrected(&clusters, Some(width), 0.0, &mut zero);
        assert_eq!(
            lines
                .iter()
                .map(|line| line.cluster_end)
                .collect::<alloc::vec::Vec<_>>(),
            [5, 10]
        );
    }

    #[test]
    fn a_positive_left_correction_on_the_selected_end_steps_the_break_back() {
        // `aaaa bb cc`: boundary 7 fits on base (5.5 of a 6.5 measure) and boundary 10
        // overflows; 7 is corrected and `L(7)` pushes it one unit over the inclusive
        // edge, so the fit steps back to boundary 5, which carries no correction.
        let mut flags = [0_u8; 10];
        flags[4] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        flags[6] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE | CLUSTER_BREAK_CORRECTION;
        flags[9] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters =
            make_quantized_clusters(&[1.0, 1.0, 1.0, 1.0, 0.5, 1.0, 0.5, 1.0, 1.0, 0.5], &flags);
        let width = 6 * 65_536 + 32_768;
        let mut table = TableCorrections::default();
        table.left.insert(7, units(65_536 + 1, 0, 0));
        let lines = fit_all_corrected(&clusters, Some(width), 0.0, &mut table);
        assert_eq!(
            lines
                .iter()
                .map(|line| line.cluster_end)
                .collect::<alloc::vec::Vec<_>>(),
            [5, 10],
            "rule 3 steps back from the corrected boundary: {lines:?}"
        );
        assert_eq!(lines[0].end_correction, Correction::ZERO);

        // The same boundary with `L(7)` fitting settles in place and seeds the next
        // line with `R(7)`, which the next line reports as its start correction.
        let mut table = TableCorrections::default();
        table.left.insert(7, units(-3, 0, 0));
        table.right.insert(7, units(300, 0, 0));
        let lines = fit_all_corrected(&clusters, Some(width), 0.0, &mut table);
        assert_eq!(
            lines
                .iter()
                .map(|line| line.cluster_end)
                .collect::<alloc::vec::Vec<_>>(),
            [7, 10]
        );
        assert_eq!(lines[0].end_correction, units(-3, 0, 0));
        assert_eq!(lines[1].start_correction, units(300, 0, 0));
        assert_eq!(lines[1].advance, scaled_from_layout_units(2 * 65_536 + 300));
    }

    #[test]
    fn a_corrected_start_still_consumes_whole_chunks() {
        let chunk = super::super::cluster_state::LAYOUT_CHUNK;
        // Line 1: one corrected word. Lines after it: many short words spanning six
        // chunks, so the second line's fit must skip chunks while seeded with `R`.
        let mut advances = alloc::vec::Vec::new();
        let mut flags = alloc::vec::Vec::new();
        advances.extend([1.0, 1.0, 0.5]);
        flags.extend([
            0,
            0,
            CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE | CLUSTER_BREAK_CORRECTION,
        ]);
        while advances.len() < 6 * chunk + 3 {
            advances.extend([1.0, 1.0, 1.0, 0.5]);
            flags.extend([0, 0, 0, CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE]);
        }
        let mut clusters = make_quantized_clusters(&advances, &flags);
        clusters.word_breaks.clear();
        let mut table = TableCorrections::default();
        table.right.insert(3, units(3 * 65_536, 65_536, 0));

        let mut cursor = LineCursor::default();
        let first = layout_next_line_integer(
            &clusters,
            &mut cursor,
            Some(2 * 65_536),
            WRAP_WORD,
            0.0,
            &mut table,
        )
        .unwrap()
        .unwrap();
        assert_eq!(first.cluster_end, 3);
        assert_eq!(cursor.start_correction, units(3 * 65_536, 65_536, 0));

        let skips_before = chunk_skips();
        let second = layout_next_line_integer(
            &clusters,
            &mut cursor,
            Some(200 * 65_536),
            WRAP_WORD,
            0.0,
            &mut table,
        )
        .unwrap()
        .unwrap();
        assert!(
            chunk_skips() >= skips_before + 2,
            "the seeded line must still take the chunk-64 path"
        );
        assert_eq!(second.start_correction, units(3 * 65_536, 65_536, 0));
        // A 200 measure less the 3 seed leaves 197 for whole 3.5 words whose last space
        // hangs: 56 words reach 3 + 196 - 0.5 = 198.5 visible; 57 would reach 202.
        assert_eq!(second.cluster_end, 3 + 56 * 4);
        assert_eq!(second.advance, 198.5);

        let mut scalar = make_quantized_clusters(&advances, &flags);
        scalar.word_breaks.clear();
        scalar.chunk_flags_or.clear();
        let mut scalar_cursor = LineCursor::default();
        let mut scalar_table = TableCorrections::default();
        scalar_table.right.insert(3, units(3 * 65_536, 65_536, 0));
        let mut scalar_lines = alloc::vec::Vec::new();
        for width in [2 * 65_536, 200 * 65_536] {
            scalar_lines.push(
                layout_next_line_integer(
                    &scalar,
                    &mut scalar_cursor,
                    Some(width),
                    WRAP_WORD,
                    0.0,
                    &mut scalar_table,
                )
                .unwrap()
                .unwrap(),
            );
        }
        assert_eq!(scalar_lines, [first, second]);
    }

    #[test]
    fn overlapping_islands_charge_the_whole_line_instead_of_the_sum() {
        // `aa bb cc dd` with hung spaces at a 3-unit measure; boundaries 3 and 9 are
        // corrected. Line 1 is `aa ` and ends at 3, so line 2 starts corrected with
        // `R(3)` = 1 and reaches boundary 9 at 1 + 5 - 0.5 = 5.5 wide.
        let mut flags = [0_u8; 12];
        flags[2] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE | CLUSTER_BREAK_CORRECTION;
        flags[5] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        flags[8] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE | CLUSTER_BREAK_CORRECTION;
        flags[11] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        let clusters = make_quantized_clusters(
            &[1.0, 1.0, 0.5, 1.0, 1.0, 0.5, 1.0, 1.0, 0.5, 1.0, 1.0, 0.5],
            &flags,
        );
        let ends = |lines: &[ComposedLine]| {
            lines
                .iter()
                .map(|line| line.cluster_end)
                .collect::<alloc::vec::Vec<_>>()
        };
        let right = units(65_536, 0, 0);
        let measure = 3 * 65_536;

        // `L(9)` alone would overflow; the whole-line total for (3, 9) fits.
        let mut table = TableCorrections::default();
        table.right.insert(3, right);
        table.left.insert(9, units(65_536, 0, 0));
        table.whole.insert((3, 9), units(-2 * 65_536, 0, 0));
        let lines = fit_all_corrected(&clusters, Some(measure), 0.0, &mut table);
        assert_eq!(ends(&lines), [3, 9, 12], "whole-line total fits: {lines:?}");
        // The total replaces both the seed and `L`, so the line reports it alone.
        assert_eq!(lines[1].start_correction, Correction::ZERO);
        assert_eq!(lines[1].end_correction, units(-2 * 65_536, 0, 0));
        assert_eq!(lines[1].advance, 2.5);

        // `L(9)` alone would fit; the whole-line total overflows, so the line breaks at
        // 6 instead. Line 3 starts at 6, an uncorrected boundary, so the whole-line
        // table is not consulted there and `L(9)` applies as it stands.
        let mut table = TableCorrections::default();
        table.right.insert(3, right);
        table.left.insert(9, units(-3 * 65_536, 0, 0));
        table.whole.insert((3, 9), units(65_536, 0, 0));
        let lines = fit_all_corrected(&clusters, Some(measure), 0.0, &mut table);
        assert_eq!(
            ends(&lines),
            [3, 6, 9, 12],
            "whole-line total overflows: {lines:?}"
        );
        assert_eq!(lines[1].end_correction, Correction::ZERO);
        assert_eq!(lines[2].start_correction, Correction::ZERO);
        assert_eq!(lines[2].end_correction, units(-3 * 65_536, 0, 0));
        assert_eq!(lines[2].advance, scaled_from_layout_units(-65_536));
    }

    /// Four 2-unit segments at a 3-unit measure; boundaries 2 and 3 are corrected with
    /// `L(2) = -1` and `L(3) = -3`. Boundary 2 is the first base overflow and is rescued;
    /// boundary 3 overflows too and would also fit with its correction, but rule 2 is
    /// spent, so the line stops at 2. The sparse twin (three-cluster words of the same
    /// widths, padded past one chunk) drives the indexed kernel.
    #[test]
    fn rule_two_rescues_only_the_first_overflowing_candidate() {
        let ends = |lines: &[ComposedLine], take: usize| {
            lines
                .iter()
                .take(take)
                .map(|line| line.cluster_end)
                .collect::<alloc::vec::Vec<_>>()
        };
        let flags = [
            CLUSTER_ALLOWED_BREAK,
            CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION,
            CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION,
            CLUSTER_ALLOWED_BREAK,
        ];
        let clusters = make_quantized_clusters(&[2.0 * UNIT; 4], &flags);
        let mut table = TableCorrections::default();
        table.left.insert(2, units(-1, 0, 0));
        table.left.insert(3, units(-3, 0, 0));
        let lines = fit_all_corrected(&clusters, Some(3), 0.0, &mut table);
        assert_eq!(ends(&lines, 3), [2, 3, 4], "scalar: {lines:?}");
        assert_eq!(lines[0].end_correction, units(-1, 0, 0));

        let words = super::super::cluster_state::LAYOUT_CHUNK / 3 + 4;
        let mut advances = alloc::vec::Vec::new();
        let mut flags = alloc::vec::Vec::new();
        for word in 0..words {
            advances.extend([UNIT, UNIT, 0.0]);
            let corrected = if word == 1 || word == 2 {
                CLUSTER_BREAK_CORRECTION
            } else {
                0
            };
            flags.extend([0, 0, CLUSTER_ALLOWED_BREAK | corrected]);
        }
        let indexed = make_quantized_clusters(&advances, &flags);
        assert!(!indexed.word_breaks.is_empty());
        let mut scalar = make_quantized_clusters(&advances, &flags);
        scalar.word_breaks.clear();
        for (kernel, name) in [(&indexed, "indexed"), (&scalar, "scalar")] {
            let mut table = TableCorrections::default();
            table.left.insert(6, units(-1, 0, 0));
            table.left.insert(9, units(-3, 0, 0));
            let lines = fit_all_corrected(kernel, Some(3), 0.0, &mut table);
            assert_eq!(ends(&lines, 3), [6, 9, 12], "{name}: {lines:?}");
            assert_eq!(
                lines,
                reference_word_lines(kernel, Some(3), 0.0, &table).0,
                "{name} against the reference"
            );
        }
    }

    /// A corrected-start line `[space, letter, space]` seeded `R = (1, 1, 1)` whose end
    /// carries the whole-line total `(2, 2, 2)`: the total replaces the seed, and its
    /// trailing delta hangs because the line ends in hung space, so the visible width is
    /// (3 + 2) - (1 + 2) = 2 and the candidate fits a 2-unit measure.
    #[test]
    fn a_whole_line_total_replaces_the_seed_and_hangs_its_trailing_delta() {
        let flags = [
            CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION,
            CLUSTER_SPACE,
            0,
            CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE | CLUSTER_BREAK_CORRECTION,
            CLUSTER_ALLOWED_BREAK,
            CLUSTER_ALLOWED_BREAK,
        ];
        let clusters = make_quantized_clusters(&[UNIT; 6], &flags);
        let mut table = TableCorrections::default();
        table.right.insert(1, units(1, 1, 1));
        table.whole.insert((1, 4), units(2, 2, 2));
        let lines = fit_all_corrected(&clusters, Some(2), 0.0, &mut table);
        assert_eq!(
            lines
                .iter()
                .map(|line| line.cluster_end)
                .collect::<alloc::vec::Vec<_>>(),
            [1, 4, 6],
            "{lines:?}"
        );
        assert_eq!(lines[1].advance, scaled_from_layout_units(2));
        assert_eq!(lines[1].hung_advance, scaled_from_layout_units(3));
        assert_eq!(lines[1].start_correction, Correction::ZERO);
        assert_eq!(lines[1].end_correction, units(2, 2, 2));
        assert_eq!(
            lines,
            reference_word_lines(&clusters, Some(2), 0.0, &table).0
        );
    }

    /// A whole-line total is charged as-is in `i64`; it is never differenced against
    /// the seed, so extreme `i32` values cannot saturate. The seed `i32::MAX` overflows
    /// the base test; the total `i32::MIN` replaces it and the line prices at
    /// 3 + `i32::MIN`, not at the saturated 3 - 1.
    #[test]
    fn a_whole_line_total_is_charged_without_i32_saturation() {
        let flags = [
            CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION,
            0,
            0,
            CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION,
            CLUSTER_ALLOWED_BREAK,
            CLUSTER_ALLOWED_BREAK,
        ];
        let clusters = make_quantized_clusters(&[UNIT; 6], &flags);
        let mut table = TableCorrections::default();
        table.right.insert(1, units(i32::MAX, 0, 0));
        table.whole.insert((1, 4), units(i32::MIN, 0, 0));
        let lines = fit_all_corrected(&clusters, Some(2), 0.0, &mut table);
        assert_eq!(
            lines
                .iter()
                .map(|line| line.cluster_end)
                .collect::<alloc::vec::Vec<_>>(),
            [1, 4, 6],
            "{lines:?}"
        );
        assert_eq!(
            lines[1].advance,
            scaled_from_layout_units(3 + i64::from(i32::MIN))
        );
        assert_eq!(lines[1].end_correction, units(i32::MIN, 0, 0));
        assert_eq!(
            lines,
            reference_word_lines(&clusters, Some(2), 0.0, &table).0
        );
    }

    /// A seeded line whose base advance saturates: 1,024 clusters of 2^53 units (the
    /// sum reaches 2^63 and saturates to `i64::MAX`) after a one-unit word, the cursor
    /// seeded with `R = (1, 0, 0)` from a corrected break, the final boundary corrected
    /// with a zero whole-line total, and a measure of `i64::MAX - 1`. The saturated
    /// base cannot be recovered by subtracting the seed from a seeded running sum: the
    /// whole-line total is priced from the base itself, overflows, and the line breaks
    /// at the one-unit word.
    #[test]
    fn a_saturated_base_prices_a_whole_line_total_from_the_base_itself() {
        let count = 2 + 1_024;
        let mut advances = alloc::vec![(1_u64 << 53) as f64 * UNIT; count];
        advances[0] = UNIT;
        advances[1] = UNIT;
        let mut flags = alloc::vec![0_u8; count];
        flags[0] = CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;
        flags[1] = CLUSTER_ALLOWED_BREAK;
        flags[count - 1] = CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;
        let chunked = make_quantized_clusters(&advances, &flags);
        assert!(
            chunked.word_breaks.is_empty(),
            "the i32 sidecar cannot hold 2^53"
        );
        let mut scalar = make_quantized_clusters(&advances, &flags);
        scalar.chunk_flags_or.clear();
        for (clusters, name) in [(&chunked, "chunked"), (&scalar, "scalar")] {
            let mut table = TableCorrections::default();
            table.whole.insert((1, count), Correction::ZERO);
            let mut cursor = LineCursor {
                cluster: 1,
                trailing_empty: false,
                start_correction: units(1, 0, 0),
            };
            let line = layout_next_line_integer(
                clusters,
                &mut cursor,
                Some(i64::MAX - 1),
                WRAP_WORD,
                0.0,
                &mut table,
            )
            .unwrap()
            .unwrap();
            assert_eq!(line.cluster_end, 2, "{name}: {line:?}");
            assert_eq!(line.advance, scaled_from_layout_units(2), "{name}");
            assert_eq!(line.start_correction, units(1, 0, 0), "{name}");
            assert_eq!(line.end_correction, Correction::ZERO, "{name}");
        }
    }

    /// `NoCorrections` stays bit-identical to main at saturating magnitudes. Main trims
    /// the terminating spaces off the selected advance one cluster at a time, and
    /// saturating subtraction is not associative: 1,024 hung spaces of 2^53 units sum
    /// to a saturated `i64::MAX` advance and a saturated `i64::MAX` hung run, but the
    /// sequential trim lands on `i64::MAX - 1024 * 2^53 = -1`, not `MAX - MAX = 0`.
    /// Expected values are main's, derived from its trimming loop
    /// (`git show origin/main:packages/glyph/rust/shaper/src/engine/line_composition.rs`,
    /// `while visible_end > line_start && ... CLUSTER_SPACE`).
    #[test]
    fn uncorrected_trailing_space_trimming_matches_main_at_saturation() {
        let count = 1_024;
        let clusters = make_clusters(
            &alloc::vec![f64::MAX; count],
            &alloc::vec![CLUSTER_SPACE; count],
        );
        assert!(clusters.advance_units.iter().all(|units| *units == 1 << 53));
        let mut scalar = make_clusters(
            &alloc::vec![f64::MAX; count],
            &alloc::vec![CLUSTER_SPACE; count],
        );
        scalar.chunk_flags_or.clear();
        let expected = ComposedLine {
            cluster_start: 0,
            cluster_end: count as u32,
            text_start: 0,
            text_end: count as u32,
            advance: scaled_from_layout_units(-1),
            hung_advance: scaled_from_layout_units(i64::MAX),
            hard_break: false,
            start_correction: Correction::ZERO,
            end_correction: Correction::ZERO,
        };
        for wrap in [WRAP_NONE, WRAP_WORD] {
            for (kernel, name) in [(&clusters, "chunked"), (&scalar, "scalar")] {
                assert_eq!(
                    fit_all_integer(kernel, None, wrap, 0.0),
                    [expected],
                    "{name} wrap {wrap}"
                );
            }
        }
        // The oracle prices the same corpus the same way.
        assert_eq!(
            reference_word_lines(&clusters, None, 0.0, &TableCorrections::default()).0,
            [expected]
        );
    }
}
