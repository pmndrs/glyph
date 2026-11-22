//! The one run-local geometry kernel: font-unit glyph lanes in, block-relative f32 rows out.
//!
//! Every client (the paragraph build, line-edge islands and short labels) hands the kernel the
//! same shape of input: parallel glyph lanes in font units, the clusters that own them in visit
//! order, and the scale spans that cover them. The kernel owns the arithmetic and the cut rule;
//! nothing else computes a row.
//!
//! One candidate block (the clusters up to the next cut or detached cluster) is three passes:
//!
//! - **scale**: font units to f64 pixels, one dense loop per scale span;
//! - **chain**: the serial pen over the clusters in visit order, with the block envelope;
//! - **narrow**: subtract the block anchor and narrow to f32, one dense loop per block.
//!
//! The arithmetic is the producer's contract with every retained row: operation order and
//! parenthesization are fixed, so a rebuild from the same font units is bit-identical. Extrema
//! use compare-select, never `f64::min`/`max`: the values are proven finite first, and the sign
//! of a zero extremum cannot reach an anchor (`min + (max - min) * 0.5` is `+0.0` for any pair
//! of zeros).

use alloc::vec::Vec;

use super::run_local::{NumericBlock, NumericBlockSpan, RowLanes, RunLocalBuildError};

/// Where the kernel closes a block.
#[derive(Clone, Copy)]
pub(crate) struct CutRule {
    /// A block closes before every cluster whose ordinal in its run is a multiple of this.
    pub clusters_per_block: usize,
    /// A block closes early when its envelope would exceed twice this on either axis, so every
    /// row stays within this distance of the block anchor.
    pub local_abs_limit: f64,
}

/// Parallel glyph lanes in font units, in the caller's glyph index space.
#[derive(Clone, Copy)]
pub(crate) struct GlyphUnits<'a> {
    pub inline_advance: &'a [i32],
    pub inline_offset: &'a [i32],
    pub block_offset: &'a [i32],
    /// `[inline_min, block_min, inline_max, block_max]` of the glyph's ink, block axis up; all
    /// zero for a glyph without an outline.
    pub ink: &'a [[i16; 4]],
}

/// Glyphs up to `glyph_end` (from the previous span's end) share one scale and baseline shift.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ScaleSpan {
    pub glyph_end: u32,
    /// Pixels per font unit.
    pub scale: f64,
    pub baseline_shift: f64,
}

/// How the pen leaves a cluster.
#[derive(Clone, Copy)]
pub(crate) enum ClusterEnd<'a> {
    /// The pen resynchronizes to the cluster's start plus its own advance.
    Resync(&'a [f64]),
    /// The pen continues from the last glyph, then adds letter and word spacing in that order.
    Continue { letter: &'a [f64], word: &'a [f64] },
}

/// Parallel cluster lanes. A cluster owns `glyph_counts` glyphs from `glyph_starts`, and the
/// glyphs of consecutive clusters are consecutive in glyph order.
#[derive(Clone, Copy)]
pub(crate) struct ClusterLanes<'a> {
    pub glyph_starts: &'a [u32],
    pub glyph_counts: &'a [u32],
    pub flags: &'a [u8],
    /// A cluster with any of these flags is detached: it joins no block and has no rows.
    pub detached_mask: u8,
    pub end: ClusterEnd<'a>,
}

pub(crate) struct RunInput<'a> {
    pub units: GlyphUnits<'a>,
    /// Ascending by `glyph_end`, covering every glyph of the run's attached clusters.
    pub spans: &'a [ScaleSpan],
    pub clusters: ClusterLanes<'a>,
    pub cluster_start: usize,
    pub cluster_end: usize,
    /// Visit clusters from `cluster_end - 1` down: the visual order of a right-to-left run.
    pub reverse: bool,
    pub cut: CutRule,
}

/// Blocks and the cluster-to-block lanes, in visit order across runs.
#[derive(Default)]
pub(crate) struct BlockIndex {
    pub(super) blocks: Vec<NumericBlock>,
    pub(super) cluster_blocks: Vec<u32>,
    pub(super) cluster_prefixes: Vec<f64>,
    /// Rows emitted so far; a block's `row_start`.
    pub(super) row_count: u32,
    /// Glyph index of every row in emission order: the order the capture and tests read.
    #[cfg(any(test, feature = "oracle"))]
    pub(super) row_order: Vec<u32>,
}

