// Included into `state::tests`: a preparation that fails is confined to its paragraph.

#[test]
fn a_failed_preparation_resets_its_paragraph_and_leaves_the_root_usable() {
    let text = "alpha beta gamma delta epsilon zeta eta theta";
    let units = utf16(text);
    let length = units.len() as u32;
    let geometry = multiline_root_geometry_bytes();
    let styles = root_style_bytes_for_text(7, length);
    let (mut engine, mut shaper) =
        shaped_outlined_engine_with_styles_geometry(text, &styles, &geometry);
    let revision = engine.root_revision(4).unwrap();

    // One more unit, with the shaping stage made to fail once.
    let inserted = utf16("!");
    let edit = text_mutation_bytes(&[(length, 0, &inserted)]);
    let grown_styles = root_style_bytes_for_text(7, length + 1);
    let mut request = update(1, 1, 1);
    request.limits.max_output_bytes = 1 << 20;
    request.limits.max_clusters = length + 1;
    request.limits.max_lines = length + 1;
    request.text_mutations =
        parse_text_mutations(&edit, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request.style_mutations =
        parse_style_mutations(&grown_styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    engine
        .planners
        .get_mut(&4)
        .unwrap()
        .paragraph_mut(1)
        .unwrap()
        .state
        .fail_after_shape_once = true;
    let prepared = engine
        .prepare_paragraphs(Some(&mut shaper), request, PreparationTarget::One(1))
        .unwrap();
    assert_eq!(
        prepared.refused,
        Some((1, EngineError::InvalidRequest.in_paragraph(1))),
        "the failure names its paragraph instead of taking the root"
    );
    engine.commit_measure(prepared.witness).unwrap();

    assert_eq!(engine.root_revision(4), Ok(revision), "the root survives");
    let refused = engine.planners.get(&4).unwrap().paragraph(1).unwrap();
    assert!(refused.state.text.committed().units.is_empty());
    assert!(!refused.state.has_pending_preparation());
    assert!(refused.preparation_changed_since_publication);

    // The paragraph is restated from nothing, as a host does after a refusal, and equals cold.
    let restated_text = alloc::format!("{text}!");
    let restated_units = utf16(&restated_text);
    let restate = text_mutation_bytes(&[(0, 0, &restated_units)]);
    let mut request = update(1, 1, 1);
    request.limits.max_output_bytes = 1 << 20;
    request.limits.max_clusters = length + 1;
    request.limits.max_lines = length + 1;
    request.text_mutations =
        parse_text_mutations(&restate, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request.style_mutations =
        parse_style_mutations(&grown_styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    request.geometry = parse_root_geometry(&geometry, request.limits);
    let prepared = engine
        .prepare_paragraphs(Some(&mut shaper), request, PreparationTarget::One(1))
        .unwrap();
    assert_eq!(prepared.refused, None);
    engine.commit_measure(prepared.witness).unwrap();

    let (cold_engine, _) =
        shaped_outlined_engine_with_styles_geometry(&restated_text, &grown_styles, &geometry);
    let warm = engine
        .planners
        .get(&4)
        .unwrap()
        .first_paragraph_state()
        .unwrap();
    let cold = cold_engine
        .planners
        .get(&4)
        .unwrap()
        .first_paragraph_state()
        .unwrap();
    assert_visible_shape_equal(warm, cold, "a refused paragraph restated from nothing");
}
