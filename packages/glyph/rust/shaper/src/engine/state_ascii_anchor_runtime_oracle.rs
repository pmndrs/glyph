// Test-only, unapplied source. Include this inside state.rs's existing `mod tests`.
// It is a falsifier for the baked Fredoka shaping subset, not a production splice.

fn fredoka_baked_views() -> (&'static [u8], &'static [u8], &'static [u8]) {
    const GLB: &[u8] = include_bytes!(
        "../../../../../../benches/fixtures/rendering/fredoka-issue-216-bitmap-16.font.glb"
    );
    fn word(bytes: &[u8], start: usize) -> usize {
        usize::try_from(u32::from_le_bytes(bytes[start..start + 4].try_into().unwrap())).unwrap()
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
    assert_eq!((sfnt.len(), extents.len(), availability.len()), (5_648, 872, 14));
    assert_eq!(
        read_fonts::FontRef::new(sfnt)
            .unwrap()
            .maxp()
            .unwrap()
            .num_glyphs(),
        109
    );
    (sfnt, extents, availability)
}

fn frozen_fredoka_corpus() -> String {
    // Literal source is fixture.ts:103-119; only ASCII occurs, so JS string length,
    // UTF-16 unit count, and Rust byte count coincide for this exact corpus.
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
    let sentence =
        "Reveals one grapheme at a time over a duration. Layout stays put and a trigger fires at the end. ";
    sentence.repeat(ordinary_len.div_ceil(sentence.len()))
}

fn fredoka_raw_shape(shaper: &mut ShaperRegistry, text: &[u16]) -> ShapeArena {
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
    assert!(!shape.glyph_ids.contains(&0), "baked subset must cover corpus");
    shape
}

// Test-only runtime oracle: real mounted A, measured B/A/B, accepted General state.
// The direct cold comparison runs after each work snapshot, outside the meter assertion.

fn fredoka_engine_shape_matches_direct(
    engine: &TextEngine,
    shaper: &mut ShaperRegistry,
    text: &[u16],
    stage: &str,
) {
    let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
    assert!(matches!(state.prepared_layout.committed(), PreparedLayout::General));
    assert_eq!(state.text.committed().units.as_slice(), text);
    let runs = state.shaping_runs.committed().runs();
    assert_eq!(runs.len(), 1, "{stage}: direct probe requires exactly one engine run");
    let run = runs[0];
    assert_eq!((run.text_start, run.text_end), (0, u32::try_from(text.len()).unwrap()));
    assert_eq!(run.script, u32::from_be_bytes(*b"Latn"));
    assert_eq!(run.direction, 0);
    assert_eq!(run.style.font_stack_handle, 7);
    assert_eq!(run.style.font_size.to_bits(), 24_f32.to_bits());
    let styles = &state.styles.committed().arena;
    assert_eq!(styles.resolved_language(run.style), None);
    assert!(styles.resolved_features(run.style).is_empty());
    let spans = &state.fallback_spans;
    assert_eq!(spans.len(), 1, "{stage}: direct probe assumes no fallback split");
    let span = spans[0];
    assert_eq!((span.source_run, span.text_start, span.text_end),
        (0, 0, u32::try_from(text.len()).unwrap()));
    assert_eq!((span.font_index, span.binding_handle, span.font_handle), (0, 42, 1));
    let actual = state.shape.committed();
    assert_eq!(actual.runs.len(), 1);
    assert_eq!(actual.runs[0].source_run, 0);
    assert_eq!((actual.runs[0].binding_handle, actual.runs[0].font_handle), (42, 1));
    // The direct probe uses this exact descriptor, now checked against the real
    // prepared run: full span, Latn, no language/features, LTR, level 0, flags 0x40.
    let direct = fredoka_raw_shape(shaper, text);
    assert_eq!(actual.runs, direct.runs, "{stage}: shaped run topology");
    assert_eq!(actual.glyph_ids, direct.glyph_ids, "{stage}: glyph IDs");
    assert_eq!(actual.clusters, direct.clusters, "{stage}: source clusters");
    assert_eq!(actual.x_advances, direct.x_advances, "{stage}: raw x advance");
    assert_eq!(actual.y_advances, direct.y_advances, "{stage}: raw y advance");
    assert_eq!(actual.x_offsets, direct.x_offsets, "{stage}: raw x offset");
    assert_eq!(actual.y_offsets, direct.y_offsets, "{stage}: raw y offset");
    assert_eq!(actual.glyph_flags, direct.glyph_flags, "{stage}: raw flags");
}

#[test]
fn baked_fredoka_runtime_anchor_splice_is_bounded_and_rebuilds_clusters() {
    let (sfnt, extents, availability) = fredoka_baked_views();
    let mut shaper = ShaperRegistry::default();
    assert_eq!(shaper.register_font(1, sfnt, extents, availability, 0, 0), 0);
    let mut engine = TextEngine::default();
    let mut codec = validated_codec(TechniqueId(1));
    let mut capability_sets = codec.capability_sets().to_vec();
    for set in &mut capability_sets { set.max_buffer_bytes = 1 << 20; }
    codec = ValidatedCodec::new(CodecDescriptor {
        capability_sets,
        programs: codec.programs().to_vec(),
    }).unwrap();
    engine.register_codec(9, codec).unwrap();
    engine.register_font_binding(42, 1, 109, render_binding(109, 1)).unwrap();
    engine.register_font_stack(7, &[42]).unwrap();
    engine.create_root(4).unwrap();
    let a = frozen_fredoka_corpus();
    let middle = a.len() >> 1;
    let b = alloc::format!("{}x{}", &a[..middle], &a[middle..]);
    let a_units = utf16(&a);
    let b_units = utf16(&b);
    engine.reserve_root_text(4, u32::try_from(b_units.len()).unwrap()).unwrap();
    let mut style = root_style_bytes_for_text(7, u32::try_from(a_units.len()).unwrap());
    write_f32(&mut style,
        ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
        24.0);
    let mut geometry = multiline_root_geometry_bytes();
    let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
    let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
    write_f32(&mut geometry, constraint + abi::ENGINE_CONSTRAINT_WIDTH, 600.0);
    for field in [abi::ENGINE_REGION_INLINE_END, abi::ENGINE_REGION_CLIP_INLINE_END] {
        write_f32(&mut geometry, region + field, 600.0);
    }
    let initial_bytes = text_mutation_bytes(&[(0, 0, &a_units)]);
    let mut cold = update(0, 0, 0);
    cold.limits.max_clusters = 8_192;
    cold.limits.max_lines = 8_192;
    cold.limits.max_output_bytes = 1 << 22;
    cold.text_mutations = parse_text_mutations(
        &initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    cold.style_mutations = parse_style_mutations(
        &style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    cold.geometry = parse_root_geometry(&geometry, cold.limits);
    let published_a = engine.prepare_update_with_shaper(&mut shaper, cold, 1).unwrap();
    engine.commit_update(published_a).unwrap();
    fredoka_engine_shape_matches_direct(&engine, &mut shaper, &a_units, "mounted A");

    // The frozen generator primes B with set+measure before yielding the timed
    // alternating A/B callback. K commits every accepted measurement revision.
    for (stage, old_len, next) in [
        ("primed B", a_units.len(), b_units.as_slice()),
        ("timed A", b_units.len(), a_units.as_slice()),
        ("timed B", a_units.len(), b_units.as_slice()),
    ] {
        let revision = engine.root_revision(4).unwrap().engine;
        let bytes = text_mutation_bytes(&[(0, u32::try_from(old_len).unwrap(), next)]);
        let mut request = update(revision, revision, revision);
        request.limits.max_clusters = 8_192;
        request.limits.max_lines = 8_192;
        request.limits.max_output_bytes = 1 << 22;
        request.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
            | super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT;
        let mut updated_style = root_style_bytes_for_text(7, u32::try_from(next.len()).unwrap());
        write_f32(&mut updated_style,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
            24.0);
        request.style_mutations = parse_style_mutations(
            &updated_style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        request.text_mutations = parse_text_mutations(
            &bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        super::super::work_attribution::reset();
        let measured = engine.measure_paragraph_with_shaper(&mut shaper, request, 1).unwrap();
        let work = super::super::work_attribution::snapshot();
        eprintln!("{stage}: complete work snapshot {work:?}");
        let downstream_calls = work.harfrust_calls
            .checked_sub(work.ascii_anchor_item_calls + work.main_full_run_shape_calls
                + work.incremental_window_shape_calls)
            .expect("producer call bins cannot exceed inclusive HarfRust calls");
        let downstream_units = work.harfrust_utf16_units
            .checked_sub(work.ascii_anchor_item_utf16_units
                + work.main_full_run_shape_utf16_units
                + work.incremental_window_shape_utf16_units)
            .expect("producer units cannot exceed inclusive HarfRust units");
        eprintln!("{stage}: main bounded calls={} units={} successes={}, main full calls={} units={}, incremental-window calls={} units={}, downstream calls={} units={}, inclusive calls={} units={}, bootstrap calls={} units={}",
            work.ascii_anchor_item_calls, work.ascii_anchor_item_utf16_units,
            work.ascii_anchor_splice_successes, work.main_full_run_shape_calls,
            work.main_full_run_shape_utf16_units, work.incremental_window_shape_calls,
            work.incremental_window_shape_utf16_units, downstream_calls, downstream_units,
            work.harfrust_calls, work.harfrust_utf16_units,
            work.ascii_nominal_bootstrap_calls, work.ascii_nominal_bootstrap_utf16_units);
        assert_eq!(work.ascii_anchor_item_calls, 1,
            "{stage}: optional producer must shape exactly one guard item");
        assert_eq!(work.ascii_anchor_splice_successes, 1,
            "{stage}: a tentative bounded call followed by full fallback is not proof");
        assert_eq!(work.main_full_run_shape_calls, 0,
            "{stage}: the ordinary whole-run producer must not replay");
        assert_eq!(work.incremental_window_shape_calls, 0,
            "{stage}: the incremental whole-window producer must not replay");
        assert!(work.ascii_anchor_item_utf16_units > 0
            && work.ascii_anchor_item_utf16_units <= 256,
            "{stage}: guard item exceeds certificate cap");
        assert!(downstream_calls > 0 && downstream_units > 0,
            "{stage}: preserve and report flow/boundary shaping separately");
        assert_eq!(work.cluster_full_builds, 1, "{stage}: downstream stays whole-dirty");
        let first_use = stage == "primed B";
        assert_eq!(work.ascii_nominal_bootstrap_calls, usize::from(first_use));
        assert_eq!(work.ascii_nominal_bootstrap_utf16_units,
            if first_use { 95 } else { 0 });
        assert!(!engine.measured_semantic_views(measured).unwrap().is_empty());
        engine.commit_measure(measured).unwrap();
        fredoka_engine_shape_matches_direct(&engine, &mut shaper, next, stage);
    }
}