impl BlockIndex {
    pub(super) fn clear(&mut self) {
        self.blocks.clear();
        self.cluster_blocks.clear();
        self.cluster_prefixes.clear();
        self.row_count = 0;
        #[cfg(any(test, feature = "oracle"))]
        self.row_order.clear();
    }
}

/// One glyph of the candidate block in f64 pixels. The scale pass fills the first seven fields
/// and the chain pass the last two. Rows, not lanes: every pass here is scalar f64, where one
/// stream per glyph beats nine.
#[derive(Clone, Copy, Default)]
struct Scaled {
    advance: f64,
    inline_offset: f64,
    block_origin: f64,
    ink_inline_offset: f64,
    ink_block_start: f64,
    ink_inline_extent: f64,
    ink_block_extent: f64,
    /// Absolute in the block: the pen plus the glyph's offset.
    inline_origin: f64,
    ink_inline_start: f64,
}

/// The candidate block's glyphs, indexed from its first glyph.
#[derive(Default)]
pub(crate) struct KernelScratch {
    glyphs: Vec<Scaled>,
}

#[inline(always)]
fn lower(current: f64, value: f64) -> f64 {
    if value < current { value } else { current }
}

#[inline(always)]
fn upper(current: f64, value: f64) -> f64 {
    if value > current { value } else { current }
}

/// Inline and block extrema. The block pair is `(INFINITY, NEG_INFINITY)` while nothing with a
/// block position is inside, which unions and admits without a separate flag.
#[derive(Clone, Copy)]
struct Envelope {
    inline_min: f64,
    inline_max: f64,
    block_min: f64,
    block_max: f64,
}

impl Envelope {
    fn point(inline: f64) -> Self {
        Self {
            inline_min: inline,
            inline_max: inline,
            block_min: f64::INFINITY,
            block_max: f64::NEG_INFINITY,
        }
    }

    fn union(self, other: Self) -> Self {
        Self {
            inline_min: lower(self.inline_min, other.inline_min),
            inline_max: upper(self.inline_max, other.inline_max),
            block_min: lower(self.block_min, other.block_min),
            block_max: upper(self.block_max, other.block_max),
        }
    }

    fn admitted(self, cut: CutRule) -> bool {
        let limit = cut.local_abs_limit * 2.0;
        self.inline_max - self.inline_min <= limit && self.block_max - self.block_min <= limit
    }

    /// Whether every position that entered is finite. The scaled glyphs are finite, so a sum
    /// that left the range is an infinity that entered an extremum before it could become a
    /// NaN; a NaN can only come in through a cluster's end, which the pen carries forward.
    fn finite(self, pen: f64, has_rows: bool) -> bool {
        pen.is_finite()
            && self.inline_min.is_finite()
            && self.inline_max.is_finite()
            && (!has_rows || (self.block_min.is_finite() && self.block_max.is_finite()))
    }

    fn anchor(self) -> (f64, f64) {
        (
            self.inline_min + (self.inline_max - self.inline_min) * 0.5,
            self.block_min + (self.block_max - self.block_min) * 0.5,
        )
    }
}

/// The clusters of one candidate block in visit order, and the glyphs they own.
#[derive(Clone, Copy)]
struct Candidate<'a> {
    input: &'a RunInput<'a>,
    /// Ordinals in the run's visit order.
    first: usize,
    count: usize,
    /// First glyph in the caller's glyph index space.
    glyph_base: usize,
    glyph_count: usize,
}

impl Candidate<'_> {
    fn clusters(self) -> impl Iterator<Item = usize> {
        (self.first..self.first + self.count).map(move |ordinal| self.input.cluster_at(ordinal))
    }
}

impl RunInput<'_> {
    #[inline(always)]
    fn cluster_at(&self, ordinal: usize) -> usize {
        if self.reverse {
            self.cluster_end - 1 - ordinal
        } else {
            self.cluster_start + ordinal
        }
    }

    fn detached(&self, cluster: usize) -> bool {
        self.clusters.flags[cluster] & self.clusters.detached_mask != 0
    }

    /// Where the pen leaves `cluster`, entered at `root` and at `pen` after its glyphs.
    #[inline(always)]
    fn cluster_end(&self, cluster: usize, root: f64, pen: f64) -> f64 {
        match self.clusters.end {
            ClusterEnd::Resync(advance) => root + advance[cluster],
            ClusterEnd::Continue { letter, word } => pen + letter[cluster] + word[cluster],
        }
    }
}

