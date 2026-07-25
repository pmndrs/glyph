use pmndrs_text_font_baker::{BakeDescriptorV0, BakeErrorCode, abi_json, bake_font};

const INTER: &[u8] =
    include_bytes!("../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");

#[test]
fn generated_abi_is_valid_and_names_the_public_exports() {
    let abi: serde_json::Value = serde_json::from_str(abi_json()).expect("valid ABI JSON");

    assert_eq!(abi["name"], "pmndrs-text-font-baker");
    assert_eq!(abi["version"], 0);
    assert_eq!(abi["versions"]["harfrust"], "0.12.0");
    assert_eq!(
        abi["versions"]["harfrustCommit"],
        "60b28ea22b5261710018d69c168a762bcb28794c"
    );
    assert_eq!(abi["versions"]["harfbuzzReference"], "13.0.0");
    assert_eq!(abi["versions"]["unicode"], "17.0.0");
    assert_eq!(abi["versions"]["gltfSpec"], "2.0");
    assert_eq!(abi["versions"]["binaryen"], "129.0.0");
    assert_eq!(abi["pointerWidth"], 32);
    assert_eq!(abi["functions"]["bake"]["export"], "pmndrs_font_baker_bake");
    assert_eq!(abi["response"]["payloadOffset"], 16);
}

#[test]
fn public_api_rejects_an_unknown_descriptor_version_before_font_parsing() {
    let error = bake_font(
        &[],
        BakeDescriptorV0 {
            format_version: 1,
            font_face_index: 0,
        },
    )
    .expect_err("descriptor version 1 must be rejected");

    assert_eq!(error.code, BakeErrorCode::InvalidDescriptor);
}

#[test]
fn public_api_returns_a_structured_error_for_invalid_font_bytes() {
    let error = bake_font(&[0, 1, 2, 3], BakeDescriptorV0::new(0))
        .expect_err("invalid font bytes must be rejected");

    assert_eq!(error.code, BakeErrorCode::InvalidFont);
    assert!(!error.message.is_empty());
}

#[test]
fn public_api_rejects_webfont_envelopes_before_sfnt_parsing() {
    for signature in [b"wOFF", b"wOF2"] {
        let error = bake_font(signature, BakeDescriptorV0::new(0))
            .expect_err("webfont containers must be decoded by the host");
        assert_eq!(error.code, BakeErrorCode::UnsupportedContainer);
    }
}

#[test]
fn public_api_validates_required_and_unsupported_shaping_tables() {
    let mut missing_os2 = INTER.to_vec();
    let os2 = table_record(&missing_os2, *b"OS/2");
    missing_os2[os2 + 12..os2 + 16].copy_from_slice(&0_u32.to_be_bytes());
    assert_eq!(
        bake_font(&missing_os2, BakeDescriptorV0::new(0))
            .expect_err("an empty required table must fail")
            .code,
        BakeErrorCode::MissingTable,
    );

    let mut variable = INTER.to_vec();
    let cvt = table_record(&variable, *b"cvt ");
    variable[cvt..cvt + 4].copy_from_slice(b"cvar");
    assert_eq!(
        bake_font(&variable, BakeDescriptorV0::new(0))
            .expect_err("a variable-font table must fail")
            .code,
        BakeErrorCode::UnsupportedVariableFont,
    );

    let mut aat = INTER.to_vec();
    let name = table_record(&aat, *b"name");
    aat[name..name + 4].copy_from_slice(b"morx");
    assert_eq!(
        bake_font(&aat, BakeDescriptorV0::new(0))
            .expect_err("an AAT shaping table must fail")
            .code,
        BakeErrorCode::UnsupportedShapingSystem,
    );
}

#[test]
fn public_api_selects_one_collection_face_and_rejects_an_unknown_index() {
    let collection = two_face_collection(INTER);
    let first = bake_font(&collection, BakeDescriptorV0::new(0)).expect("first TTC face");
    let second = bake_font(&collection, BakeDescriptorV0::new(1)).expect("second TTC face");

    assert_eq!(first.artifacts[0].id, second.artifacts[0].id);
    assert_ne!(first.artifacts[0].sha256, second.artifacts[0].sha256);
    assert_eq!(
        bake_font(&collection, BakeDescriptorV0::new(2))
            .expect_err("TTC face index is bounds checked")
            .code,
        BakeErrorCode::InvalidFont,
    );
}

fn table_record(font: &[u8], wanted: [u8; 4]) -> usize {
    let count = u16::from_be_bytes(font[4..6].try_into().expect("table count"));
    (0..usize::from(count))
        .map(|index| 12 + index * 16)
        .find(|record| font[*record..*record + 4] == wanted)
        .expect("fixture table")
}

fn two_face_collection(font: &[u8]) -> Vec<u8> {
    let header_len = 20_usize;
    let first_offset = header_len;
    let second_offset = first_offset + font.len().next_multiple_of(4);
    let mut collection = vec![0_u8; second_offset + font.len()];
    collection[0..4].copy_from_slice(b"ttcf");
    collection[4..8].copy_from_slice(&0x0001_0000_u32.to_be_bytes());
    collection[8..12].copy_from_slice(&2_u32.to_be_bytes());
    collection[12..16].copy_from_slice(&(first_offset as u32).to_be_bytes());
    collection[16..20].copy_from_slice(&(second_offset as u32).to_be_bytes());
    for face_offset in [first_offset, second_offset] {
        collection[face_offset..face_offset + font.len()].copy_from_slice(font);
        let count = u16::from_be_bytes(font[4..6].try_into().expect("table count"));
        for index in 0..usize::from(count) {
            let record = 12 + index * 16;
            let source_offset = u32::from_be_bytes(
                font[record + 8..record + 12]
                    .try_into()
                    .expect("table offset"),
            );
            let collection_offset = (face_offset as u32)
                .checked_add(source_offset)
                .expect("fixture collection offset");
            collection[face_offset + record + 8..face_offset + record + 12]
                .copy_from_slice(&collection_offset.to_be_bytes());
        }
    }
    collection
}
