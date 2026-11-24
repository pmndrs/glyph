// One length-changing edit of a single run, through the engine's window between boundaries the
// retained shape does not flag unsafe to concatenate. Two independent references: HarfRust
// shaping the new text cold, and the same engine made to reshape the edited run whole.

/// Generated 109-glyph fonts whose default Latin features reach one lookup of each kind the
/// cases below name: `liga` single, multiple and ligature substitution, `kern` pair positioning
/// by glyph and by class. The three variants add a second value record or a 17-glyph ligature.
const KERNED_SFNT: &[u8] = include_bytes!("../adversarial-fonts/supported.sfnt");
const PAIR1_VALUE2_SFNT: &[u8] = include_bytes!("../adversarial-fonts/value2-pair1-reject.sfnt");
const PAIR2_VALUE2_SFNT: &[u8] = include_bytes!("../adversarial-fonts/value2-pair2-reject.sfnt");
const LONG_LIGATURE_SFNT: &[u8] = include_bytes!("../adversarial-fonts/long-ligature-reject.sfnt");

/// The shaping font, glyph extents and extents availability of the baked Fredoka subset.
fn fredoka_baked_views() -> (&'static [u8], &'static [u8], &'static [u8]) {
    const GLB: &[u8] = include_bytes!(
        "../../../../../../../benches/fixtures/rendering/fredoka-issue-216-bitmap-16.font.glb"
    );
    fn word(bytes: &[u8], start: usize) -> usize {
        usize::try_from(u32::from_le_bytes(
            bytes[start..start + 4].try_into().unwrap(),
        ))
        .unwrap()
    }
    assert_eq!(&GLB[0..4], b"glTF");
    assert_eq!(word(GLB, 4), 2);
    assert_eq!(word(GLB, 8), GLB.len());
    let json_len = word(GLB, 12);
    assert_eq!(&GLB[16..20], b"JSON");
    let json_end = 20 + json_len;
    let document: serde_json::Value = serde_json::from_slice(&GLB[20..json_end]).unwrap();
    let bin_len = word(GLB, json_end);
    assert_eq!(&GLB[json_end + 4..json_end + 8], b"BIN\0");
    let bin = &GLB[json_end + 8..json_end + 8 + bin_len];
    assert_eq!(json_end + 8 + bin_len, GLB.len());
    let font = &document["extensions"]["PMNDRS_font"];
    assert_eq!(font["metrics"]["glyphCount"].as_u64(), Some(109));
    let shaping = &font["shaping"];
    let functions = &shaping["fontFunctions"];
    let views = document["bufferViews"].as_array().unwrap();
    let view = |index: &serde_json::Value| -> &'static [u8] {
        let index = usize::try_from(index.as_u64().unwrap()).unwrap();
        let view = &views[index];
        assert_eq!(view["buffer"].as_u64(), Some(0));
        let start = usize::try_from(view["byteOffset"].as_u64().unwrap_or(0)).unwrap();
        let len = usize::try_from(view["byteLength"].as_u64().unwrap()).unwrap();
        assert_eq!(start & 3, 0);
        bin.get(start..start + len).unwrap()
    };
    let sfnt = view(&shaping["bufferView"]);
    let extents = view(&functions["glyphExtentsBufferView"]);
    let availability = view(&functions["glyphExtentsAvailabilityBufferView"]);
    assert_eq!(
        (sfnt.len(), extents.len(), availability.len()),
        (5_648, 872, 14)
    );
    (sfnt, extents, availability)
}

/// The typist benchmark's paragraph: printable ASCII with kerning pairs and `f` ligatures.
fn fredoka_corpus() -> String {
    let paragraph_source = [
        "Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning pairs while a responsive panel changes the space around them.",
        "A practical interface mixes prose with 0123456789, prices such as 24.50, ranges from 8-512 px, and punctuation.",
        "Repeated office, affine, difficult, and shuffle words retain ff, fi, fl, ffi, and ffl shaping candidates.",
    ]
    .join(" ");
    let glyphs_per_copy = paragraph_source
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .count();
    let copies = (4_000_f64 / glyphs_per_copy as f64).round().max(1.0) as usize;
    let ordinary_len = core::iter::repeat_n(paragraph_source.as_str(), copies)
        .collect::<Vec<_>>()
        .join("\n")
        .len();
    let sentence = "Reveals one grapheme at a time over a duration. Layout stays put and a trigger fires at the end. ";
    sentence.repeat(ordinary_len.div_ceil(sentence.len()))
}

