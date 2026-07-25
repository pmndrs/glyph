use pmndrs_text_font_baker::{BakeDescriptorV0, BakeErrorCode, abi_json, bake_font};

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
