// Included into `state::tests`: the accumulated change class and the paint-only preparation.

#[test]
fn a_colour_change_stages_no_layout_and_accumulates_paint_until_publication() {
    let text = "alpha beta gamma delta epsilon zeta eta theta";
    let length = text.encode_utf16().count() as u32;
    let geometry = multiline_root_geometry_bytes();
    let initial_styles = root_style_bytes_for_text(7, length);
    let (mut engine, mut shaper) =
        shaped_outlined_engine_with_styles_geometry(text, &initial_styles, &geometry);
    let record = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
    let mut recoloured = initial_styles.clone();
    let mask = u32::from_le_bytes(
        recoloured[record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK
            ..record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK + 4]
            .try_into()
            .unwrap(),
    );
    write_u32(
        &mut recoloured,
        record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
        mask | STYLE_FIELD_FOREGROUND,
    );
    write_u32(
        &mut recoloured,
        record + abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA,
        0xff33_66ff,
    );

    let mut request = update(1, 1, 1);
    request.limits.max_output_bytes = 1 << 20;
    request.style_mutations =
        parse_style_mutations(&recoloured, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    let measured = engine
        .prepare_paragraphs(Some(&mut shaper), request, PreparationTarget::Dirty(MeasuredParagraphs::All))
        .unwrap();
    let staged = engine
        .planners
        .get(&4)
        .unwrap()
        .first_paragraph_state()
        .unwrap();
    assert!(staged.style_invalidation.paint_only());
    assert!(staged.styles.is_prepared());
    for (stage, prepared) in [
        ("unicode", staged.unicode.is_prepared()),
        ("bidi", staged.bidi.is_prepared()),
        ("shaping runs", staged.shaping_runs.is_prepared()),
        ("shape", staged.shape.is_prepared()),
        ("clusters", staged.clusters.is_prepared()),
        ("flow", staged.flow_layout.is_prepared()),
        ("positioned", staged.positioned.is_prepared()),
    ] {
        assert!(!prepared, "a colour change staged the {stage} stage");
    }
    engine.commit_measure(measured).unwrap();

    let change = engine.paragraph_change_since_publication(4, 1).unwrap();
    assert_eq!(change.class, ChangeClass::Paint);
    assert_eq!((change.units.start, change.units.end), (0, length));
    assert!(change.lines.is_empty());

    // A second preparation before publication widens the class; it never narrows.
    let wider = root_style_bytes_for_text(7, length);
    let mut resized = wider.clone();
    write_f32(
        &mut resized,
        record + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
        31.0,
    );
    let mut request = update(1, 1, 1);
    request.limits.max_output_bytes = 1 << 20;
    request.style_mutations =
        parse_style_mutations(&resized, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    let measured = engine
        .prepare_paragraphs(Some(&mut shaper), request, PreparationTarget::One(1))
        .unwrap();
    engine.commit_measure(measured).unwrap();
    let change = engine.paragraph_change_since_publication(4, 1).unwrap();
    assert_eq!(change.class, ChangeClass::Metric);
    assert_eq!(change.units, DirtyInterval::ALL);
}