/// The text with one `x` in the middle.
fn with_middle_insert(text: &str) -> String {
    let middle = text.len() / 2;
    alloc::format!("{}x{}", &text[..middle], &text[middle..])
}

/// HarfRust shaping the whole text as the engine's one run describes it.
fn cold_shape(shaper: &mut ShaperRegistry, text: &[u16]) -> ShapeArena {
    let mut shape = ShapeArena::default();
    let end = u32::try_from(text.len()).unwrap();
    let run = ShapeRunRef {
        text_start: 0,
        text_end: end,
        script: u32::from_be_bytes(*b"Latn"),
        language: None,
        features: &[],
        direction: 0,
        cluster_level: 0,
        flags: 0x40,
    };
    shaper
        .with_shaped_run(1, text, run, |glyphs| {
            shape.append(0, 1, 42, 0, end, glyphs)
        })
        .unwrap();
    assert_eq!(shape.runs.len(), 1);
    assert!(
        !shape.glyph_ids.contains(&0),
        "the font must cover the text"
    );
    shape
}

fn assert_shapes_equal(actual: &ShapeArena, expected: &ShapeArena, label: &str) {
    assert_eq!(actual.runs, expected.runs, "{label}: shaped runs");
    assert_eq!(actual.glyph_ids, expected.glyph_ids, "{label}: glyph ids");
    assert_eq!(actual.clusters, expected.clusters, "{label}: clusters");
    assert_eq!(
        actual.x_advances, expected.x_advances,
        "{label}: x advances"
    );
    assert_eq!(
        actual.y_advances, expected.y_advances,
        "{label}: y advances"
    );
    assert_eq!(actual.x_offsets, expected.x_offsets, "{label}: x offsets");
    assert_eq!(actual.y_offsets, expected.y_offsets, "{label}: y offsets");
    assert_eq!(
        actual.glyph_flags, expected.glyph_flags,
        "{label}: glyph flags"
    );
}

fn window_limits(request: &mut UpdateRequest<'_>) {
    request.limits.max_clusters = 8_192;
    request.limits.max_lines = 8_192;
    request.limits.max_output_bytes = 1 << 22;
}

fn window_style(text_len: usize) -> Vec<u8> {
    let mut style = root_style_bytes_for_text(7, u32::try_from(text_len).unwrap());
    write_f32(
        &mut style,
        ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
        24.0,
    );
    style
}

