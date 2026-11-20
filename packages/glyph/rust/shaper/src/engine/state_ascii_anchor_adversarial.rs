// Generated-font accepted-engine oracle. Authored labels alone do not prove
// that a private HarfRust lookup branch was selected.

const ANCHOR_SUPPORTED_SFNT: &[u8] = include_bytes!("adversarial-fonts/supported.sfnt");
const ANCHOR_PAIR1_V2_SFNT: &[u8] = include_bytes!("adversarial-fonts/value2-pair1-reject.sfnt");
const ANCHOR_PAIR2_V2_SFNT: &[u8] = include_bytes!("adversarial-fonts/value2-pair2-reject.sfnt");
const ANCHOR_LONG_LIG_SFNT: &[u8] = include_bytes!("adversarial-fonts/long-ligature-reject.sfnt");

fn assert_default_latn_lookup_map(sfnt: &[u8]) {
    use read_fonts::tables::layout::{FeatureList, ScriptList};
    fn selected(scripts: &ScriptList<'_>, features: &FeatureList<'_>,
        feature_tag: &[u8; 4], indices: &[u16]) {
        let record = scripts.script_records().iter()
            .find(|record| record.script_tag() == read_fonts::types::Tag::new(b"latn"))
            .expect("missing default latn script");
        let script = record.script(scripts.offset_data()).unwrap();
        let lang = script.default_lang_sys().unwrap().unwrap();
        assert_eq!(lang.feature_indices().iter().map(|index| index.get()).collect::<Vec<_>>(), vec![0]);
        let record = &features.feature_records()[0];
        assert_eq!(record.feature_tag(), read_fonts::types::Tag::new(feature_tag));
        let feature = record.feature(features.offset_data()).unwrap();
        assert_eq!(feature.lookup_list_indices().iter().map(|index| index.get()).collect::<Vec<_>>(), indices);
    }
    let font = read_fonts::FontRef::new(sfnt).unwrap();
    let gsub = font.gsub().unwrap();
    selected(&gsub.script_list().unwrap(), &gsub.feature_list().unwrap(), b"liga", &[0, 1, 2]);
    assert_eq!(gsub.lookup_list().unwrap().lookups().iter()
        .map(|lookup| lookup.unwrap().lookup_type()).collect::<Vec<_>>(), vec![1, 2, 4]);
    let gpos = font.gpos().unwrap();
    selected(&gpos.script_list().unwrap(), &gpos.feature_list().unwrap(), b"kern", &[0, 1]);
    assert_eq!(gpos.lookup_list().unwrap().lookups().iter()
        .map(|lookup| lookup.unwrap().lookup_type()).collect::<Vec<_>>(), vec![2, 2]);
}