/// Lays out one run and appends its blocks, cluster lanes and rows. `rows` must already span
/// the caller's glyph index space; rows are written at their glyph's index.
pub(crate) fn layout_run(
    index: &mut BlockIndex,
    rows: &mut RowLanes,
    scratch: &mut KernelScratch,
    input: &RunInput<'_>,
) -> Result<NumericBlockSpan, RunLocalBuildError> {
    let resume = RunResume {
        ordinal: 0,
        first_block: index.blocks.len(),
        first_cluster: index.cluster_blocks.len(),
    };
    layout_run_from(index, rows, scratch, input, resume)
}

/// Where a run's layout picks up: the first ordinal still to lay out, and where the run's
/// blocks and cluster lanes began. Ordinals before it are already in `index`, exactly as this
/// kernel wrote them.
#[derive(Clone, Copy)]
pub(crate) struct RunResume {
    pub ordinal: usize,
    pub first_block: usize,
    pub first_cluster: usize,
}

/// `layout_run` from `resume.ordinal`, a multiple of the cut's `clusters_per_block`: no block
/// crosses such an ordinal, so the blocks before it depend on nothing after it.
pub(crate) fn layout_run_from(
    index: &mut BlockIndex,
    rows: &mut RowLanes,
    scratch: &mut KernelScratch,
    input: &RunInput<'_>,
    resume: RunResume,
) -> Result<NumericBlockSpan, RunLocalBuildError> {
    let clusters = input.clusters;
    let cluster_count = input
        .cluster_end
        .checked_sub(input.cluster_start)
        .ok_or(RunLocalBuildError::InvalidSource)?;
    let lanes = clusters.glyph_starts.len();
    let end_lanes = match clusters.end {
        ClusterEnd::Resync(advance) => advance.len(),
        ClusterEnd::Continue { letter, word } => letter.len().min(word.len()),
    };
    let glyphs = input.units.inline_advance.len();
    if input.cluster_end > lanes
        || clusters.glyph_counts.len() != lanes
        || clusters.flags.len() != lanes
        || end_lanes < lanes
        || input.units.inline_offset.len() != glyphs
        || input.units.block_offset.len() != glyphs
        || input.units.ink.len() != glyphs
        || rows.len() < glyphs
        || input.cut.clusters_per_block == 0
        || resume.ordinal > cluster_count
        || !resume.ordinal.is_multiple_of(input.cut.clusters_per_block)
        || resume.first_block > index.blocks.len()
        || resume.first_cluster.checked_add(resume.ordinal) != Some(index.cluster_blocks.len())
    {
        return Err(RunLocalBuildError::InvalidSource);
    }
    let RunResume {
        first_block,
        first_cluster,
        ..
    } = resume;
    reserve(&mut index.cluster_blocks, cluster_count - resume.ordinal)?;
    reserve(&mut index.cluster_prefixes, cluster_count - resume.ordinal)?;
    let mut ordinal = resume.ordinal;
    while ordinal < cluster_count {
        if input.detached(input.cluster_at(ordinal)) {
            index.cluster_blocks.push(u32::MAX);
            index.cluster_prefixes.push(0.0);
            ordinal += 1;
            continue;
        }
        let limit = cluster_count
            .min((ordinal / input.cut.clusters_per_block + 1) * input.cut.clusters_per_block);
        let mut stop = ordinal + 1;
        while stop < limit && !input.detached(input.cluster_at(stop)) {
            stop += 1;
        }
        let candidate = candidate(input, ordinal, stop - ordinal, glyphs)?;
        scale_candidate(scratch, candidate)?;
        if !chain_whole(index, rows, scratch, candidate)? {
            chain_split(index, rows, scratch, candidate)?;
        }
        ordinal = stop;
    }
    let count = |len: usize, first: usize| {
        u32::try_from(len - first).map_err(|_| RunLocalBuildError::AllocationFailed)
    };
    Ok(NumericBlockSpan {
        start: u32::try_from(first_block).map_err(|_| RunLocalBuildError::AllocationFailed)?,
        count: count(index.blocks.len(), first_block)?,
        cluster_start: u32::try_from(first_cluster)
            .map_err(|_| RunLocalBuildError::AllocationFailed)?,
        cluster_count: count(index.cluster_blocks.len(), first_cluster)?,
    })
}

