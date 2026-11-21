//! The caret rules on hand-built layouts: what the fonts on a test machine cannot supply (a
//! Tamil conjunct, a right-to-left ligature with font carets) and what must not depend on one.

use alloc::{vec, vec::Vec};

use super::*;

/// One line, one fragment, glyphs as given.
#[derive(Default)]
struct Mock {
    text: Vec<u16>,
    graphemes: Vec<u32>,
    glyphs: Vec<GlyphFacts>,
    /// Ligature carets by glyph id, in design units.
    carets: Vec<(u16, Vec<i32>)>,
    paragraph_level: u8,
    origin: f64,
}

impl Mock {
    fn new(text: &str, graphemes: &[u32]) -> Self {
        Self {
            text: text.encode_utf16().collect(),
            graphemes: graphemes.to_vec(),
            ..Self::default()
        }
    }

    /// A glyph of `advance` at the pen, which then moves on; one design unit is 0.01.
    fn glyph(mut self, text: u32, level: u8, glyph_id: u16, advance: f64) -> Self {
        let pen = self
            .glyphs
            .last()
            .map_or(self.origin, |last| last.pen + last.advance);
        self.glyphs.push(GlyphFacts {
            text,
            level,
            pen,
            advance,
            font_handle: 1,
            glyph_id,
            scale: 0.01,
            role: GlyphRole::Text,
            drop_cap: false,
        });
        self
    }

    fn carets(mut self, glyph_id: u16, carets: &[i32]) -> Self {
        self.carets.push((glyph_id, carets.to_vec()));
        self
    }

    fn rtl(mut self, origin: f64) -> Self {
        self.paragraph_level = 1;
        self.origin = origin;
        self
    }

    fn queries(self) -> Editing<Self> {
        Editing::new(self)
    }
}

impl LayoutSource for Mock {
    fn text(&self) -> &[u16] {
        &self.text
    }

    fn unit_ids(&self) -> &[u32] {
        &[]
    }

    fn grapheme_boundaries(&self) -> &[u32] {
        &self.graphemes
    }

    fn boundary_lane(&self, _kinds: u8) -> Option<&[u8]> {
        None
    }

    fn line_count(&self) -> usize {
        1
    }

    fn line(&self, index: usize) -> Option<LineFacts> {
        (index == 0).then_some(LineFacts {
            top: 0.0,
            height: 20.0,
            fragment_start: 0,
            fragment_count: 1,
        })
    }

    fn fragment(&self, index: usize) -> Option<FragmentFacts> {
        (index == 0).then_some(FragmentFacts {
            text_start: 0,
            text_end: self.text.len() as u32,
            origin: self.origin,
            paragraph_level: self.paragraph_level,
        })
    }

    fn drop_cap(&self, _index: usize) -> Option<DropCapFacts> {
        None
    }

    fn line_glyphs(
        &self,
        _line: usize,
        sink: &mut dyn FnMut(GlyphFacts),
    ) -> Result<(), EditingError> {
        self.glyphs.iter().copied().for_each(sink);
        Ok(())
    }

    fn ligature_carets(
        &self,
        _font_handle: u32,
        glyph_id: u16,
        carets: &mut [i32; MAX_LIGATURE_CARETS],
    ) -> Option<usize> {
        let (_, found) = self.carets.iter().find(|(id, _)| *id == glyph_id)?;
        carets[..found.len()].copy_from_slice(found);
        Some(found.len())
    }
}

fn xs(queries: &Editing<Mock>, offsets: &[u32]) -> Vec<f64> {
    offsets
        .iter()
        .map(|offset| {
            queries
                .caret(TextPosition::downstream(*offset))
                .expect("caret")
                .rect
                .x
        })
        .collect()
}