/// A committed 600-unit-wide paragraph of `text` in one font. `whole_run` makes every later
/// edit reshape its run whole.
fn single_font_engine(sfnt: &[u8], text: &[u16], whole_run: bool) -> (TextEngine, ShaperRegistry) {
    let (_, extents, availability) = fredoka_baked_views();
    assert_eq!(
        read_fonts::FontRef::new(sfnt)
            .unwrap()
            .maxp()
            .unwrap()
            .num_glyphs(),
        109
    );
    let mut shaper = ShaperRegistry::default();
    assert_eq!(
        shaper.register_font(1, sfnt, extents, availability, 0, 0),
        0
    );
    let mut engine = TextEngine::default();
    let mut codec = validated_codec(TechniqueId(1));
    let mut capability_sets = codec.capability_sets().to_vec();
    for set in &mut capability_sets {
        set.max_buffer_bytes = 1 << 20;
    }
    codec = ValidatedCodec::new(CodecDescriptor {
        capability_sets,
        programs: codec.programs().to_vec(),
    })
    .unwrap();
    engine.register_codec(9, codec).unwrap();
    engine
        .register_font_binding(42, 1, 109, render_binding(109, 1))
        .unwrap();
    engine.register_font_stack(7, &[42]).unwrap();
    engine.create_root(4).unwrap();
    engine
        .reserve_root_text(4, u32::try_from(text.len() + 1).unwrap())
        .unwrap();
    let spare = engine
        .planners
        .get_mut(&4)
        .unwrap()
        .spare_paragraph
        .as_mut()
        .unwrap();
    spare.disable_inline = true;
    spare.force_whole_run_shape = whole_run;
    let style = window_style(text.len());
    let mut geometry = multiline_root_geometry_bytes();
    let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
    let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
    write_f32(
        &mut geometry,
        constraint + abi::ENGINE_CONSTRAINT_WIDTH,
        600.0,
    );
    for field in [
        abi::ENGINE_REGION_INLINE_END,
        abi::ENGINE_REGION_CLIP_INLINE_END,
    ] {
        write_f32(&mut geometry, region + field, 600.0);
    }
    let bytes = text_mutation_bytes(&[(0, 0, text)]);
    let mut request = update(0, 0, 0);
    window_limits(&mut request);
    request.text_mutations =
        parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request.style_mutations =
        parse_style_mutations(&style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request.geometry = parse_root_geometry(&geometry, request.limits);
    let prepared = engine
        .prepare_update_with_shaper(&mut shaper, request, 1)
        .unwrap();
    engine.commit_update(prepared).unwrap();
    assert_single_run(&engine, text);
    (engine, shaper)
}

/// The committed paragraph is what `cold_shape` describes: one left-to-right Latin run of the
/// whole text in the first font of its stack, with no language and no features.
fn assert_single_run(engine: &TextEngine, text: &[u16]) {
    let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
    assert!(matches!(
        state.prepared_layout.committed(),
        PreparedLayout::General
    ));
    assert_eq!(state.text.committed().units.as_slice(), text);
    let end = u32::try_from(text.len()).unwrap();
    let [run] = state.shaping_runs.committed().runs() else {
        panic!("one shaping run");
    };
    assert_eq!((run.text_start, run.text_end), (0, end));
    assert_eq!(
        (run.script, run.direction),
        (u32::from_be_bytes(*b"Latn"), 0)
    );
    let styles = &state.styles.committed().arena;
    assert_eq!(styles.resolved_language(run.style), None);
    assert!(styles.resolved_features(run.style).is_empty());
    let [span] = state.fallback_spans.as_slice() else {
        panic!("one fallback span");
    };
    assert_eq!(
        (span.source_run, span.text_start, span.text_end),
        (0, 0, end)
    );
    assert_eq!(
        (span.font_index, span.binding_handle, span.font_handle),
        (0, 42, 1)
    );
    assert_eq!(state.shape.committed().runs.len(), 1);
}

/// Replaces the whole text, which the engine reduces to one edit by its common prefix and
/// suffix, and reads the measurement, the borrowed layout and the glyph facts.
fn replace_text_request<'a>(
    engine: &TextEngine,
    bytes: &'a [u8],
    style: &'a [u8],
) -> UpdateRequest<'a> {
    let revision = engine.root_revision(4).unwrap().engine;
    let mut request = update(revision, revision, revision);
    window_limits(&mut request);
    request.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
        | super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT
        | super::super::frame::SEMANTIC_VIEW_GLYPH_FACTS;
    request.text_mutations =
        parse_text_mutations(bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request.style_mutations =
        parse_style_mutations(style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request
}

/// Measures and commits `next` over the committed text. Returns the semantic records and the
/// work the measurement did.
fn replace_text(
    engine: &mut TextEngine,
    shaper: &mut ShaperRegistry,
    next: &[u16],
) -> (
    Vec<super::super::semantic_view::SemanticRecord>,
    super::super::work_attribution::Work,
) {
    let old_len = u32::try_from(engine.root_text(4).unwrap().len()).unwrap();
    let bytes = text_mutation_bytes(&[(0, old_len, next)]);
    let style = window_style(next.len());
    let request = replace_text_request(engine, &bytes, &style);
    super::super::work_attribution::reset();
    let measured = engine
        .measure_paragraph_with_shaper(shaper, request, 1)
        .unwrap();
    let work = super::super::work_attribution::snapshot();
    let records = engine.measured_semantic_views(measured).unwrap().to_vec();
    assert!(!records.is_empty());
    engine.commit_measure(measured).unwrap();
    assert_single_run(engine, next);
    (records, work)
}

fn borrowed_glyphs(engine: &TextEngine) -> Vec<super::super::positioning::SemanticGlyph> {
    let count = engine.borrowed_paragraph_layout(4, 1).unwrap();
    let mut glyphs = vec![super::super::positioning::SemanticGlyph::default(); count];
    engine
        .borrowed_paragraph_glyphs(4, 1, 0, &mut glyphs)
        .unwrap();
    glyphs
}

fn identity_high_water(engine: &TextEngine) -> (u32, u32) {
    let planner = engine.planners.get(&4).unwrap();
    (planner.next_glyph_id, planner.next_content_revision)
}

fn first_and_last_outlined_ids(engine: &TextEngine) -> [u32; 2] {
    let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
    let positioned = state.positioned.committed();
    let clusters = state.clusters.committed();
    let mut cursor = positioned.outlined_cursor(clusters, &state.boundary_shape);
    let mut first = None;
    let mut last = None;
    while let Some(mark) = cursor.next_mark().unwrap() {
        let id = positioned
            .project_outlined_mark(mark, clusters, &state.boundary_shape)
            .unwrap()
            .semantic
            .stable_id;
        first.get_or_insert(id);
        last = Some(id);
    }
    let ids = [first.unwrap(), last.unwrap()];
    assert_ne!(ids[0], ids[1]);
    ids
}

/// Applies `before` → `after` in a windowed engine and in a whole-run engine. Both must
/// commit HarfRust's cold shape of `after` and agree on the records, the placed glyphs and
/// the identity cursors. Returns the windowed engine's work.
fn length_edit_case(
    sfnt: &[u8],
    before: &str,
    after: &str,
    label: &str,
) -> super::super::work_attribution::Work {
    let (old, next) = (utf16(before), utf16(after));
    assert_ne!(old.len(), next.len());
    let (mut windowed, mut windowed_shaper) = single_font_engine(sfnt, &old, false);
    let (mut whole, mut whole_shaper) = single_font_engine(sfnt, &old, true);
    let (windowed_records, work) = replace_text(&mut windowed, &mut windowed_shaper, &next);
    let (whole_records, whole_work) = replace_text(&mut whole, &mut whole_shaper, &next);
    assert_eq!(work.main_full_run_shape_calls, 0, "{label}: no cold shape");
    assert_eq!(
        (
            whole_work.incremental_window_shape_calls,
            whole_work.incremental_window_shape_utf16_units
        ),
        (1, next.len()),
        "{label}: the reference reshapes the run whole"
    );
    let cold = cold_shape(&mut windowed_shaper, &next);
    for (name, engine) in [("windowed", &windowed), ("whole run", &whole)] {
        let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
        assert_shapes_equal(
            state.shape.committed(),
            &cold,
            &alloc::format!("{label}: {name}"),
        );
    }
    assert_eq!(windowed_records, whole_records, "{label}: measurement");
    assert_eq!(
        borrowed_glyphs(&windowed),
        borrowed_glyphs(&whole),
        "{label}: placed glyphs, ids and revisions"
    );
    assert_eq!(
        identity_high_water(&windowed),
        identity_high_water(&whole),
        "{label}: identity cursors"
    );
    work
}

#[test]
fn length_edit_window_matches_whole_run_reshape_on_every_consumer() {
    let pad = "Typography is a moving system. Layout stays put. ".repeat(40);
    for (font, sfnt, before) in [
        ("Fredoka", fredoka_baked_views().0, fredoka_corpus()),
        ("kerned", KERNED_SFNT, alloc::format!("{pad}AV{pad}")),
    ] {
        let after = with_middle_insert(&before);
        let (a, b) = (utf16(&before), utf16(&after));
        let (mut windowed, mut windowed_shaper) = single_font_engine(sfnt, &a, false);
        let (mut whole, mut whole_shaper) = single_font_engine(sfnt, &a, true);
        let (windowed_records, _) = replace_text(&mut windowed, &mut windowed_shaper, &b);
        let (whole_records, _) = replace_text(&mut whole, &mut whole_shaper, &b);
        assert_eq!(windowed_records, whole_records, "{font}: measurement");
        assert_eq!(windowed.root_text(4).unwrap(), b.as_slice());
        assert_eq!(windowed.root_revision(4), whole.root_revision(4));
        assert_eq!(identity_high_water(&windowed), identity_high_water(&whole));
        assert_eq!(
            borrowed_glyphs(&windowed),
            borrowed_glyphs(&whole),
            "{font}: placed glyphs, ids and revisions"
        );
        let windowed_state = &windowed
            .planners
            .get(&4)
            .unwrap()
            .paragraph(1)
            .unwrap()
            .state;
        let whole_state = &whole.planners.get(&4).unwrap().paragraph(1).unwrap().state;
        assert_shapes_equal(
            windowed_state.shape.committed(),
            whole_state.shape.committed(),
            font,
        );
        assert_eq!(
            windowed_state.clusters.committed().stable_ids,
            whole_state.clusters.committed().stable_ids
        );
        assert_eq!(
            windowed_state.clusters.committed().glyph_stable_ids,
            whole_state.clusters.committed().glyph_stable_ids
        );
        let selected = first_and_last_outlined_ids(&windowed);
        assert_eq!(selected, first_and_last_outlined_ids(&whole));
        let windowed_split = windowed.copy_glyphs(4, 1, 9, 1, &selected).unwrap();
        let whole_split = whole.copy_glyphs(4, 1, 9, 1, &selected).unwrap();
        let fingerprint = windowed.codecs.get(&9).unwrap().fingerprint();
        let windowed_view = windowed_split
            .plan_view(9, CapabilitySetId(1), fingerprint)
            .unwrap();
        let whole_view = whole_split
            .plan_view(9, CapabilitySetId(1), fingerprint)
            .unwrap();
        assert_eq!(windowed_view.buffers, whole_view.buffers);
        assert_eq!(windowed_view.payload, whole_view.payload);
        assert_eq!(windowed_view.session_payload, whole_view.session_payload);
        let mut published = Vec::new();
        for (engine, shaper) in [
            (&mut windowed, &mut windowed_shaper),
            (&mut whole, &mut whole_shaper),
        ] {
            let revision = engine.root_revision(4).unwrap().engine;
            let mut publish = update(revision, revision, revision);
            window_limits(&mut publish);
            let prepared = engine
                .prepare_update_with_shaper(shaper, publish, revision + 1)
                .unwrap();
            let view = engine
                .planners
                .get(&4)
                .unwrap()
                .plan
                .plan_view(9, CapabilitySetId(1), fingerprint)
                .unwrap();
            published.push((
                view.buffers.to_vec(),
                view.payload.to_vec(),
                view.session_payload.to_vec(),
            ));
            engine.commit_update(prepared).unwrap();
        }
        assert_eq!(published[0], published[1], "{font}: codec publication");
        assert_eq!(
            windowed.gather.view().plan_input().glyphs,
            whole.gather.view().plan_input().glyphs
        );
        assert_eq!(identity_high_water(&windowed), identity_high_water(&whole));
    }
}

#[test]
fn length_edit_rejection_and_post_shape_failure_follow_the_whole_run_contract() {
    let a = utf16(&fredoka_corpus());
    let mut downstream_errors = Vec::new();
    for whole_run in [false, true] {
        let (mut engine, mut shaper) = single_font_engine(fredoka_baked_views().0, &a, whole_run);
        let before_revision = engine.root_revision(4).unwrap();
        let before_glyphs = borrowed_glyphs(&engine);
        let before_high_water = identity_high_water(&engine);
        let invalid =
            text_mutation_bytes(&[(u32::try_from(a.len() + 1).unwrap(), 0, &[b'x' as u16])]);
        let revision = before_revision.engine;
        let mut request = update(revision, revision, revision);
        window_limits(&mut request);
        request.text_mutations =
            parse_text_mutations(&invalid, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.measure_paragraph_with_shaper(&mut shaper, request, 1),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.root_revision(4).unwrap(), before_revision);
        assert_eq!(engine.root_text(4).unwrap(), a.as_slice());
        assert_eq!(borrowed_glyphs(&engine), before_glyphs);
        assert_eq!(identity_high_water(&engine), before_high_water);

        // The same injected fault after the shape was prepared, in both producers. The
        // engine confines it to the paragraph.
        let mut b = a.clone();
        b.insert(a.len() / 2, u16::from(b'x'));
        let bytes = text_mutation_bytes(&[(0, u32::try_from(a.len()).unwrap(), &b)]);
        let style = window_style(b.len());
        engine
            .planners
            .get_mut(&4)
            .unwrap()
            .paragraph_mut(1)
            .unwrap()
            .state
            .fail_after_shape_once = true;
        let request = replace_text_request(&engine, &bytes, &style);
        super::super::work_attribution::reset();
        downstream_errors.push(
            engine
                .measure_paragraph_with_shaper(&mut shaper, request, 1)
                .expect_err("injected failure after the shape was prepared"),
        );
        let work = super::super::work_attribution::snapshot();
        assert_eq!(
            work.incremental_window_shape_calls, 1,
            "the fault follows a prepared incremental shape"
        );
        // The failure is the paragraph's: the root keeps its revision and the paragraph is emptied.
        assert_eq!(engine.root_revision(4).unwrap(), before_revision);
        let refused = engine.planners.get(&4).unwrap().paragraph(1).unwrap();
        assert!(refused.state.text.committed().units.is_empty());
        assert!(!refused.state.has_pending_preparation());
    }
    assert_eq!(
        downstream_errors[0], downstream_errors[1],
        "the window keeps the whole-run failure code"
    );
}

#[test]
fn letter_edit_reuses_unicode_and_a_following_length_edit_matches_whole_run() {
    let a = utf16(&fredoka_corpus());
    let sfnt = fredoka_baked_views().0;
    let (mut windowed, mut windowed_shaper) = single_font_engine(sfnt, &a, false);
    let (mut whole, mut whole_shaper) = single_font_engine(sfnt, &a, true);
    assert_eq!(a[0], u16::from(b'R'));
    let same = text_mutation_bytes(&[(0, 1, &[b'S' as u16])]);
    let mut changed = a.clone();
    changed[0] = u16::from(b'S');
    for (engine, shaper) in [
        (&mut windowed, &mut windowed_shaper),
        (&mut whole, &mut whole_shaper),
    ] {
        let analyses = |engine: &TextEngine| {
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .unicode
                .committed()
                .analysis_count()
        };
        let prior_analyses = analyses(engine);
        let revision = engine.root_revision(4).unwrap().engine;
        let mut request = update(revision, revision, revision);
        window_limits(&mut request);
        request.text_mutations =
            parse_text_mutations(&same, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        // Borrowed glyphs are compared below, so the read positions.
        request.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_GLYPH_FACTS;
        let measured = engine
            .measure_paragraph_with_shaper(shaper, request, 1)
            .unwrap();
        engine.commit_measure(measured).unwrap();
        assert_eq!(
            analyses(engine),
            prior_analyses,
            "a same-length letter edit reuses the analysed Unicode"
        );
    }
    assert_eq!(windowed.root_text(4).unwrap(), changed.as_slice());
    assert_eq!(borrowed_glyphs(&windowed), borrowed_glyphs(&whole));
    let mut next = changed.clone();
    next.insert(next.len() / 2, u16::from(b'x'));
    let (windowed_records, _) = replace_text(&mut windowed, &mut windowed_shaper, &next);
    let (whole_records, _) = replace_text(&mut whole, &mut whole_shaper, &next);
    assert_eq!(windowed_records, whole_records);
    assert_eq!(borrowed_glyphs(&windowed), borrowed_glyphs(&whole));
    assert_eq!(identity_high_water(&windowed), identity_high_water(&whole));
    let cold = cold_shape(&mut windowed_shaper, &next);
    let state = &windowed
        .planners
        .get(&4)
        .unwrap()
        .paragraph(1)
        .unwrap()
        .state;
    assert_shapes_equal(
        state.shape.committed(),
        &cold,
        "length edit after letter edit",
    );
}

#[test]
fn alternating_insert_and_removal_match_cold_shape_with_one_bounded_window() {
    let pad = "Typography is a moving system. Layout stays put. ".repeat(40);
    for (font, sfnt, a, bounded) in [
        ("Fredoka", fredoka_baked_views().0, fredoka_corpus(), false),
        ("kerned", KERNED_SFNT, alloc::format!("{pad}AV{pad}"), true),
    ] {
        let b = with_middle_insert(&a);
        let (a, b) = (utf16(&a), utf16(&b));
        let (mut engine, mut shaper) = single_font_engine(sfnt, &a, false);
        let cold = cold_shape(&mut shaper, &a);
        let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
        assert_shapes_equal(
            state.shape.committed(),
            &cold,
            &alloc::format!("{font}: mounted"),
        );
        for (stage, next) in [("insert", &b), ("remove", &a), ("insert again", &b)] {
            let (_, work) = replace_text(&mut engine, &mut shaper, next);
            assert_eq!(
                (
                    work.main_full_run_shape_calls,
                    work.incremental_window_shape_calls
                ),
                (0, 1),
                "{font} {stage}: one window, no cold shape"
            );
            if bounded {
                // The window ends at the nearest boundary the kerned pair does not reach, and
                // its probe four clusters further on each side.
                assert!(
                    work.incremental_window_shape_utf16_units <= 16,
                    "{font} {stage}: shaped {} units of {}",
                    work.incremental_window_shape_utf16_units,
                    next.len()
                );
            }
            let cold = cold_shape(&mut shaper, next);
            let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
            assert_shapes_equal(
                state.shape.committed(),
                &cold,
                &alloc::format!("{font}: {stage}"),
            );
        }
    }
}

/// The fixtures' default Latin features are the ones the cases below name.
fn assert_default_latn_lookup_map(sfnt: &[u8]) {
    use read_fonts::tables::layout::{FeatureList, ScriptList};
    fn selected(
        scripts: &ScriptList<'_>,
        features: &FeatureList<'_>,
        feature_tag: &[u8; 4],
        indices: &[u16],
    ) {
        let record = scripts
            .script_records()
            .iter()
            .find(|record| record.script_tag() == read_fonts::types::Tag::new(b"latn"))
            .expect("missing default latn script");
        let script = record.script(scripts.offset_data()).unwrap();
        let lang = script.default_lang_sys().unwrap().unwrap();
        assert_eq!(
            lang.feature_indices()
                .iter()
                .map(|index| index.get())
                .collect::<Vec<_>>(),
            vec![0]
        );
        let record = &features.feature_records()[0];
        assert_eq!(
            record.feature_tag(),
            read_fonts::types::Tag::new(feature_tag)
        );
        let feature = record.feature(features.offset_data()).unwrap();
        assert_eq!(
            feature
                .lookup_list_indices()
                .iter()
                .map(|index| index.get())
                .collect::<Vec<_>>(),
            indices
        );
    }
    let font = read_fonts::FontRef::new(sfnt).unwrap();
    let gsub = font.gsub().unwrap();
    selected(
        &gsub.script_list().unwrap(),
        &gsub.feature_list().unwrap(),
        b"liga",
        &[0, 1, 2],
    );
    assert_eq!(
        gsub.lookup_list()
            .unwrap()
            .lookups()
            .iter()
            .map(|lookup| lookup.unwrap().lookup_type())
            .collect::<Vec<_>>(),
        vec![1, 2, 4]
    );
    let gpos = font.gpos().unwrap();
    selected(
        &gpos.script_list().unwrap(),
        &gpos.feature_list().unwrap(),
        b"kern",
        &[0, 1],
    );
    assert_eq!(
        gpos.lookup_list()
            .unwrap()
            .lookups()
            .iter()
            .map(|lookup| lookup.unwrap().lookup_type())
            .collect::<Vec<_>>(),
        vec![2, 2]
    );
}

#[test]
fn length_edits_beside_each_lookup_kind_match_cold_shape() {
    for sfnt in [
        KERNED_SFNT,
        PAIR1_VALUE2_SFNT,
        PAIR2_VALUE2_SFNT,
        LONG_LIGATURE_SFNT,
    ] {
        assert_default_latn_lookup_map(sfnt);
    }
    let pad = "Typography is a moving system. Layout stays put. ".repeat(3);
    // Each piece doubles the glyph a lookup reads: the pair's second glyph, the ligature's
    // second component, or the substituted glyph itself. The names say which branch of the
    // lookup the old text takes; only the equality below is asserted.
    let (mut edits, mut retried) = (0, 0);
    for (name, old_piece, new_piece) in [
        ("pair by glyph, first glyph uncovered", "Bn", "Bnn"),
        ("pair by glyph, pair missing", "An", "Ann"),
        ("pair by glyph, zero value", "Ap", "App"),
        ("pair by glyph, kerned", "AV", "AVV"),
        ("pair by class, zero value", "TA", "TAA"),
        ("pair by class, kerned", "WA", "WAA"),
        ("ligature, later component differs", "fiA", "fiiA"),
        ("ligature, second component differs", "fA", "ffA"),
        ("ligature formed", "fiT", "fiiT"),
        ("second ligature set, not formed", "sA", "ssA"),
        ("second ligature set, formed", "shA", "shhA"),
        ("single, multiple and ligature substitution", "xA", "xxA"),
    ] {
        let old = alloc::format!("{pad}{old_piece}{pad}");
        let new = alloc::format!("{pad}{new_piece}{pad}");
        for sfnt in [
            KERNED_SFNT,
            PAIR1_VALUE2_SFNT,
            PAIR2_VALUE2_SFNT,
            LONG_LIGATURE_SFNT,
        ] {
            for (before, after, label) in [
                (&old, &new, name.to_string()),
                (&new, &old, alloc::format!("{name}, reversed")),
            ] {
                let work = length_edit_case(sfnt, before, after, &label);
                edits += 1;
                if work.incremental_window_shape_calls == 1 {
                    assert!(
                        work.incremental_window_shape_utf16_units <= 16,
                        "{label}: a window, not the run"
                    );
                } else {
                    // The fresh shape flagged an end of the window, which the retained shape
                    // had not: the run was reshaped whole after the window.
                    retried += 1;
                }
            }
        }
    }
    eprintln!("{retried} of {edits} edits reshaped the run whole");
    assert!(retried * 8 <= edits, "{retried} of {edits} edits retried");
}

#[test]
fn length_edits_with_no_boundary_to_window_on_match_cold_shape() {
    // Every glyph of the old shape is flagged, so the window is the run.
    let work = length_edit_case(KERNED_SFNT, "ffi", "fffi", "inside a ligature");
    assert_eq!(work.incremental_window_shape_utf16_units, 4);
    length_edit_case(KERNED_SFNT, "fffi", "ffi", "inside a ligature, reversed");
    // An edit at either end of the run has no boundary on that side.
    let pad = "Typography is a moving system. Layout stays put. ".repeat(3);
    for (name, old, new) in [
        (
            "append",
            alloc::format!("{pad}AV"),
            alloc::format!("{pad}AVV"),
        ),
        (
            "prepend",
            alloc::format!("AV{pad}"),
            alloc::format!("AAV{pad}"),
        ),
    ] {
        length_edit_case(KERNED_SFNT, &old, &new, name);
        length_edit_case(KERNED_SFNT, &new, &old, &alloc::format!("{name}, reversed"));
    }
    // A paragraph longer than any fixed bound on a window's search.
    let long = "A ".repeat(4_100);
    length_edit_case(
        KERNED_SFNT,
        &long,
        &with_middle_insert(&long),
        "8,200 units",
    );
}