/// Proves the candidate's clusters own one contiguous glyph range in visit order: ascending,
/// or descending by cluster for a reversed run. The chain then walks glyphs without checks.
fn candidate<'a>(
    input: &'a RunInput<'a>,
    first: usize,
    count: usize,
    glyphs: usize,
) -> Result<Candidate<'a>, RunLocalBuildError> {
    let clusters = input.clusters;
    let mut candidate = Candidate {
        input,
        first,
        count,
        glyph_base: 0,
        glyph_count: 0,
    };
    // The next glyph a forward walk expects, or the end of the range a reverse walk has left.
    let mut edge = None;
    let mut ordered = true;
    for cluster in candidate.clusters() {
        let owned = clusters.glyph_counts[cluster] as usize;
        if owned == 0 {
            continue;
        }
        let start = clusters.glyph_starts[cluster] as usize;
        if input.reverse {
            ordered &= edge.is_none_or(|edge| start + owned == edge);
            candidate.glyph_base = start;
            edge = Some(start);
        } else {
            ordered &= edge.is_none_or(|edge| start == edge);
            if edge.is_none() {
                candidate.glyph_base = start;
            }
            edge = Some(start + owned);
        }
        candidate.glyph_count += owned;
    }
    if !ordered || candidate.glyph_base + candidate.glyph_count > glyphs {
        return Err(RunLocalBuildError::InvalidSource);
    }
    Ok(candidate)
}

/// Scale pass: every glyph of the candidate, one dense loop per scale span.
fn scale_candidate(
    scratch: &mut KernelScratch,
    candidate: Candidate<'_>,
) -> Result<(), RunLocalBuildError> {
    let Candidate {
        input,
        glyph_base,
        glyph_count,
        ..
    } = candidate;
    if scratch.glyphs.len() < glyph_count {
        let missing = glyph_count - scratch.glyphs.len();
        reserve(&mut scratch.glyphs, missing)?;
        scratch.glyphs.resize(glyph_count, Scaled::default());
    }
    let glyph_end = glyph_base + glyph_count;
    let mut span = input
        .spans
        .partition_point(|span| span.glyph_end as usize <= glyph_base);
    let mut start = glyph_base;
    let mut valid = true;
    while start < glyph_end {
        let ScaleSpan {
            glyph_end: span_end,
            scale,
            baseline_shift,
        } = *input
            .spans
            .get(span)
            .ok_or(RunLocalBuildError::InvalidSource)?;
        let end = glyph_end.min(span_end as usize);
        span += 1;
        // A span that owns no glyph here is never evaluated, so its scale is never judged.
        if end <= start {
            continue;
        }
        if !scale.is_finite() || scale <= 0.0 || !baseline_shift.is_finite() {
            return Err(RunLocalBuildError::InvalidSource);
        }
        valid &= scale_span(
            &mut scratch.glyphs[start - glyph_base..end - glyph_base],
            input.units,
            start..end,
            scale,
            baseline_shift,
        );
        start = end;
    }
    valid.then_some(()).ok_or(RunLocalBuildError::InvalidSource)
}

/// Returns whether every ink box has a non-negative extent on both axes.
fn scale_span(
    scaled: &mut [Scaled],
    units: GlyphUnits<'_>,
    glyphs: core::ops::Range<usize>,
    scale: f64,
    baseline_shift: f64,
) -> bool {
    let lanes = units.inline_advance[glyphs.clone()]
        .iter()
        .zip(&units.inline_offset[glyphs.clone()])
        .zip(&units.block_offset[glyphs.clone()])
        .zip(&units.ink[glyphs]);
    let mut valid = true;
    for (out, (((inline_advance, inline_offset), block_offset), ink)) in
        scaled.iter_mut().zip(lanes)
    {
        let [inline_min, block_min, inline_max, block_max] = *ink;
        // A glyph without an outline has a zero box, so these reduce to the origin exactly.
        let block_origin = 0.0 - f64::from(*block_offset) * scale - baseline_shift;
        out.advance = f64::from(*inline_advance).abs() * scale;
        out.inline_offset = f64::from(*inline_offset) * scale;
        out.block_origin = block_origin;
        out.ink_inline_offset = f64::from(inline_min) * scale;
        out.ink_block_start = block_origin - f64::from(block_max) * scale;
        out.ink_inline_extent = (f64::from(inline_max) - f64::from(inline_min)) * scale;
        out.ink_block_extent = (f64::from(block_max) - f64::from(block_min)) * scale;
        valid &= (inline_max >= inline_min) & (block_max >= block_min);
    }
    valid
}