#[test]
fn a_latin_ligature_divides_evenly_without_font_carets() {
    // "ffi" as one glyph of advance 12.
    let queries = Mock::new("ffi", &[0, 1, 2, 3])
        .glyph(0, 0, 7, 12.0)
        .queries();
    assert_eq!(queries.caret_stops().unwrap(), [0, 1, 2, 3]);
    assert_eq!(xs(&queries, &[0, 1, 2, 3]), [0.0, 4.0, 8.0, 12.0]);
    let location = queries.locate(TextPosition::downstream(1)).unwrap();
    assert_eq!(location.cluster, TextRange { start: 0, end: 3 });
    assert_eq!(location.grapheme, 1);
}

#[test]
fn font_carets_place_the_stops_inside_a_ligature() {
    // Carets at 300 and 900 design units: 3 and 9, not the even 4 and 8.
    let queries = Mock::new("ffi", &[0, 1, 2, 3])
        .glyph(0, 0, 7, 12.0)
        .carets(7, &[300, 900])
        .queries();
    assert_eq!(xs(&queries, &[0, 1, 2, 3]), [0.0, 3.0, 9.0, 12.0]);
    // Selecting the middle component covers exactly the span between its carets.
    assert_eq!(
        queries.range_rects(1, 2).unwrap(),
        [Rect {
            x: 3.0,
            y: 0.0,
            width: 6.0,
            height: 20.0
        }]
    );
}

#[test]
fn font_carets_of_a_right_to_left_ligature_count_from_its_right_edge() {
    // Three Arabic letters as one glyph of advance 10 whose pen stands at 100. The font lists
    // carets left to right (200, 700); the first logical component is the rightmost.
    let queries = Mock::new("\u{644}\u{645}\u{62d}", &[0, 1, 2, 3])
        .rtl(100.0)
        .glyph(0, 1, 9, 10.0)
        .carets(9, &[200, 700])
        .queries();
    assert_eq!(xs(&queries, &[0, 1, 2, 3]), [110.0, 107.0, 102.0, 100.0]);
    // Without the carets the same ligature divides evenly from the right.
    let even = Mock::new("\u{644}\u{645}\u{62d}", &[0, 1, 2, 3])
        .rtl(100.0)
        .glyph(0, 1, 9, 9.0)
        .queries();
    assert_eq!(xs(&even, &[0, 1, 2, 3]), [109.0, 106.0, 103.0, 100.0]);
}

#[test]
fn font_carets_are_ignored_unless_there_is_one_per_interior_boundary() {
    for carets in [&[300][..], &[300, 600, 900], &[900, 1300], &[0, 600]] {
        let queries = Mock::new("ffi", &[0, 1, 2, 3])
            .glyph(0, 0, 7, 12.0)
            .carets(7, carets)
            .queries();
        assert_eq!(
            xs(&queries, &[0, 1, 2, 3]),
            [0.0, 4.0, 8.0, 12.0],
            "{carets:?}: wrong count, outside the glyph, or on its edge"
        );
    }
}

#[test]
fn a_merged_cluster_with_a_glyph_per_grapheme_stops_between_its_glyphs() {
    // `f` and a dotless `i` the shaper merged into one cluster: advances 6 and 3.
    let ltr = Mock::new("fi", &[0, 1, 2])
        .glyph(0, 0, 3, 6.0)
        .glyph(0, 0, 4, 3.0)
        .queries();
    assert_eq!(xs(&ltr, &[0, 1, 2]), [0.0, 6.0, 9.0]);
    // Right to left the first grapheme is the rightmost glyph; a mark has no advance and does
    // not count as a component.
    let rtl = Mock::new("\u{644}\u{627}", &[0, 1, 2])
        .rtl(50.0)
        .glyph(0, 1, 5, 4.0)
        .glyph(0, 1, 8, 0.0)
        .glyph(0, 1, 6, 7.0)
        .queries();
    assert_eq!(xs(&rtl, &[0, 1, 2]), [61.0, 54.0, 50.0]);
}

