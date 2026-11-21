//! The engine's side of the editing queries: one prepared paragraph read as a
//! `LayoutSource`, with nothing copied.
//!
//! A child of `state` because it reads paragraph-private stages. It reads the layout the
//! paragraph draws (the active flow and positioned glyphs), not the unclipped inspection
//! layout: a caret belongs where the text is.

use crate::{
    ShaperRegistry,
    bidi::BidiAnalysis,
    engine::{
        editing::{
            DropCapFacts, Editing, EditingError, FragmentFacts, GlyphFacts, GlyphRole,
            LayoutSource, LineFacts, MAX_LIGATURE_CARETS, TextUnit, ligature_carets,
        },
        flow_composition::{FlowFragment, FlowLine},
        placement_state::GlyphSource,
        positioning::{SemanticGlyph, SourceLine, fragment_pen_origin},
    },
    unicode::{GRAPHEME_BOUNDARY, SENTENCE_BOUNDARY, WORD_BOUNDARY},
};

use super::{ParagraphState, TextEngine, thread_typography};

/// One prepared paragraph, borrowed for editing queries.
pub struct ParagraphSource<'a> {
    paragraph: &'a ParagraphState,
    fonts: &'a ShaperRegistry,
}

impl TextEngine {
    /// The editing queries of a paragraph, over the layout its last preparation produced.
    /// `fonts` is the registry the paragraph was shaped with.
    pub fn editing<'a>(
        &'a self,
        fonts: &'a ShaperRegistry,
        root_id: u32,
        paragraph_id: u32,
    ) -> Result<Editing<ParagraphSource<'a>>, EditingError> {
        let paragraph = self
            .planners
            .get(&root_id)
            .and_then(|planner| planner.paragraph(paragraph_id))
            .ok_or(EditingError::NotPrepared)?;
        Ok(Editing::new(ParagraphSource {
            paragraph: &paragraph.state,
            fonts,
        }))
    }

    /// Fills the lazy boundary lane a word or sentence query reads. The only editing call that
    /// writes, and it writes a derived lane, never layout: the first call after a text change
    /// computes the lane and later calls return at once. Grapheme and line units need nothing.
    pub fn prepare_editing_boundaries(
        &mut self,
        root_id: u32,
        paragraph_id: u32,
        unit: TextUnit,
    ) -> Result<(), EditingError> {
        // The grapheme bits ride along: a word or sentence boundary inside a grapheme is not
        // one a query may answer with.
        let kinds = GRAPHEME_BOUNDARY
            | match unit {
                TextUnit::Word => WORD_BOUNDARY,
                TextUnit::Sentence => SENTENCE_BOUNDARY,
                TextUnit::Grapheme | TextUnit::Line => return Ok(()),
            };
        let paragraph = self
            .planners
            .get_mut(&root_id)
            .and_then(|planner| planner.paragraph_mut(paragraph_id))
            .ok_or(EditingError::NotPrepared)?;
        let state = &mut paragraph.state;
        if state
            .unicode
            .active()
            .prepared_boundary_lane(kinds)
            .is_some()
        {
            return Ok(());
        }
        // Empty text has no unit to bound, and a paragraph that was never filled no analysis.
        if state.text.active().units.is_empty() {
            return Ok(());
        }
        let text = &state.text.active().units;
        state
            .unicode
            .active_mut()
            .boundary_lane(text, kinds)
            .map(|_| ())
            .map_err(|_| EditingError::ResultTooLarge)
    }
}

impl ParagraphSource<'_> {
    fn bidi(&self) -> &BidiAnalysis {
        self.paragraph.bidi.active()
    }

    /// Base level of the bidi paragraph holding `offset`, as positioning resolves it.
    fn paragraph_level(&self, offset: u32) -> u8 {
        let bidi = self.bidi();
        bidi.paragraph_starts
            .partition_point(|start| *start <= offset)
            .checked_sub(1)
            .filter(|index| {
                bidi.paragraph_ends
                    .get(*index)
                    .is_some_and(|end| offset < *end)
            })
            .and_then(|index| bidi.paragraph_levels.get(index).copied())
            .or_else(|| bidi.paragraph_levels.last().copied())
            .unwrap_or(0)
    }

    fn fragment_facts(&self, line: FlowLine, fragment: FlowFragment) -> FragmentFacts {
        let paragraph_level = self.paragraph_level(fragment.line.text_start);
        let indent = if fragment.line.cluster_start == 0 {
            thread_typography(self.paragraph.geometry.active(), line.flow_thread_id)
                .first_line_indent
        } else {
            0.0
        };
        FragmentFacts {
            text_start: fragment.line.text_start,
            text_end: fragment.line.text_end,
            origin: fragment_pen_origin(line, fragment, indent, paragraph_level, false, false),
            paragraph_level,
        }
    }

    fn scale(&self, glyph: &SemanticGlyph) -> f64 {
        self.fonts
            .font_metrics(glyph.font_handle)
            .filter(|metrics| metrics.units_per_em != 0)
            .map_or(0.0, |metrics| {
                f64::from(glyph.font_size) / f64::from(metrics.units_per_em)
            })
    }

    fn glyph_facts(
        &self,
        glyph: SemanticGlyph,
        x_offset: i32,
        role: GlyphRole,
        drop_cap: bool,
    ) -> GlyphFacts {
        let scale = self.scale(&glyph);
        GlyphFacts {
            text: glyph.cluster,
            level: glyph.bidi_level,
            pen: f64::from(glyph.inline_origin) - f64::from(x_offset) * scale,
            advance: f64::from(glyph.inline_advance),
            font_handle: glyph.font_handle,
            glyph_id: glyph.glyph_id,
            scale,
            role,
            drop_cap,
        }
    }
}