/// The serial pen through one cluster's glyphs from `root`: writes each glyph's absolute
/// inline origin and ink start, and returns the cluster's envelope and the pen after its
/// glyphs.
#[inline(always)]
fn chain_cluster(glyphs: &mut [Scaled], root: f64) -> (Envelope, f64) {
    let mut pen = root;
    let mut envelope = Envelope::point(root);
    for glyph in glyphs {
        let origin = pen + glyph.inline_offset;
        let ink_start = origin + glyph.ink_inline_offset;
        let ink_end = ink_start + glyph.ink_inline_extent;
        glyph.inline_origin = origin;
        glyph.ink_inline_start = ink_start;
        pen += glyph.advance;
        let ink_block_end = glyph.ink_block_start + glyph.ink_block_extent;
        envelope = Envelope {
            inline_min: lower(
                lower(envelope.inline_min, origin),
                lower(lower(ink_start, ink_end), pen),
            ),
            inline_max: upper(
                upper(envelope.inline_max, origin),
                upper(upper(ink_start, ink_end), pen),
            ),
            block_min: lower(
                lower(envelope.block_min, glyph.block_origin),
                lower(glyph.ink_block_start, ink_block_end),
            ),
            block_max: upper(
                upper(envelope.block_max, glyph.block_origin),
                upper(glyph.ink_block_start, ink_block_end),
            ),
        };
    }
    (envelope, pen)
}

/// The glyphs of the next cluster in visit order, given how many the walk has already placed.
#[inline(always)]
fn cluster_glyphs(
    candidate: Candidate<'_>,
    placed: usize,
    owned: usize,
) -> core::ops::Range<usize> {
    if candidate.input.reverse {
        let end = candidate.glyph_count - placed;
        end - owned..end
    } else {
        placed..placed + owned
    }
}

/// Chain pass, common case: the whole candidate is one block. Envelopes only grow, so a
/// candidate whose final envelope is admitted was admitted after every cluster and has no
/// split. Returns false, with nothing appended, when it must be chained cluster by cluster.
fn chain_whole(
    index: &mut BlockIndex,
    rows: &mut RowLanes,
    scratch: &mut KernelScratch,
    candidate: Candidate<'_>,
) -> Result<bool, RunLocalBuildError> {
    let input = candidate.input;
    let first_cluster = index.cluster_prefixes.len();
    let mut cursor = 0.0;
    let mut envelope = Envelope::point(cursor);
    let mut placed = 0;
    for cluster in candidate.clusters() {
        let owned = input.clusters.glyph_counts[cluster] as usize;
        let glyphs = cluster_glyphs(candidate, placed, owned);
        let (chained, pen) = chain_cluster(&mut scratch.glyphs[glyphs], cursor);
        index.cluster_prefixes.push(cursor);
        cursor = input.cluster_end(cluster, cursor, pen);
        envelope = envelope.union(chained);
        envelope.inline_min = lower(envelope.inline_min, cursor);
        envelope.inline_max = upper(envelope.inline_max, cursor);
        placed += owned;
    }
    if !envelope.finite(cursor, candidate.glyph_count != 0) || !envelope.admitted(input.cut) {
        index.cluster_prefixes.truncate(first_cluster);
        return Ok(false);
    }
    index
        .cluster_blocks
        .resize(first_cluster + candidate.count, u32::MAX);
    #[cfg(any(test, feature = "oracle"))]
    record_rows(index, rows, scratch, candidate, first_cluster);
    close_block(
        index,
        rows,
        scratch,
        candidate,
        Block {
            envelope,
            first_cluster,
            rows: 0..candidate.glyph_count,
        },
    )?;
    Ok(true)
}

/// A block ready to close: its envelope, its clusters in the cluster lanes and its glyphs in
/// the candidate.
struct Block {
    envelope: Envelope,
    first_cluster: usize,
    rows: core::ops::Range<usize>,
}

