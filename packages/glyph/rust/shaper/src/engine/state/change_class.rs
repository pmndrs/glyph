//! What changed in one paragraph since its last renderer publication.
//!
//! Preparation can run several times between publications: once per read, then once in the
//! frame's batch. Each run knows only its own delta, so the class and the dirty intervals are
//! accumulated here and cleared when a publication consumes the paragraph. Publication reads the
//! accumulated value from `ParagraphState::change_since_publication`; gather consumes
//! `glyph_rows` to leave the columns of unchanged glyph rows alone.

use super::{EngineError, ParagraphState, TextEngine};
use crate::engine::codec_gather::RowChange;

/// The widest kind of change a paragraph accumulated, ordered from cheapest to republish.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum ChangeClass {
    /// Nothing a renderer can observe.
    #[default]
    None,
    /// Colour, opacity or material of existing glyphs; no glyph moved and no line was recomposed.
    Paint,
    /// The same glyphs at new origins: width, alignment, flow geometry or paragraph line height.
    Origin,
    /// The same clusters at new metrics: font size, spacing, baseline shift or an effect extent.
    Metric,
    /// Text, shaping, direction or span topology: glyph identity may differ.
    Content,
}

/// A half-open interval that only grows; `EMPTY` joins as the identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DirtyInterval {
    pub start: u32,
    pub end: u32,
}

impl DirtyInterval {
    pub(crate) const EMPTY: Self = Self {
        start: u32::MAX,
        end: 0,
    };
    pub(crate) const ALL: Self = Self {
        start: 0,
        end: u32::MAX,
    };

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "read by publication once gather narrows by change class"
        )
    )]
    pub(crate) fn is_empty(self) -> bool {
        self.start >= self.end
    }

    fn join(self, other: Self) -> Self {
        Self {
            start: self.start.min(other.start),
            end: self.end.max(other.end),
        }
    }

    fn of(start: usize, end: usize) -> Self {
        Self {
            start: u32::try_from(start).unwrap_or(u32::MAX),
            end: u32::try_from(end).unwrap_or(u32::MAX),
        }
    }
}

impl Default for DirtyInterval {
    fn default() -> Self {
        Self::EMPTY
    }
}

/// The accumulated change of one paragraph since publication last consumed it.
///
/// `units` is in UTF-16 units of the paragraph's current text and bounds every glyph whose
/// record can differ; a consumer maps it to glyph rows through the cluster starts. `lines` is in
/// current line indices. Both are `ALL` when a preparation could not bound its effect.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ParagraphChange {
    pub class: ChangeClass,
    pub units: DirtyInterval,
    pub lines: DirtyInterval,
    /// A stage that authors what a paragraph-run glyph projects was staged: text, Unicode, bidi,
    /// styles, shaping runs, shaping or clusters. While it is clear, a glyph that keeps its
    /// stable identity keeps its style, its binding selection and its run-local geometry, and
    /// only its line and placement can differ.
    pub glyph_rows: bool,
}

impl ParagraphChange {
    fn join(self, other: Self) -> Self {
        Self {
            class: self.class.max(other.class),
            units: self.units.join(other.units),
            lines: self.lines.join(other.lines),
            glyph_rows: self.glyph_rows || other.glyph_rows,
        }
    }
}

impl ParagraphState {
    /// Classifies the preparation that just staged its candidates. Call before they commit.
    fn staged_change(&self) -> ParagraphChange {
        let class = self.staged_class();
        ParagraphChange {
            class,
            units: self.staged_units(class),
            lines: self.staged_lines(class),
            glyph_rows: self.text.is_prepared()
                || self.unicode.is_prepared()
                || self.bidi.is_prepared()
                || self.styles.is_prepared()
                || self.shaping_runs.is_prepared()
                || self.shape.is_prepared()
                || self.clusters.is_prepared(),
        }
    }