impl LayoutSource for ParagraphSource<'_> {
    fn text(&self) -> &[u16] {
        &self.paragraph.text.active().units
    }

    fn unit_ids(&self) -> &[u32] {
        &self.paragraph.text.active().unit_ids
    }

    fn grapheme_boundaries(&self) -> &[u32] {
        self.paragraph.unicode.active().grapheme_boundaries()
    }

    fn boundary_lane(&self, kinds: u8) -> Option<&[u8]> {
        self.paragraph
            .unicode
            .active()
            .prepared_boundary_lane(kinds)
            .filter(|lane| lane.len() == self.text().len() + 1)
    }

    fn line_count(&self) -> usize {
        match self.paragraph.active_inline() {
            Some(leaf) => usize::from(leaf.line.is_some() && leaf.fragment.is_some()),
            None => self.paragraph.flow_layout.active().lines.len(),
        }
    }

    fn line(&self, index: usize) -> Option<LineFacts> {
        let (line, fragment_start) = match self.paragraph.active_inline() {
            Some(leaf) => ((index == 0).then_some(leaf.line).flatten()?, 0),
            None => {
                let flow = self.paragraph.flow_layout.active();
                (*flow.lines.get(index)?, flow.line_fragment_start(index)?)
            }
        };
        Some(LineFacts {
            top: line.block_start,
            height: line.height,
            fragment_start,
            fragment_count: usize::from(line.fragment_count),
        })
    }

    fn fragment(&self, index: usize) -> Option<FragmentFacts> {
        match self.paragraph.active_inline() {
            Some(leaf) => {
                let fragment = (index == 0).then_some(leaf.fragment).flatten()?;
                Some(self.fragment_facts(leaf.line?, fragment))
            }
            None => {
                let flow = self.paragraph.flow_layout.active();
                let fragment = *flow.fragments.get(index)?;
                let line = *flow.lines.get(flow.lines.index_for_fragment(index)?)?;
                Some(self.fragment_facts(line, fragment))
            }
        }
    }

    fn drop_cap(&self, index: usize) -> Option<DropCapFacts> {
        if self.paragraph.active_inline().is_some() {
            return None;
        }
        let flow = self.paragraph.flow_layout.active();
        let cap = flow.drop_caps.get(index)?;
        // The body resumes where the initial ends, on the first line of its thread.
        let resume = cap.fragment.line.text_end;
        let line = flow
            .fragments
            .find_source(resume, |fragment, offset| {
                fragment.line.text_start <= offset
                    && offset
                        < fragment
                            .line
                            .text_end
                            .max(fragment.line.text_start.saturating_add(1))
            })
            .and_then(|fragment| flow.lines.index_for_fragment(fragment))
            .or_else(|| {
                (0..flow.lines.len()).find(|line| {
                    flow.lines
                        .get(*line)
                        .is_some_and(|line| line.flow_thread_id == cap.line.flow_thread_id)
                })
            })?;
        Some(DropCapFacts {
            line,
            top: cap.line.block_start,
            height: cap.line.height,
            fragment: self.fragment_facts(cap.line, cap.fragment),
        })
    }

    fn line_glyphs(
        &self,
        line: usize,
        sink: &mut dyn FnMut(GlyphFacts),
    ) -> Result<(), EditingError> {
        if let Some(leaf) = self.paragraph.active_inline() {
            if line != 0 {
                return Err(EditingError::Layout);
            }
            for (index, shaped) in leaf.shape.glyphs().iter().enumerate() {
                let row = leaf.row(index as u32).ok_or(EditingError::Layout)?.semantic;
                let translation = *leaf
                    .placement_translations()
                    .get(row.placement_segment as usize)
                    .ok_or(EditingError::Layout)?;
                let glyph = row.placed(translation).map_err(|_| EditingError::Layout)?;
                sink(self.glyph_facts(glyph, shaped.x_offset, GlyphRole::Text, false));
            }
            return Ok(());
        }
        let positioned = self.paragraph.positioned.active();
        let clusters = self.paragraph.clusters.active();
        let boundary = self.paragraph.visible_boundary_shape();
        let (starts, counts) = positioned.semantic_line_glyph_spans();
        let (Some(start), Some(count)) = (starts.get(line), counts.get(line)) else {
            return Err(EditingError::Layout);
        };
        let mut cursor = positioned
            .occurrence_cursor(*start as usize, clusters, boundary)
            .map_err(|_| EditingError::Layout)?;
        for _ in 0..*count {
            let row = cursor
                .next_row()
                .map_err(|_| EditingError::Layout)?
                .ok_or(EditingError::Layout)?;
            let glyph = positioned
                .placed_occurrence(row.semantic)
                .map_err(|_| EditingError::Layout)?;
            let offsets = match row.span.source {
                GlyphSource::LayoutRun => &clusters.glyph_x_offsets,
                GlyphSource::Boundary => &boundary.shape.x_offsets,
            };
            let x_offset = *offsets
                .get(row.source_glyph as usize)
                .ok_or(EditingError::Layout)?;
            // An ellipsis is the one boundary glyph whose cluster the span overrides.
            let role = if row.span.source == GlyphSource::Boundary
                && row.span.cluster_override.is_some()
            {
                GlyphRole::Ellipsis
            } else {
                GlyphRole::Text
            };
            let drop_cap = matches!(row.span.line, SourceLine::DropCap(_));
            sink(self.glyph_facts(glyph, x_offset, role, drop_cap));
        }
        Ok(())
    }

    fn ligature_carets(
        &self,
        font_handle: u32,
        glyph_id: u16,
        carets: &mut [i32; MAX_LIGATURE_CARETS],
    ) -> Option<usize> {
        ligature_carets(self.fonts.font_sfnt(font_handle)?, glyph_id, carets)
    }
}