#[test]
fn a_conjunct_moves_as_one_unit() {
    // Tamil KA, VIRAMA, SSA: two graphemes ("க்", "ஷ") that shape to one glyph.
    let conjunct = "\u{b95}\u{bcd}\u{bb7}";
    let queries = Mock::new(conjunct, &[0, 2, 3])
        .glyph(0, 0, 11, 20.0)
        .queries();
    assert_eq!(queries.caret_stops().unwrap(), [0, 3]);
    assert!(!queries.is_caret_stop(2).unwrap());
    // The boundary is still a valid offset, and a caret asked for there is drawn by even
    // division; nothing moves to it and no hit lands on it.
    assert_eq!(xs(&queries, &[0, 2, 3]), [0.0, 10.0, 20.0]);
    let step = |from: u32, direction| {
        queries
            .move_position(
                TextPosition::downstream(from),
                direction,
                TextUnit::Grapheme,
                None,
            )
            .unwrap()
            .position
            .offset
    };
    assert_eq!(step(0, TextDirection::Forward), 3);
    assert_eq!(step(3, TextDirection::Backward), 0);
    assert_eq!(step(0, TextDirection::Right), 3);
    assert_eq!(step(3, TextDirection::Left), 0);
    assert_eq!(step(2, TextDirection::Forward), 3, "from inside, out");
    assert_eq!(step(2, TextDirection::Backward), 0);
    for (x, offset) in [(-5.0, 0), (9.9, 0), (10.1, 3), (99.0, 3)] {
        assert_eq!(queries.hit_test(x, 10.0).unwrap().offset, offset, "x {x}");
    }
    // An offset inside the first grapheme is refused, with the boundaries around it.
    assert_eq!(
        queries.caret(TextPosition::downstream(1)),
        Err(EditingError::Offset(OffsetError {
            argument: OffsetArgument::Offset,
            offset: 1.0,
            reason: OffsetReason::InsideGrapheme,
            text_length: 3,
            before: Some(0),
            after: Some(2),
        }))
    );
}

#[test]
fn word_and_sentence_queries_need_their_lane() {
    let queries = Mock::new("ab", &[0, 1, 2])
        .glyph(0, 0, 1, 5.0)
        .glyph(1, 0, 2, 5.0)
        .queries();
    for unit in [TextUnit::Word, TextUnit::Sentence] {
        assert_eq!(
            queries.boundary(TextPosition::downstream(0), unit),
            Err(EditingError::BoundariesNotPrepared(unit))
        );
        assert_eq!(
            queries
                .move_position(
                    TextPosition::downstream(0),
                    TextDirection::Forward,
                    unit,
                    None
                )
                .map(|moved| moved.position),
            Err(EditingError::BoundariesNotPrepared(unit))
        );
    }
}

#[test]
fn a_zero_width_grapheme_is_a_logical_stop_and_no_visual_one() {
    // "a", ZERO WIDTH SPACE, "b".
    let queries = Mock::new("a\u{200b}b", &[0, 1, 2, 3])
        .glyph(0, 0, 1, 5.0)
        .glyph(1, 0, 2, 0.0)
        .glyph(2, 0, 3, 5.0)
        .queries();
    assert_eq!(queries.caret_stops().unwrap(), [0, 1, 2, 3]);
    assert_eq!(xs(&queries, &[0, 1, 2, 3]), [0.0, 5.0, 5.0, 10.0]);
    let step = |from: u32, direction| {
        queries
            .move_position(
                TextPosition::downstream(from),
                direction,
                TextUnit::Grapheme,
                None,
            )
            .unwrap()
            .position
            .offset
    };
    assert_eq!(step(1, TextDirection::Forward), 2);
    assert_eq!(
        step(1, TextDirection::Right),
        3,
        "the next place that is elsewhere"
    );
    assert_eq!(step(2, TextDirection::Left), 0);
    assert_eq!(queries.range_rects(1, 2).unwrap(), vec![]);
}