/// Chain pass, rare case: some prefix of the candidate outgrows the local range, so each
/// cluster is admitted on its own and the block closes where one does not fit.
fn chain_split(
    index: &mut BlockIndex,
    rows: &mut RowLanes,
    scratch: &mut KernelScratch,
    candidate: Candidate<'_>,
) -> Result<(), RunLocalBuildError> {
    let input = candidate.input;
    #[cfg(any(test, feature = "oracle"))]
    let candidate_cluster = index.cluster_prefixes.len();
    let mut cursor = 0.0;
    let mut open: Option<Envelope> = None;
    let mut first_cluster = index.cluster_prefixes.len();
    // Glyphs placed by closed blocks, and by the open one.
    let (mut closed, mut placed) = (0, 0);
    for cluster in candidate.clusters() {
        let owned = input.clusters.glyph_counts[cluster] as usize;
        let glyphs = cluster_glyphs(candidate, placed, owned);
        let chain = |scratch: &mut KernelScratch, root: f64| {
            let (mut envelope, pen) = chain_cluster(&mut scratch.glyphs[glyphs.clone()], root);
            let end = input.cluster_end(cluster, root, pen);
            envelope.inline_min = lower(envelope.inline_min, end);
            envelope.inline_max = upper(envelope.inline_max, end);
            envelope
                .finite(end, owned != 0)
                .then_some((envelope, end))
                .ok_or(RunLocalBuildError::InvalidSource)
        };
        let mut root = cursor;
        let (mut envelope, mut end) = chain(scratch, root)?;
        let combined = open.map_or(envelope, |open| open.union(envelope));
        let fits = combined.admitted(input.cut);
        if !fits {
            if let Some(envelope) = open.take() {
                let block = Block {
                    envelope,
                    first_cluster,
                    rows: block_rows(candidate, closed, placed),
                };
                close_block(index, rows, scratch, candidate, block)?;
            }
            (closed, first_cluster) = (placed, index.cluster_prefixes.len());
            if owned == 0 {
                // A glyphless cluster that cannot join a block detaches.
                index.cluster_blocks.push(u32::MAX);
                index.cluster_prefixes.push(0.0);
                first_cluster += 1;
                cursor = 0.0;
                continue;
            }
            // Clusters are indivisible: one that does not fit alone rejects the run.
            root = 0.0;
            (envelope, end) = chain(scratch, root)?;
            if !envelope.admitted(input.cut) {
                return Err(RunLocalBuildError::LocalGeometryOutOfRange);
            }
        }
        open = Some(if fits { combined } else { envelope });
        index.cluster_blocks.push(u32::MAX);
        index.cluster_prefixes.push(root);
        cursor = end;
        placed += owned;
    }
    #[cfg(any(test, feature = "oracle"))]
    record_rows(index, rows, scratch, candidate, candidate_cluster);
    if let Some(envelope) = open {
        let block = Block {
            envelope,
            first_cluster,
            rows: block_rows(candidate, closed, placed),
        };
        close_block(index, rows, scratch, candidate, block)?;
    }
    Ok(())
}

/// The candidate-relative glyphs placed between `closed` and `placed` of the visit order.
fn block_rows(candidate: Candidate<'_>, closed: usize, placed: usize) -> core::ops::Range<usize> {
    if candidate.input.reverse {
        candidate.glyph_count - placed..candidate.glyph_count - closed
    } else {
        closed..placed
    }
}

/// What tests and the oracle capture read beside the rows: each row's glyph in emission order
/// and, in tests, the pen that placed it. Recomputed from the finished chain.
#[cfg(any(test, feature = "oracle"))]
fn record_rows(
    index: &mut BlockIndex,
    rows: &mut RowLanes,
    scratch: &KernelScratch,
    candidate: Candidate<'_>,
    first_cluster: usize,
) {
    #[cfg(not(test))]
    {
        let _ = (&rows, scratch, first_cluster);
        if !candidate.input.reverse {
            // Emission order is glyph order.
            let glyphs = candidate.glyph_base..candidate.glyph_base + candidate.glyph_count;
            index.row_order.extend(glyphs.map(|glyph| glyph as u32));
            return;
        }
    }
    let mut placed = 0;
    for (visit, cluster) in candidate.clusters().enumerate() {
        let owned = candidate.input.clusters.glyph_counts[cluster] as usize;
        #[cfg(not(test))]
        let _ = visit;
        #[cfg(test)]
        let mut pen = index.cluster_prefixes[first_cluster + visit];
        for glyph in cluster_glyphs(candidate, placed, owned) {
            index.row_order.push((candidate.glyph_base + glyph) as u32);
            #[cfg(test)]
            {
                rows.pen_inline[candidate.glyph_base + glyph] = pen;
                pen += scratch.glyphs[glyph].advance;
            }
        }
        placed += owned;
    }
}

