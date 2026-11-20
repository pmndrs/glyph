// Test-only raw policy oracle. Full cold shaping is not a runtime admission check.

fn ascii_policy_splice_case(old_string: &str, new_string: &str, label: &str) {
    use crate::ascii_anchor_policy::{self as policy, AsciiUse};
    let (sfnt, extents, availability) = fredoka_baked_views();
    let mut shaper = ShaperRegistry::default();
    assert_eq!(shaper.register_font(1, sfnt, extents, availability, 0, 0), 0);
    let mut screen = policy::screen_font(sfnt).expect("baked font should pass typed policy screen");
    policy::bootstrap_registered_nominals(&shaper, 1, &mut screen)
        .expect("baked font actual nominal bootstrap");
    let old: Vec<u16> = old_string.encode_utf16().collect();
    let new: Vec<u16> = new_string.encode_utf16().collect();
    let old_ascii = AsciiUse::from_test_text(&old).expect("old printable ASCII");
    let new_ascii = AsciiUse::from_test_text(&new).expect("new printable ASCII");
    let old_shape = fredoka_raw_shape(&mut shaper, &old);
    let cold = fredoka_raw_shape(&mut shaper, &new);
    let mut edits = Vec::new();
    collect_text_edits(&old, &new, TextReconciliation::FullReplacement, &mut edits, 0).unwrap();
    assert_eq!(edits.len(), 1);
    let edit = edits[0];
    assert!(!edit.is_same_length());
    let window = policy::fixed_window(&screen, &old, &new, edit.old_start, edit.old_end,
        edit.new_end, &old_ascii, &new_ascii)
        .unwrap_or_else(|reason| panic!("{label}: fixed window rejected: {reason:?}"));
    assert!(window.probed_units <= policy::NOMINAL_PROBES_MAX,
        "{label}: fixed window exceeded the policy's actual nominal-probe cap");
    let old_end = u32::try_from(old.len()).unwrap();
    let new_end = u32::try_from(new.len()).unwrap();
    let run = ShapeRunRef { text_start: 0, text_end: new_end,
        script: u32::from_be_bytes(*b"Latn"), language: None, features: &[],
        direction: 0, cluster_level: 0, flags: 0x40 };
    let range = ShapeRangeRef { item_start: u32::try_from(window.new_outer_left).unwrap(),
        item_end: u32::try_from(window.new_outer_end).unwrap(),
        context_start: 0, context_end: new_end, flags: 0x40 };
    let mut fresh = ShapeArena::default();
    shaper.with_shaped_range(1, &new, run, range, |glyphs| {
        fresh.append(0, 1, 42, range.item_start, range.item_end, glyphs)
    }).unwrap();
    let spliced = policy::splice_raw(&old_shape, &fresh, window, old_end, new_end)
        .unwrap_or_else(|reason| panic!("{label}: raw splice rejected: {reason:?}"));
    eprintln!("{label}: old/new units={}/{} outer={}..{} shaped={} nominal_probes={} typed_visits={} lookups={} multiple_product={} cold_glyphs={} splice_glyphs={}",
        old.len(), new.len(), window.new_outer_left, window.new_outer_end,
        window.new_outer_end - window.new_outer_left, window.probed_units,
        screen.table_visits, screen.lookup_count, screen.multiple_product,
        cold.glyph_ids.len(), spliced.glyph_ids.len());
    assert!(window.new_outer_end - window.new_outer_left < new.len(), "{label}: whole-run work");
    assert_eq!(spliced.runs, cold.runs, "{label}: run header");
    assert_eq!(spliced.glyph_ids, cold.glyph_ids, "{label}: glyph ids");
    assert_eq!(spliced.clusters, cold.clusters, "{label}: cluster ordinals");
    assert_eq!(spliced.x_advances, cold.x_advances, "{label}: x advance");
    assert_eq!(spliced.y_advances, cold.y_advances, "{label}: y advance");
    assert_eq!(spliced.x_offsets, cold.x_offsets, "{label}: x offset");
    assert_eq!(spliced.y_offsets, cold.y_offsets, "{label}: y offset");
    assert_eq!(spliced.glyph_flags, cold.glyph_flags, "{label}: raw flags");
}

#[test]
fn baked_fredoka_ascii_policy_fixed_splice_matches_cold() {
    let a = frozen_fredoka_corpus();
    let middle = a.len() / 2;
    let b = alloc::format!("{}x{}", &a[..middle], &a[middle..]);
    ascii_policy_splice_case(&a, &b, "long middle insert");
    ascii_policy_splice_case(&b, &a, "long middle remove");

    // The words below place edits around the ligature candidates in the frozen
    // typist corpus. A passing case demonstrates raw equality, not which lookup
    // path HarfRust selected; branch attribution needs separate source evidence.
    let prefix = "Typography is a moving system. AVATAR To Wa Yo. ";
    let suffix = " A practical interface mixes prose and Layout stays put.";
    for (name, left, right) in [
        ("word edge", "Repeated office", "Repeated office again"),
        ("ffi edge", "Repeated office affine difficult", "Repeated office xaffine difficult"),
        ("fl edge", "Repeated office shuffle words", "Repeated office xshuffle words"),
    ] {
        let before = alloc::format!("{prefix}{left}{suffix}");
        let after = alloc::format!("{prefix}{right}{suffix}");
        ascii_policy_splice_case(&before, &after, &alloc::format!("{name} insert"));
        ascii_policy_splice_case(&after, &before, &alloc::format!("{name} remove"));
    }
}

#[test]
fn ascii_policy_rejects_non_ascii_and_insufficient_anchors() {
    use crate::ascii_anchor_policy::{self as policy, AsciiUse, Unsupported};
    assert!(AsciiUse::from_test_text(&[0x20, 0x7e]).is_some());
    assert!(AsciiUse::from_test_text(&[0x1f]).is_none());
    assert!(AsciiUse::from_test_text(&[0x80]).is_none());
    let (sfnt, extents, availability) = fredoka_baked_views();
    let mut shaper = ShaperRegistry::default();
    assert_eq!(shaper.register_font(1, sfnt, extents, availability, 0, 0), 0);
    let mut screen = policy::screen_font(sfnt).unwrap();
    policy::bootstrap_registered_nominals(&shaper, 1, &mut screen).unwrap();
    let old: Vec<u16> = "ffi".encode_utf16().collect();
    let new: Vec<u16> = "fffi".encode_utf16().collect();
    let result = policy::fixed_window(&screen, &old, &new, 2, 2, 3,
        &AsciiUse::from_test_text(&old).unwrap(),
        &AsciiUse::from_test_text(&new).unwrap());
    assert!(matches!(result, Err(Unsupported::Anchors | Unsupported::Resource)));
}
