// Test-only real-engine lifecycle comparison. The sibling runtime-oracle include
// supplies the authenticated baked GLB reader and frozen Fredoka corpus.

fn acceptance_fredoka_engine(force_ordinary: bool) -> (TextEngine, ShaperRegistry, Vec<u16>) {
    let (sfnt, extents, availability) = fredoka_baked_views();
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
    let a = utf16(&frozen_fredoka_corpus());
    engine.reserve_root_text(4, u32::try_from(a.len() + 1).unwrap()).unwrap();
    let spare = engine.planners.get_mut(&4).unwrap().spare_paragraph.as_mut().unwrap();
    spare.disable_inline = true;
    spare.disable_ascii_anchor = force_ordinary;
    let mut style = root_style_bytes_for_text(7, u32::try_from(a.len()).unwrap());
    write_f32(&mut style,
        ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_FONT_SIZE, 24.0);
    let mut geometry = multiline_root_geometry_bytes();
    let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
    let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
    write_f32(&mut geometry, constraint + abi::ENGINE_CONSTRAINT_WIDTH, 600.0);
    for field in [abi::ENGINE_REGION_INLINE_END, abi::ENGINE_REGION_CLIP_INLINE_END] {
        write_f32(&mut geometry, region + field, 600.0);
    }
    let bytes = text_mutation_bytes(&[(0, 0, &a)]);
    let mut request = update(0, 0, 0);
    request.limits.max_clusters = 8_192;
    request.limits.max_lines = 8_192;
    request.limits.max_output_bytes = 1 << 22;
    request.text_mutations = parse_text_mutations(
        &bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request.style_mutations = parse_style_mutations(
        &style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request.geometry = parse_root_geometry(&geometry, request.limits);
    let prepared = engine.prepare_update_with_shaper(&mut shaper, request, 1).unwrap();
    engine.commit_update(prepared).unwrap();
    assert!(matches!(engine.planners.get(&4).unwrap().paragraph(1).unwrap()
        .state.prepared_layout.committed(), PreparedLayout::General));
    (engine, shaper, a)
}

fn acceptance_edit<'a>(
    engine: &TextEngine, old_len: usize, next: &'a [u16],
    bytes: &'a [u8], style: &'a [u8],
) -> UpdateRequest<'a> {
    let revision = engine.root_revision(4).unwrap().engine;
    let mut request = update(revision, revision, revision);
    request.limits.max_clusters = 8_192;
    request.limits.max_lines = 8_192;
    request.limits.max_output_bytes = 1 << 22;
    // The acceptance compares borrowed glyphs right after the read, so the read positions.
    request.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
        | super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT
        | super::super::frame::SEMANTIC_VIEW_GLYPH_FACTS;
    request.text_mutations = parse_text_mutations(bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
        .unwrap();
    request.style_mutations = parse_style_mutations(style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
        .unwrap();
    assert_eq!(request.text_mutations.len(), 1);
    assert_eq!(engine.root_text(4).unwrap().len(), old_len);
    assert!(!next.is_empty());
    request
}

fn acceptance_style(text_len: usize) -> Vec<u8> {
    let mut style = root_style_bytes_for_text(7, u32::try_from(text_len).unwrap());
    write_f32(&mut style,
        ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_FONT_SIZE, 24.0);
    style
}

fn acceptance_borrowed(engine: &TextEngine) -> Vec<super::super::positioning::SemanticGlyph> {
    let count = engine.borrowed_paragraph_layout(4, 1).unwrap();
    let mut glyphs = vec![super::super::positioning::SemanticGlyph::default(); count];
    engine.borrowed_paragraph_glyphs(4, 1, 0, &mut glyphs).unwrap();
    glyphs
}

fn acceptance_high_water(engine: &TextEngine) -> (u32, u32) {
    let planner = engine.planners.get(&4).unwrap();
    (planner.next_glyph_id, planner.next_content_revision)
}

fn acceptance_outlined_ids(engine: &TextEngine) -> [u32; 2] {
    let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
    let positioned = state.positioned.committed();
    let clusters = state.clusters.committed();
    let mut cursor = positioned.outlined_cursor(clusters, &state.boundary_shape);
    let mut first = None;
    let mut last = None;
    while let Some(mark) = cursor.next_mark().unwrap() {
        let id = positioned.project_outlined_mark(mark, clusters, &state.boundary_shape)
            .unwrap().semantic.stable_id;
        first.get_or_insert(id);
        last = Some(id);
    }
    let ids = [first.unwrap(), last.unwrap()];
    assert_ne!(ids[0], ids[1]);
    ids
}

#[test]
fn ascii_anchor_real_length_edit_matches_forced_ordinary_consumers() {
    let (mut fast, mut fast_shaper, a) = acceptance_fredoka_engine(false);
    let (mut ordinary, mut ordinary_shaper, old) = acceptance_fredoka_engine(true);
    assert_eq!(a, old);
    let middle = a.len() / 2;
    let mut b = a.clone();
    b.insert(middle, u16::from(b'x'));
    let bytes = text_mutation_bytes(&[(0, u32::try_from(a.len()).unwrap(), &b)]);
    let style = acceptance_style(b.len());
    let mut records = Vec::new();
    for (engine, shaper, fast_path) in [
        (&mut fast, &mut fast_shaper, true),
        (&mut ordinary, &mut ordinary_shaper, false),
    ] {
        let request = acceptance_edit(engine, a.len(), &b, &bytes, &style);
        super::super::work_attribution::reset();
        let measured = engine.measure_paragraph_with_shaper(shaper, request, 1).unwrap();
        let work = super::super::work_attribution::snapshot();
        eprintln!("acceptance fast={fast_path}: {work:?}");
        if fast_path {
            assert_eq!((work.ascii_anchor_item_calls, work.ascii_anchor_splice_successes), (1, 1));
            assert_eq!((work.main_full_run_shape_calls, work.incremental_window_shape_calls), (0, 0));
            assert_eq!((work.ascii_nominal_bootstrap_calls,
                work.ascii_nominal_bootstrap_utf16_units), (1, 95));
        } else {
            assert_eq!(work.ascii_anchor_item_calls, 0);
            assert_eq!(work.ascii_anchor_splice_successes, 0);
            assert!(work.incremental_window_shape_calls > 0 || work.main_full_run_shape_calls > 0);
        }
        assert_eq!(work.cluster_full_builds, 1);
        records.push(engine.measured_semantic_views(measured).unwrap().to_vec());
        engine.commit_measure(measured).unwrap();
    }
    assert_eq!(records[0], records[1], "immediate measurement");
    assert_eq!(fast.root_text(4).unwrap(), b.as_slice());
    assert_eq!(fast.root_revision(4), ordinary.root_revision(4));
    assert_eq!(acceptance_high_water(&fast), acceptance_high_water(&ordinary));
    let glyphs = acceptance_borrowed(&fast);
    assert_eq!(glyphs, acceptance_borrowed(&ordinary), "placed glyphs, IDs and revisions");
    let fast_state = &fast.planners.get(&4).unwrap().paragraph(1).unwrap().state;
    let old_state = &ordinary.planners.get(&4).unwrap().paragraph(1).unwrap().state;
    assert_eq!(fast_state.shape.committed().runs, old_state.shape.committed().runs);
    assert_eq!(fast_state.shape.committed().glyph_ids, old_state.shape.committed().glyph_ids);
    assert_eq!(fast_state.shape.committed().clusters, old_state.shape.committed().clusters);
    assert_eq!(fast_state.shape.committed().x_advances, old_state.shape.committed().x_advances);
    assert_eq!(fast_state.shape.committed().y_advances, old_state.shape.committed().y_advances);
    assert_eq!(fast_state.shape.committed().x_offsets, old_state.shape.committed().x_offsets);
    assert_eq!(fast_state.shape.committed().y_offsets, old_state.shape.committed().y_offsets);
    assert_eq!(fast_state.shape.committed().glyph_flags, old_state.shape.committed().glyph_flags);
    assert_eq!(fast_state.clusters.committed().stable_ids, old_state.clusters.committed().stable_ids);
    assert_eq!(fast_state.clusters.committed().glyph_stable_ids,
        old_state.clusters.committed().glyph_stable_ids);
    let selected = acceptance_outlined_ids(&fast);
    assert_eq!(selected, acceptance_outlined_ids(&ordinary));
    let a_split = fast.copy_glyphs(4, 1, 9, 1, &selected).unwrap();
    let b_split = ordinary.copy_glyphs(4, 1, 9, 1, &selected).unwrap();
    let fingerprint = fast.codecs.get(&9).unwrap().fingerprint();
    let a_view = a_split.plan_view(9, CapabilitySetId(1), fingerprint).unwrap();
    let b_view = b_split.plan_view(9, CapabilitySetId(1), fingerprint).unwrap();
    assert_eq!(a_view.buffers, b_view.buffers);
    assert_eq!(a_view.payload, b_view.payload);
    assert_eq!(a_view.session_payload, b_view.session_payload);
    let mut physical = Vec::new();
    for (engine, shaper) in [(&mut fast, &mut fast_shaper),
                             (&mut ordinary, &mut ordinary_shaper)] {
        let revision = engine.root_revision(4).unwrap().engine;
        let mut publish = update(revision, revision, revision);
        publish.limits.max_clusters = 8_192;
        publish.limits.max_lines = 8_192;
        publish.limits.max_output_bytes = 1 << 22;
        let prepared = engine.prepare_update_with_shaper(shaper, publish, revision + 1).unwrap();
        let view = engine.planners.get(&4).unwrap().plan.plan_view(
            9, CapabilitySetId(1), fingerprint).unwrap();
        physical.push((view.buffers.to_vec(), view.payload.to_vec(),
            view.session_payload.to_vec()));
        engine.commit_update(prepared).unwrap();
    }
    assert_eq!(physical[0], physical[1], "generic Codec physical publication");
    assert_eq!(fast.gather.view().plan_input().glyphs,
        ordinary.gather.view().plan_input().glyphs);
    assert_eq!(acceptance_high_water(&fast), acceptance_high_water(&ordinary));
}

#[test]
fn ascii_anchor_preflight_rejection_and_injected_post_shape_failure_follow_existing_contract() {
    let mut downstream_errors = Vec::new();
    for force_ordinary in [false, true] {
        let (mut engine, mut shaper, a) = acceptance_fredoka_engine(force_ordinary);
        let before_revision = engine.root_revision(4).unwrap();
        let before_facts = engine.planners.get(&4).unwrap().paragraph(1).unwrap()
            .state.unicode.committed().printable_ascii_facts();
        let before_token = engine.planners.get(&4).unwrap().paragraph(1).unwrap()
            .state.accepted_shape_font_instance;
        let before_glyphs = acceptance_borrowed(&engine);
        let before_high_water = acceptance_high_water(&engine);
        let invalid = text_mutation_bytes(&[(u32::try_from(a.len() + 1).unwrap(), 0, &[b'x' as u16])]);
        let revision = before_revision.engine;
        let mut request = update(revision, revision, revision);
        request.limits.max_clusters = 8_192;
        request.limits.max_lines = 8_192;
        request.limits.max_output_bytes = 1 << 22;
        request.text_mutations = parse_text_mutations(
            &invalid, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(engine.measure_paragraph_with_shaper(&mut shaper, request, 1),
            Err(EngineError::InvalidRequest));
        assert_eq!(engine.root_revision(4).unwrap(), before_revision);
        assert_eq!(engine.root_text(4).unwrap(), a.as_slice());
        assert_eq!(acceptance_borrowed(&engine), before_glyphs);
        assert_eq!(acceptance_high_water(&engine), before_high_water);
        let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
        assert_eq!(state.unicode.committed().printable_ascii_facts(), before_facts);
        assert_eq!(state.accepted_shape_font_instance, before_token);

        // Inject the same test-only fault after successful shape preparation in
        // both producers. The engine contract confines it to the paragraph.
        let mut b = a.clone();
        b.insert(a.len() / 2, u16::from(b'x'));
        let bytes = text_mutation_bytes(&[(0, u32::try_from(a.len()).unwrap(), &b)]);
        let style = acceptance_style(b.len());
        engine.planners.get_mut(&4).unwrap().paragraph_mut(1).unwrap()
            .state.fail_after_shape_once = true;
        let request = acceptance_edit(&engine, a.len(), &b, &bytes, &style);
        super::super::work_attribution::reset();
        downstream_errors.push(engine.measure_paragraph_with_shaper(&mut shaper, request, 1)
            .expect_err("injected post-shape preparation failure"));
        let work = super::super::work_attribution::snapshot();
        if force_ordinary {
            assert_eq!(work.ascii_anchor_splice_successes, 0);
            assert!(work.incremental_window_shape_calls > 0 || work.main_full_run_shape_calls > 0);
        } else {
            assert_eq!(work.ascii_anchor_splice_successes, 1,
                "fault must occur after successful optional shape construction");
        }
        // The failure is the paragraph's: the root keeps its revision and the paragraph is emptied.
        assert_eq!(engine.root_revision(4).unwrap(), before_revision);
        let refused = engine.planners.get(&4).unwrap().paragraph(1).unwrap();
        assert!(refused.state.text.committed().units.is_empty());
        assert!(!refused.state.has_pending_preparation());
    }
    assert_eq!(downstream_errors[0], downstream_errors[1],
        "the optional producer preserves the ordinary failure code");
}

#[test]
fn ascii_anchor_same_length_reuse_keeps_mask_then_conservatively_falls_back() {
    let (mut fast, mut fast_shaper, a) = acceptance_fredoka_engine(false);
    let (mut ordinary, mut ordinary_shaper, old) = acceptance_fredoka_engine(true);
    assert_eq!(a, old);
    assert_eq!(a[0], u16::from(b'R'));
    let same = text_mutation_bytes(&[(0, 1, &[b'S' as u16])]);
    let mut changed = a.clone();
    changed[0] = u16::from(b'S');
    for (engine, shaper) in [(&mut fast, &mut fast_shaper),
                             (&mut ordinary, &mut ordinary_shaper)] {
        let prior_analyses = engine.planners.get(&4).unwrap().paragraph(1).unwrap()
            .state.unicode.committed().analysis_count();
        let revision = engine.root_revision(4).unwrap().engine;
        let mut request = update(revision, revision, revision);
        request.limits.max_clusters = 8_192;
        request.limits.max_lines = 8_192;
        request.limits.max_output_bytes = 1 << 22;
        request.text_mutations = parse_text_mutations(
            &same, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        // Borrowed glyphs are compared below, so the read positions.
        request.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_GLYPH_FACTS;
        let measured = engine.measure_paragraph_with_shaper(shaper, request, 1).unwrap();
        engine.commit_measure(measured).unwrap();
        let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
        assert_eq!(state.unicode.committed().analysis_count(), prior_analyses,
            "same-length letter edit reuses analyzed Unicode");
        let facts = state.unicode.committed().printable_ascii_facts();
        assert!(facts.printable());
        let index = usize::from(b'S' - b' ');
        assert_ne!(facts.used()[index / 8] & (1 << (index % 8)), 0,
            "accepted mask includes newly used S");
    }
    assert_eq!(fast.root_text(4).unwrap(), changed.as_slice());
    assert_eq!(acceptance_borrowed(&fast), acceptance_borrowed(&ordinary));
    assert_eq!(fast.planners.get(&4).unwrap().paragraph(1).unwrap()
        .state.accepted_shape_font_instance, None,
        "first-draft sparse path intentionally drops optional provenance");
    let mut next = changed.clone();
    next.insert(next.len() / 2, u16::from(b'x'));
    let bytes = text_mutation_bytes(&[(0, u32::try_from(changed.len()).unwrap(), &next)]);
    let style = acceptance_style(next.len());
    let mut records = Vec::new();
    for (engine, shaper) in [(&mut fast, &mut fast_shaper),
                             (&mut ordinary, &mut ordinary_shaper)] {
        let request = acceptance_edit(engine, changed.len(), &next, &bytes, &style);
        super::super::work_attribution::reset();
        let measured = engine.measure_paragraph_with_shaper(shaper, request, 1).unwrap();
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.ascii_anchor_item_calls, 0,
            "no optional admission after provenance was conservatively cleared");
        records.push(engine.measured_semantic_views(measured).unwrap().to_vec());
        engine.commit_measure(measured).unwrap();
    }
    assert_eq!(records[0], records[1]);
    assert_eq!(acceptance_borrowed(&fast), acceptance_borrowed(&ordinary));
    assert_eq!(acceptance_high_water(&fast), acceptance_high_water(&ordinary));
}
