// Run-local geometry an edit starts from the committed arena: what it copies plus what the
// kernel lays out again must be the cold build of the edited text, bit for bit.

fn assert_run_local_equal(warm: &ParagraphState, cold: &ParagraphState, context: &str) {
    let (warm, cold) = (warm.clusters.committed(), cold.clusters.committed());
    let (warm_geometry, cold_geometry) = (warm.run_local(), cold.run_local());
    assert_eq!(
        warm_geometry.blocks(),
        cold_geometry.blocks(),
        "{context}: blocks"
    );
    assert_eq!(
        warm_geometry.cluster_blocks(),
        cold_geometry.cluster_blocks(),
        "{context}: cluster blocks"
    );
    let prefixes = |arena: &super::super::run_local::RunLocalArena| {
        arena
            .cluster_prefixes()
            .iter()
            .map(|prefix| prefix.to_bits())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        prefixes(warm_geometry),
        prefixes(cold_geometry),
        "{context}: cluster prefixes"
    );
    assert_eq!(warm_geometry.rows(), cold_geometry.rows(), "{context}: rows");
    let spans = |arena: &ClusterArena| {
        arena
            .layout_runs()
            .iter()
            .map(|run| run.numeric_blocks)
            .collect::<Vec<_>>()
    };
    assert_eq!(spans(warm), spans(cold), "{context}: run block spans");
}

/// Applies one replacement of `[start, end)` by `insert` and returns the glyphs whose rows the
/// rebuild copied.
fn replace_with_styles(
    engine: &mut TextEngine,
    shaper: &mut ShaperRegistry,
    revision: u32,
    (start, end): (usize, usize),
    insert: &[u16],
    new_len: usize,
) -> usize {
    let bytes = text_mutation_bytes(&[(start as u32, (end - start) as u32, insert)]);
    let styles = root_style_bytes_for_text(7, new_len as u32);
    let mut edit = update(revision, revision, revision);
    edit.limits.max_clusters = 1 << 16;
    edit.limits.max_lines = 1 << 16;
    edit.limits.max_output_bytes = 1 << 24;
    edit.text_mutations =
        parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    edit.style_mutations =
        parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
    super::super::work_attribution::reset();
    let prepared = engine
        .prepare_update_with_shaper(shaper, edit, revision + 1)
        .unwrap();
    engine.commit_update(prepared).unwrap();
    super::super::work_attribution::snapshot().run_local_adopted_glyphs
}

#[test]
fn edits_copy_leading_run_local_geometry_and_equal_a_cold_build() {
    let paragraph = "Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning pairs \
                     while a responsive panel changes the space around them; office, affine, \
                     difficult and shuffle keep their ligatures.";
    let source = vec![paragraph; 12].join("\n");
    let (mut engine, mut shaper) = shaped_inter_engine(&source);
    let mut current = utf16(&source);
    let middle = current.len() / 2;
    let paste = current[..200].to_vec();
    let x = utf16("x");
    // (label, range, insert, whether a leading block survives)
    let edits: Vec<(&str, (usize, usize), Vec<u16>, bool)> = vec![
        ("type at the end", (current.len(), current.len()), x.clone(), true),
        ("insert mid", (middle, middle), x.clone(), true),
        ("delete mid", (middle, middle + 1), Vec::new(), true),
        ("paste mid", (middle, middle), paste.clone(), true),
        ("cut the paste", (middle, middle + paste.len()), Vec::new(), true),
        ("same-length mid", (middle, middle + 1), utf16("Q"), true),
        ("insert at the start", (0, 0), x.clone(), false),
        ("delete at the start", (0, 1), Vec::new(), false),
        ("break a paragraph", (middle, middle), utf16("\n"), true),
        ("join it again", (middle, middle + 1), Vec::new(), true),
    ];
    for (index, (label, (start, end), insert, adopts)) in edits.into_iter().enumerate() {
        let (start, end) = if label == "type at the end" {
            (current.len(), current.len())
        } else {
            (start, end)
        };
        current.splice(start..end, insert.iter().copied());
        let revision = 1 + index as u32;
        let adopted = replace_with_styles(
            &mut engine,
            &mut shaper,
            revision,
            (start, end),
            &insert,
            current.len(),
        );
        assert_eq!(adopted > 0, adopts, "{label}: adopted {adopted} glyphs");
        let text = String::from_utf16(&current).unwrap();
        let (cold, _) = shaped_inter_engine(&text);
        let warm = engine.planners.get(&4).unwrap().first_paragraph_state().unwrap();
        let cold = cold.planners.get(&4).unwrap().first_paragraph_state().unwrap();
        assert_visible_shape_equal(warm, cold, label);
        assert_run_local_equal(warm, cold, label);
    }
}