    /// Classifies by cause, not by which stages ran: a size change re-derives clusters and runs
    /// without changing which glyphs they hold.
    fn staged_class(&self) -> ChangeClass {
        let style = self.style_invalidation;
        let content = self.text.is_prepared()
            || self.unicode.is_prepared()
            || style.bidi
            || style.shaping
            || style.cluster_mapping;
        let origin = self.geometry.is_prepared()
            || self.bidi.is_prepared()
            || self.shaping_runs.is_prepared()
            || self.shape.is_prepared()
            || self.clusters.is_prepared()
            || self.flow_layout.is_prepared()
            || self.positioned.is_prepared()
            || self.prepared_layout.is_prepared();
        if content {
            ChangeClass::Content
        } else if style.metrics || style.effects {
            ChangeClass::Metric
        } else if origin {
            ChangeClass::Origin
        } else if style.paint {
            ChangeClass::Paint
        } else {
            ChangeClass::None
        }
    }

    fn staged_units(&self, class: ChangeClass) -> DirtyInterval {
        match class {
            ChangeClass::None => DirtyInterval::EMPTY,
            ChangeClass::Paint => self.style_invalidation.changed,
            ChangeClass::Content
                if !self.text_edits.is_empty() && !self.style_invalidation.any() =>
            {
                self.text_edits
                    .iter()
                    .fold(DirtyInterval::EMPTY, |units, edit| {
                        units.join(DirtyInterval::of(edit.new_start, edit.new_end))
                    })
            }
            _ => DirtyInterval::ALL,
        }
    }

    fn staged_lines(&self, class: ChangeClass) -> DirtyInterval {
        if matches!(class, ChangeClass::None | ChangeClass::Paint) {
            return DirtyInterval::EMPTY;
        }
        let recomposed = self
            .flow_layout
            .is_prepared()
            .then(|| self.flow_layout.pending().recomposed_line_ranges())
            .flatten();
        match recomposed {
            Some(ranges) => ranges.iter().fold(DirtyInterval::EMPTY, |lines, range| {
                lines.join(DirtyInterval::of(range.start, range.end))
            }),
            None => DirtyInterval::ALL,
        }
    }

    /// Folds the staged preparation into what publication has yet to consume.
    pub(super) fn accumulate_staged_change(&mut self) {
        self.change_since_publication = self.change_since_publication.join(self.staged_change());
    }
}

impl ParagraphState {
    /// What the paragraph's gathered rows can differ in from the rows it last published.
    pub(super) fn row_change_since_publication(&self) -> RowChange {
        if self.change_since_publication.glyph_rows {
            RowChange::Any
        } else {
            RowChange::Placement
        }
    }
}

impl ParagraphState {
    /// Whether the styles just staged change only paint on an otherwise untouched paragraph.
    ///
    /// Retained shaping, lines and positions then still answer, so preparation stops after the
    /// style stage: a colour change never runs layout. Publication re-reads the paragraph's rows
    /// against the new styles because the caller reports its positioned rows as changed.
    pub(super) fn staged_paint_only(&self, geometry_unchanged: bool) -> bool {
        geometry_unchanged
            && self.style_invalidation.paint_only()
            && !self.text.is_prepared()
            && !self.unicode.is_prepared()
            && !self.geometry.is_prepared()
    }
}

impl ParagraphState {
    /// Marks the retained rows for republication without touching their positions.
    pub(super) fn republish_retained_rows(&mut self) {
        if self.committed_inline().is_none() {
            self.positioned.pair_mut().0.mark_unpublished();
        }
    }
}

impl TextEngine {
    /// The change one paragraph accumulated since a publication last consumed it.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "read by publication once gather narrows by change class"
        )
    )]
    pub(crate) fn paragraph_change_since_publication(
        &self,
        root_id: u32,
        paragraph_id: u32,
    ) -> Result<ParagraphChange, EngineError> {
        self.planners
            .get(&root_id)
            .ok_or(EngineError::RootMissing)?
            .paragraph(paragraph_id)
            .map(|paragraph| paragraph.state.change_since_publication)
            .ok_or(EngineError::InvalidRequest)
    }
}