fn accepted_adversarial_engine(
    sfnt: &[u8], text: &[u16], force_ordinary: bool,
) -> (TextEngine, ShaperRegistry) {
    let (_, extents, availability) = fredoka_baked_views();
    let parsed = read_fonts::FontRef::new(sfnt).unwrap();
    assert_default_latn_lookup_map(sfnt);
    assert_eq!(parsed.maxp().unwrap().num_glyphs(), 109);
    assert!(parsed.gdef().unwrap().glyph_class_def().unwrap().is_ok());
    let mut shaper = ShaperRegistry::default();
    assert_eq!(shaper.register_font(1, sfnt, extents, availability, 0, 0), 0);
    let mut engine = TextEngine::default();
    let mut codec = validated_codec(TechniqueId(1));
    let mut capability_sets = codec.capability_sets().to_vec();
    for set in &mut capability_sets { set.max_buffer_bytes = 1 << 20; }
    codec = ValidatedCodec::new(CodecDescriptor {
        capability_sets, programs: codec.programs().to_vec(),
    }).unwrap();
    engine.register_codec(9, codec).unwrap();
    engine.register_font_binding(42, 1, 109, render_binding(109, 1)).unwrap();
    engine.register_font_stack(7, &[42]).unwrap();
    engine.create_root(4).unwrap();
    engine.reserve_root_text(4, u32::try_from(text.len() + 1).unwrap()).unwrap();
    let spare = engine.planners.get_mut(&4).unwrap().spare_paragraph.as_mut().unwrap();
    spare.disable_inline = true;
    spare.disable_ascii_anchor = force_ordinary;
    let mut style = root_style_bytes_for_text(7, u32::try_from(text.len()).unwrap());
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
    let initial = text_mutation_bytes(&[(0, 0, text)]);
    let mut cold = update(0, 0, 0);
    cold.limits.max_clusters = 8_192;
    cold.limits.max_lines = 8_192;
    cold.limits.max_output_bytes = 1 << 22;
    cold.text_mutations = parse_text_mutations(
        &initial, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    cold.style_mutations = parse_style_mutations(
        &style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    cold.geometry = parse_root_geometry(&geometry, cold.limits);
    let prepared = engine.prepare_update_with_shaper(&mut shaper, cold, 1).unwrap();
    engine.commit_update(prepared).unwrap();
    (engine, shaper)
}

fn assert_accepted_descriptor(engine: &TextEngine, text: &[u16]) {
    let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
    assert!(matches!(state.prepared_layout.committed(), PreparedLayout::General));
    assert_eq!(state.text.committed().units.as_slice(), text);
    let runs = state.shaping_runs.committed().runs();
    assert_eq!(runs.len(), 1);
    let run = runs[0];
    assert_eq!((run.text_start, run.text_end), (0, u32::try_from(text.len()).unwrap()));
    assert_eq!((run.script, run.direction), (u32::from_be_bytes(*b"Latn"), 0));
    assert_eq!(run.style.font_stack_handle, 7);
    assert_eq!(run.style.font_size.to_bits(), 24_f32.to_bits());
    let styles = &state.styles.committed().arena;
    assert_eq!(styles.resolved_language(run.style), None);
    assert!(styles.resolved_features(run.style).is_empty());
    assert_eq!(state.fallback_spans.len(), 1);
    let span = state.fallback_spans[0];
    assert_eq!((span.source_run, span.text_start, span.text_end),
        (0, 0, u32::try_from(text.len()).unwrap()));
    assert_eq!((span.font_index, span.binding_handle, span.font_handle), (0, 42, 1));
    assert_eq!(state.shape.committed().runs.len(), 1);
}

fn accepted_adversarial_raw_case(sfnt: &[u8], before: &str, after: &str, label: &str) {
    use crate::ascii_anchor_policy::{self as policy, AsciiUse};
    let old: Vec<u16> = before.encode_utf16().collect();
    let new: Vec<u16> = after.encode_utf16().collect();
    let (mut engine, mut shaper) = accepted_adversarial_engine(sfnt, &old, false);
    assert_accepted_descriptor(&engine, &old);
    let mut screen = policy::screen_font(sfnt).unwrap();
    policy::bootstrap_registered_nominals(&shaper, 1, &mut screen).unwrap();
    let mut edits = Vec::new();
    collect_text_edits(&old, &new, TextReconciliation::FullReplacement, &mut edits, 0).unwrap();
    assert_eq!(edits.len(), 1);
    let edit = edits[0];
    let window = policy::fixed_window(&screen, &old, &new,
        edit.old_start, edit.old_end, edit.new_end,
        &AsciiUse::from_test_text(&old).unwrap(),
        &AsciiUse::from_test_text(&new).unwrap()).unwrap();
    let mut guarded = ShapeArena::default();
    let end = u32::try_from(new.len()).unwrap();
    let run = ShapeRunRef { text_start: 0, text_end: end,
        script: u32::from_be_bytes(*b"Latn"), language: None, features: &[],
        direction: 0, cluster_level: 0, flags: 0x40 };
    let range = ShapeRangeRef { item_start: u32::try_from(window.new_outer_left).unwrap(),
        item_end: u32::try_from(window.new_outer_end).unwrap(),
        context_start: 0, context_end: end, flags: 0x40 };
    shaper.with_shaped_range(1, &new, run, range, |glyphs| {
        guarded.append(0, 1, 42, range.item_start, range.item_end, glyphs)
    }).unwrap();
    let old_shape = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state.shape.committed();
    let splice = policy::splice_raw(old_shape, &guarded, window,
        u32::try_from(old.len()).unwrap(), end).unwrap();

    // Apply the real length-changing setter with its matching style span, then
    // commit the immediate measurement. This is the authoritative new arena.
    let revision = engine.root_revision(4).unwrap().engine;
    let bytes = text_mutation_bytes(&[(0, u32::try_from(old.len()).unwrap(), &new)]);
    let mut request = update(revision, revision, revision);
    request.limits.max_clusters = 8_192;
    request.limits.max_lines = 8_192;
    request.limits.max_output_bytes = 1 << 22;
    request.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
        | super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT;
    let mut updated_style = root_style_bytes_for_text(7, end);
    write_f32(&mut updated_style,
        ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
        24.0);
    request.style_mutations = parse_style_mutations(
        &updated_style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request.text_mutations = parse_text_mutations(
        &bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    let measured = engine.measure_paragraph_with_shaper(&mut shaper, request, 1).unwrap();
    assert!(!engine.measured_semantic_views(measured).unwrap().is_empty());
    engine.commit_measure(measured).unwrap();
    assert_accepted_descriptor(&engine, &new);
    let accepted = engine.planners.get(&4).unwrap().paragraph(1).unwrap().state.shape.committed();
    let cold = fredoka_raw_shape(&mut shaper, &new);
    for (name, got) in [("splice", &splice), ("engine accepted", accepted)] {
        assert_eq!(got.runs, cold.runs, "{label}: {name} run header");
        assert_eq!(got.glyph_ids, cold.glyph_ids, "{label}: {name} glyph IDs");
        assert_eq!(got.clusters, cold.clusters, "{label}: {name} clusters");
        assert_eq!(got.x_advances, cold.x_advances, "{label}: {name} x advance");
        assert_eq!(got.y_advances, cold.y_advances, "{label}: {name} y advance");
        assert_eq!(got.x_offsets, cold.x_offsets, "{label}: {name} x offset");
        assert_eq!(got.y_offsets, cold.y_offsets, "{label}: {name} y offset");
        assert_eq!(got.glyph_flags, cold.glyph_flags, "{label}: {name} raw flags");
    }
}

#[test]
fn adversarial_supported_font_uses_accepted_engine_old_arena() {
    let pad = "Typography is a moving system. Layout stays put. ".repeat(3);
    for (name, old_piece, new_piece) in [
        ("pair1 uncovered first", "Bn", "Bnn"),
        ("pair1 missing", "An", "Ann"),
        ("pair1 zero", "Ap", "App"),
        ("pair1 nonzero", "AV", "AVV"),
        ("pair2 classzero zero", "TA", "TAA"),
        ("pair2 classzero nonzero", "WA", "WAA"),
        ("fast later mismatch", "fiA", "fiiA"),
        ("fast second digest miss", "fA", "ffA"),
        ("fast success", "fiT", "fiiT"),
        ("slow failure", "sA", "ssA"),
        ("slow success", "shA", "shhA"),
        ("single multiple ligature", "xA", "xxA"),
    ] {
        let old = alloc::format!("{pad}{old_piece}{pad}");
        let new = alloc::format!("{pad}{new_piece}{pad}");
        accepted_adversarial_raw_case(ANCHOR_SUPPORTED_SFNT, &old, &new, name);
        accepted_adversarial_raw_case(ANCHOR_SUPPORTED_SFNT, &new, &old,
            &alloc::format!("{name} reverse"));
    }
}

#[test]
fn adversarial_unsupported_tables_reject_before_partial_shape() {
    use crate::ascii_anchor_policy::{self as policy, Unsupported};
    assert!(matches!(policy::screen_font(ANCHOR_PAIR1_V2_SFNT), Err(Unsupported::Lookup)));
    assert!(matches!(policy::screen_font(ANCHOR_PAIR2_V2_SFNT), Err(Unsupported::Lookup)));
    assert!(matches!(policy::screen_font(ANCHOR_LONG_LIG_SFNT), Err(Unsupported::Resource)));
}

fn accepted_adversarial_fallback_pair(
    sfnt: &[u8], before: &str, after: &str, label: &str, over_cap: bool,
) {
    let old = utf16(before);
    let next = utf16(after);
    let (mut fast, mut fast_shaper) = accepted_adversarial_engine(sfnt, &old, false);
    let (mut ordinary, mut ordinary_shaper) = accepted_adversarial_engine(sfnt, &old, true);
    assert_accepted_descriptor(&fast, &old);
    assert_accepted_descriptor(&ordinary, &old);
    let bytes = text_mutation_bytes(&[(0, u32::try_from(old.len()).unwrap(), &next)]);
    let style = acceptance_style(next.len());
    let mut records = Vec::new();
    for (engine, shaper) in [(&mut fast, &mut fast_shaper),
                             (&mut ordinary, &mut ordinary_shaper)] {
        let request = acceptance_edit(engine, old.len(), &next, &bytes, &style);
        super::super::work_attribution::reset();
        let measured = engine.measure_paragraph_with_shaper(shaper, request, 1).unwrap();
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.ascii_anchor_item_calls, 0, "{label}: optional item must not shape");
        assert_eq!(work.ascii_anchor_splice_successes, 0, "{label}: no optional splice");
        assert!(work.incremental_window_shape_calls > 0 || work.main_full_run_shape_calls > 0,
            "{label}: ordinary whole producer must run");
        if over_cap {
            assert_eq!(work.ascii_nominal_bootstrap_calls, 0,
                "{label}: whole-length cap must reject before lazy bootstrap");
        }
        records.push(engine.measured_semantic_views(measured).unwrap().to_vec());
        engine.commit_measure(measured).unwrap();
    }
    assert_eq!(records[0], records[1], "{label}: immediate measurement");
    assert_eq!(acceptance_borrowed(&fast), acceptance_borrowed(&ordinary),
        "{label}: positioned glyphs/IDs");
    assert_eq!(acceptance_high_water(&fast), acceptance_high_water(&ordinary),
        "{label}: identity cursors");
    let a = &fast.planners.get(&4).unwrap().paragraph(1).unwrap().state;
    let b = &ordinary.planners.get(&4).unwrap().paragraph(1).unwrap().state;
    let (a, b) = (a.shape.committed(), b.shape.committed());
    assert_eq!(a.runs, b.runs, "{label}: run header");
    assert_eq!(a.glyph_ids, b.glyph_ids, "{label}: raw glyphs");
    assert_eq!(a.clusters, b.clusters, "{label}: raw clusters");
    assert_eq!(a.x_advances, b.x_advances, "{label}: raw x advances");
    assert_eq!(a.y_advances, b.y_advances, "{label}: raw y advances");
    assert_eq!(a.x_offsets, b.x_offsets, "{label}: raw x offsets");
    assert_eq!(a.y_offsets, b.y_offsets, "{label}: raw y offsets");
    assert_eq!(a.glyph_flags, b.glyph_flags, "{label}: raw flags");
}

#[test]
fn ascii_anchor_supported_edge_and_cap_fall_back_to_ordinary_producer() {
    accepted_adversarial_fallback_pair(
        ANCHOR_SUPPORTED_SFNT, "ffi", "fffi", "insufficient immutable anchors", false);
    let long = "A ".repeat(4_100);
    let mut longer = long.clone();
    longer.insert(longer.len() / 2, 'x');
    accepted_adversarial_fallback_pair(
        ANCHOR_SUPPORTED_SFNT, &long, &longer, "whole paragraph over 8192", true);
}

#[test]
fn ascii_anchor_unsupported_generated_fonts_fall_back_to_ordinary_producer() {
    let pad = "Typography is a moving system. Layout stays put. ".repeat(3);
    let before = alloc::format!("{pad}AV{pad}");
    let after = alloc::format!("{pad}AVV{pad}");
    for (font, label) in [
        (ANCHOR_PAIR1_V2_SFNT, "Pair1 Value2"),
        (ANCHOR_PAIR2_V2_SFNT, "Pair2 Value2"),
        (ANCHOR_LONG_LIG_SFNT, "overlong ligature"),
    ] {
        accepted_adversarial_fallback_pair(font, &before, &after, label, false);
    }
}