/// Narrow pass: anchors the block at its envelope midpoint, writes its rows and names it in
/// the cluster lanes. A block without rows detaches its clusters instead.
fn close_block(
    index: &mut BlockIndex,
    rows: &mut RowLanes,
    scratch: &KernelScratch,
    candidate: Candidate<'_>,
    block: Block,
) -> Result<(), RunLocalBuildError> {
    let clusters = block.first_cluster..index.cluster_prefixes.len();
    if block.rows.is_empty() {
        index.cluster_prefixes[clusters].fill(0.0);
        return Ok(());
    }
    let (anchor_inline, anchor_block) = block.envelope.anchor();
    let row_at = candidate.glyph_base + block.rows.start;
    let row_count =
        u32::try_from(block.rows.len()).map_err(|_| RunLocalBuildError::AllocationFailed)?;
    narrow_block(
        rows,
        &scratch.glyphs[block.rows],
        row_at,
        (anchor_inline, anchor_block),
        candidate.input.cut.local_abs_limit,
    )?;
    let block_index =
        u32::try_from(index.blocks.len()).map_err(|_| RunLocalBuildError::AllocationFailed)?;
    reserve(&mut index.blocks, 1)?;
    index.blocks.push(NumericBlock {
        source_glyph_start: u32::try_from(row_at)
            .map_err(|_| RunLocalBuildError::AllocationFailed)?,
        source_glyph_count: row_count,
        row_start: index.row_count,
        row_count,
        anchor_inline,
        anchor_block,
    });
    index.row_count = index
        .row_count
        .checked_add(row_count)
        .ok_or(RunLocalBuildError::AllocationFailed)?;
    index.cluster_blocks[clusters].fill(block_index);
    Ok(())
}

/// Writes the rows of one block at `row_at`, relative to its anchor.
fn narrow_block(
    rows: &mut RowLanes,
    glyphs: &[Scaled],
    row_at: usize,
    (anchor_inline, anchor_block): (f64, f64),
    limit: f64,
) -> Result<(), RunLocalBuildError> {
    let end = row_at + glyphs.len();
    let lanes = rows.inline_origin[row_at..end]
        .iter_mut()
        .zip(&mut rows.block_origin[row_at..end])
        .zip(&mut rows.inline_advance[row_at..end])
        .zip(&mut rows.ink_inline_start[row_at..end])
        .zip(&mut rows.ink_block_start[row_at..end])
        .zip(&mut rows.ink_inline_extent[row_at..end])
        .zip(&mut rows.ink_block_extent[row_at..end]);
    let mut in_range = true;
    let mut narrowed = true;
    for (
        glyph,
        (
            (
                (
                    (((inline_origin, block_origin), inline_advance), ink_inline_start),
                    ink_block_start,
                ),
                ink_inline_extent,
            ),
            ink_block_extent,
        ),
    ) in glyphs.iter().zip(lanes)
    {
        let origin_inline = glyph.inline_origin - anchor_inline;
        let origin_block = glyph.block_origin - anchor_block;
        let ink_inline = glyph.ink_inline_start - anchor_inline;
        let ink_block = glyph.ink_block_start - anchor_block;
        // The envelope bounds these by the limit up to the rounding of the midpoint.
        in_range &= (origin_inline.abs() <= limit)
            & (origin_block.abs() <= limit)
            & (ink_inline.abs() <= limit)
            & (ink_block.abs() <= limit);
        let advance = glyph.advance as f32;
        let inline_extent = glyph.ink_inline_extent as f32;
        let block_extent = glyph.ink_block_extent as f32;
        narrowed &= (advance < f32::INFINITY)
            & (inline_extent < f32::INFINITY)
            & (block_extent < f32::INFINITY);
        *inline_origin = origin_inline as f32;
        *block_origin = origin_block as f32;
        *inline_advance = advance;
        *ink_inline_start = ink_inline as f32;
        *ink_block_start = ink_block as f32;
        *ink_inline_extent = inline_extent;
        *ink_block_extent = block_extent;
    }
    if !in_range {
        return Err(RunLocalBuildError::LocalGeometryOutOfRange);
    }
    narrowed
        .then_some(())
        .ok_or(RunLocalBuildError::InvalidSource)
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), RunLocalBuildError> {
    values
        .try_reserve(additional)
        .map_err(|_| RunLocalBuildError::AllocationFailed)
}
