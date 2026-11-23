// Included into `state::tests`: positioning a summary-only read leaves owed equals positioning
// the read itself, through publication, revisions and retention included.

/// One read of a script step: a new width, a text replacement, or both.
#[derive(Clone, Copy)]
struct DeferredRead {
    width: Option<f32>,
    /// `(start, delete, insert)` in UTF-16 units of the text before the read.
    edit: Option<(usize, usize, &'static str)>,
}

fn deferred_positioning_engines() -> [(TextEngine, ShaperRegistry); 2] {
    let text = "Every summary-only read answers from flow layout. ".repeat(24);
    let geometry = multiline_root_geometry_bytes();
    let styles = root_style_bytes_for_text(7, text.encode_utf16().count() as u32);
    [
        shaped_outlined_engine_with_styles_geometry(&text, &styles, &geometry),
        shaped_outlined_engine_with_styles_geometry(&text, &styles, &geometry),
    ]
}

fn geometry_with_width(width: f32) -> Vec<u8> {
    let mut geometry = multiline_root_geometry_bytes();
    let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
    let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
    write_f32(&mut geometry, constraint + abi::ENGINE_CONSTRAINT_WIDTH, width);
    write_f32(&mut geometry, region + abi::ENGINE_REGION_INLINE_END, width);
    write_f32(&mut geometry, region + abi::ENGINE_REGION_CLIP_INLINE_END, width);
    geometry
}

fn deferred_read(
    engine: &mut TextEngine,
    shaper: &mut ShaperRegistry,
    text: &mut Vec<u16>,
    read: DeferredRead,
    view_mask: u32,
) {
    let geometry = read.width.map(geometry_with_width);
    let (edit_bytes, style_bytes) = match read.edit {
        Some((start, delete, insert)) => {
            let insert = utf16(insert);
            text.splice(start..start + delete, insert.iter().copied());
            (
                Some(text_mutation_bytes(&[(
                    start as u32,
                    delete as u32,
                    &insert,
                )])),
                Some(root_style_bytes_for_text(7, text.len() as u32)),
            )
        }
        None => (None, None),
    };
    let revision = engine.root_revision(4).unwrap();
    let mut request = update(revision.engine, revision.root, revision.root);
    request.limits.max_clusters = 4_096;
    request.limits.max_lines = 4_096;
    request.limits.max_output_bytes = 1 << 22;
    request.semantic_view_mask = view_mask;
    if let Some(geometry) = &geometry {
        request.geometry = parse_root_geometry(geometry, request.limits);
    }
    if let (Some(edit), Some(styles)) = (&edit_bytes, &style_bytes) {
        request.text_mutations =
            parse_text_mutations(edit, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        request.style_mutations =
            parse_style_mutations(styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    }
    let measured = engine
        .measure_paragraph_with_shaper(shaper, request, 1)
        .unwrap();
    engine.commit_measure(measured).unwrap();
}

fn deferred_publish(engine: &mut TextEngine, shaper: &mut ShaperRegistry) {
    let revision = engine.root_revision(4).unwrap();
    let mut publication = update(revision.engine, revision.root, revision.root);
    publication.limits.max_clusters = 4_096;
    publication.limits.max_lines = 4_096;
    publication.limits.max_output_bytes = 1 << 22;
    let prepared = engine
        .prepare_update_with_shaper(shaper, publication, revision.root + 1)
        .unwrap();
    engine.commit_update(prepared).unwrap();
}

#[test]
fn positioning_a_read_left_owed_equals_positioning_it_in_the_read() {
    let measure = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
        | super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT;
    let [(mut deferred, mut deferred_shaper), (mut eager, mut eager_shaper)] =
        deferred_positioning_engines();
    let mut deferred_text = utf16(&"Every summary-only read answers from flow layout. ".repeat(24));
    let mut eager_text = deferred_text.clone();
    let width = |width| DeferredRead {
        width: Some(width),
        edit: None,
    };
    let edit = |start, delete, insert| DeferredRead {
        width: None,
        edit: Some((start, delete, insert)),
    };
    // Each step's reads run before its publication: one width, several widths (the second read
    // settles what the first left owed), edits, and both at once.
    let script: [&[DeferredRead]; 7] = [
        &[width(300.0)],
        &[width(260.0), width(220.0)],
        &[edit(600, 0, "inserted words ")],
        &[DeferredRead {
            width: Some(280.0),
            edit: Some((40, 5, "x")),
        }],
        &[edit(900, 12, ""), width(240.0)],
        &[],
        &[width(300.0), edit(10, 0, "y"), width(310.0)],
    ];
    let mut owed_reads = 0;
    for (step, reads) in script.iter().enumerate() {
        for read in *reads {
            deferred_read(
                &mut deferred,
                &mut deferred_shaper,
                &mut deferred_text,
                *read,
                measure,
            );
            // A width that composes the same lines needs no positioning at all.
            owed_reads += usize::from(
                deferred
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap()
                    .positioning_owed(),
            );
            deferred_read(
                &mut eager,
                &mut eager_shaper,
                &mut eager_text,
                *read,
                measure | super::super::frame::SEMANTIC_VIEW_GLYPH_FACTS,
            );
        }
        deferred_publish(&mut deferred, &mut deferred_shaper);
        deferred_publish(&mut eager, &mut eager_shaper);
        let warm = deferred.planners.get(&4).unwrap().first_paragraph_state().unwrap();
        let cold = eager.planners.get(&4).unwrap().first_paragraph_state().unwrap();
        let context = alloc::format!("step {step}");
        assert!(!warm.positioning_owed(), "{context}: publication settles");
        assert_visible_shape_equal(warm, cold, &context);
        let (warm_positioned, cold_positioned) =
            (warm.positioned.committed(), cold.positioned.committed());
        assert_eq!(
            warm_positioned.occurrence_spans(),
            cold_positioned.occurrence_spans(),
            "{context}: occurrence spans"
        );
        assert_eq!(
            warm_positioned.placement_segments(),
            cold_positioned.placement_segments(),
            "{context}: placement segments"
        );
        assert_eq!(
            warm_positioned.placement_translations(),
            cold_positioned.placement_translations(),
            "{context}: placement translations"
        );
        assert_eq!(
            warm_positioned.replacement_runs(),
            cold_positioned.replacement_runs(),
            "{context}: replacement runs and their canonical revisions"
        );
        assert_eq!(
            warm.next_run_canonical_revision, cold.next_run_canonical_revision,
            "{context}: run revision cursor"
        );
        assert_eq!(
            deferred.gather.view().plan_input().glyphs,
            eager.gather.view().plan_input().glyphs,
            "{context}: published glyph records"
        );
        assert_eq!(
            deferred.planners.get(&4).unwrap().plan.buffer_bytes(1),
            eager.planners.get(&4).unwrap().plan.buffer_bytes(1),
            "{context}: published buffer bytes"
        );
    }
    assert!(owed_reads >= 8, "the script defers positioning: {owed_reads} reads");
}

#[test]
fn a_read_of_glyphs_settles_owed_positioning_and_keeps_no_predecessor() {
    let measure = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
        | super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT;
    let [(mut engine, mut shaper), _] = deferred_positioning_engines();
    let mut text = utf16(&"Every summary-only read answers from flow layout. ".repeat(24));
    let mut owed = 0;
    for cycle in 0..32 {
        let read = DeferredRead {
            width: Some(if cycle % 2 == 0 { 400.0 } else { 900.0 }),
            edit: (cycle % 3 == 0).then_some((cycle * 7, 0, "z")),
        };
        deferred_read(&mut engine, &mut shaper, &mut text, read, measure);
        let paragraph = engine.planners.get(&4).unwrap().first_paragraph_state().unwrap();
        if paragraph.positioning_owed() {
            owed += 1;
            // A glyph read refuses to answer from a superseded arena; its entry settles first.
            assert_eq!(
                engine.borrowed_paragraph_layout(4, 1),
                Err(EngineError::InvalidRequest)
            );
        }
        engine.settle_paragraph_positioning(&shaper, 4, 1).unwrap();
        let count = engine.borrowed_paragraph_layout(4, 1).unwrap();
        assert!(count > 0);
        let paragraph = engine.planners.get(&4).unwrap().first_paragraph_state().unwrap();
        assert!(!paragraph.positioning_owed());
        // Settled, the kept predecessors are released: no stage holds a second generation.
        assert!(!paragraph.clusters.is_prepared() && !paragraph.flow_layout.is_prepared());
        assert_eq!(paragraph.flow_layout.pending().lines.len(), 0);
        assert!(paragraph.clusters.pending().starts.is_empty());
        assert!(paragraph.pending_boundary_shape.records.is_empty());
        if cycle % 4 == 0 {
            deferred_publish(&mut engine, &mut shaper);
        }
    }
    assert!(owed >= 16, "the cycles defer positioning: {owed} reads");
}
