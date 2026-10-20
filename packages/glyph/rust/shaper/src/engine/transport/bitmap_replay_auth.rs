//! Authentication-only replay of captured shipping Wasm calls. Invoked explicitly by the named Labs workflow.

use std::{collections::BTreeMap, fs, path::Path};

use serde_json::Value;

use super::{FrameTransport, UpdateBatchTransport};
use crate::{
    STATUS_OK, ShaperRegistry,
    abi_contract::ENGINE_RESULT_BYTE_LENGTH,
    engine::{
        TextEngine,
        codec_wire::parse_codec,
        font_binding_wire::parse_font_binding,
        frame_wire::parse_update_request,
        render_plan_wire::{publication_layout, query_layout},
    },
    wire::read_u32,
};

fn field<'a>(event: &'a Value, key: &str) -> &'a Value {
    event
        .get(key)
        .unwrap_or_else(|| panic!("missing {key} in event {event}"))
}

fn number(event: &Value, key: &str) -> u32 {
    u32::try_from(field(event, key).as_u64().unwrap()).unwrap()
}

fn argument(event: &Value, index: usize) -> u32 {
    u32::try_from(
        field(event, "args").as_array().unwrap()[index]
            .as_u64()
            .unwrap(),
    )
    .unwrap()
}

fn blob(directory: &Path, event: &Value, key: &str) -> Vec<u8> {
    let name = field(event, key).as_str().unwrap();
    assert!(!name.contains('/') && !name.contains(".."));
    fs::read(directory.join("blobs").join(name)).unwrap()
}

fn compare_result(sequence: u64, event: &Value, expected: &[u8], actual: &[u8]) {
    if expected == actual {
        return;
    }
    let offset = expected
        .iter()
        .zip(actual)
        .position(|(a, b)| a != b)
        .unwrap_or(expected.len().min(actual.len()));
    panic!(
        "Bitmap replay result mismatch event={sequence} kind={} offset={offset} expected_len={} actual_len={} expected_byte={:?} actual_byte={:?}",
        field(event, "kind").as_str().unwrap(),
        expected.len(),
        actual.len(),
        expected.get(offset),
        actual.get(offset)
    );
}

#[test]
#[ignore = "requires an authenticated shipping-package trace from benchmark:bitmap-native-replay-capture"]
fn authenticate() {
    let trace = std::env::var("GLYPH_BITMAP_REPLAY_TRACE")
        .expect("named workflow must supply GLYPH_BITMAP_REPLAY_TRACE");
    let directory = Path::new(&trace).parent().unwrap();
    let mut registry = ShaperRegistry::default();
    let mut engine = TextEngine::default();
    let mut batch = UpdateBatchTransport::default();
    let mut frames = BTreeMap::<u32, FrameTransport>::new();
    let mut count = 0_usize;
    let mut initialized = false;
    for line in fs::read_to_string(&trace).unwrap().lines() {
        let event: Value = serde_json::from_str(line).unwrap();
        let sequence = field(&event, "sequence").as_u64().unwrap();
        assert_eq!(sequence, count as u64);
        let kind = field(&event, "kind").as_str().unwrap();
        assert_eq!(
            number(&event, "status"),
            STATUS_OK,
            "captured event {sequence} failed"
        );
        if kind != "initialize" {
            assert!(
                initialized,
                "event {sequence} preceded engine initialization"
            );
        }
        match kind {
            "initialize" => {
                assert_eq!(sequence, 0, "initialization must be first and unique");
                assert!(!initialized);
                assert!(field(&event, "args").as_array().unwrap().is_empty());
                assert_eq!(registry.initialize(), Ok(()));
                engine.initialize().unwrap();
                initialized = true;
            }
            "registerFont" => {
                let sfnt = blob(directory, &event, "sfnt");
                let extents = blob(directory, &event, "extents");
                let availability = blob(directory, &event, "availability");
                assert_eq!(
                    registry.register_font(
                        argument(&event, 0),
                        &sfnt,
                        &extents,
                        &availability,
                        argument(&event, 7),
                        argument(&event, 8)
                    ),
                    STATUS_OK
                );
            }
            "disposeFont" => {
                assert!(!engine.references_shaping_font(argument(&event, 0)));
                assert_eq!(registry.dispose_font(argument(&event, 0)), STATUS_OK);
                engine.dispose_bindings_for_shaping_font(argument(&event, 0));
            }
            "registerCodec" => {
                let bytes = blob(directory, &event, "bytes");
                let parsed = parse_codec(&bytes).unwrap();
                engine.register_codec(argument(&event, 0), parsed).unwrap();
            }
            "disposeCodec" => engine.dispose_codec(argument(&event, 0)).unwrap(),
            "registerFontBinding" => {
                let bytes = blob(directory, &event, "bytes");
                let shaping = argument(&event, 1);
                let glyph_count = registry.glyph_count(shaping).unwrap();
                let parsed = parse_font_binding(&bytes).unwrap();
                engine
                    .register_font_binding(argument(&event, 0), shaping, glyph_count, parsed)
                    .unwrap();
            }
            "disposeFontBinding" => engine.dispose_font_binding(argument(&event, 0)),
            "registerFontStack" => {
                let bytes = blob(directory, &event, "bytes");
                assert_eq!(bytes.len(), argument(&event, 2) as usize * 4);
                let fonts: Vec<u32> = bytes
                    .chunks_exact(4)
                    .map(|word| u32::from_le_bytes(word.try_into().unwrap()))
                    .collect();
                for font in &fonts {
                    let shaping = engine.shaping_handle_for_binding(*font).unwrap();
                    assert!(registry.contains_font(shaping));
                }
                engine
                    .register_font_stack(argument(&event, 0), &fonts)
                    .unwrap();
            }
            "disposeFontStack" => engine.dispose_font_stack(argument(&event, 0)).unwrap(),
            "createRoot" => {
                let root = argument(&event, 0);
                let transport =
                    FrameTransport::new(argument(&event, 1), argument(&event, 2)).unwrap();
                engine.create_root(root).unwrap();
                let text_capacity = match argument(&event, 3) {
                    0 => crate::engine::frame::DEFAULT_ROOT_TEXT_CAPACITY,
                    capacity => capacity,
                };
                engine.reserve_root_text(root, text_capacity).unwrap();
                assert!(frames.insert(root, transport).is_none());
            }
            "reserveRoot" => {
                let root = argument(&event, 0);
                frames
                    .get_mut(&root)
                    .unwrap()
                    .reserve(argument(&event, 1), argument(&event, 2))
                    .unwrap();
                if argument(&event, 3) != 0 {
                    engine.reserve_root_text(root, argument(&event, 3)).unwrap();
                }
            }
            "resetRoot" => engine.reset_root(argument(&event, 0)).unwrap(),
            "disposeRoot" => {
                engine.dispose_root(argument(&event, 0)).unwrap();
                frames.remove(&argument(&event, 0)).unwrap();
            }
            "reserveUpdateBatch" => {
                batch.reserve(argument(&event, 0)).unwrap();
            }
            "measureParagraph" => {
                let root = argument(&event, 0);
                let paragraph = argument(&event, 3);
                let request_bytes = blob(directory, &event, "request");
                let expected = blob(directory, &event, "result");
                let transport = frames.get_mut(&root).unwrap();
                assert!(request_bytes.len() <= transport.request.capacity() as usize);
                transport.request.bytes_mut()[..request_bytes.len()]
                    .copy_from_slice(&request_bytes);
                let revision = engine.root_revision(root).unwrap();
                let request = parse_update_request(
                    transport
                        .request_at(transport.request_pointer(), request_bytes.len() as u32)
                        .unwrap(),
                    root,
                )
                .unwrap();
                let measured = engine
                    .measure_paragraph_with_shaper(&mut registry, request, paragraph)
                    .unwrap();
                let views = engine.measured_semantic_views(measured).unwrap();
                let layout = query_layout(views).unwrap();
                assert!(layout.byte_length <= request.limits.max_output_bytes);
                transport
                    .ensure_publish_capacity(layout.byte_length)
                    .unwrap();
                transport.stage_query(root, revision, views).unwrap();
                engine.commit_measure(measured).unwrap();
                let length =
                    read_u32(transport.output.bytes(), ENGINE_RESULT_BYTE_LENGTH).unwrap() as usize;
                compare_result(
                    sequence,
                    &event,
                    &expected,
                    &transport.output.bytes()[..length],
                );
            }
            "textUpdateBatch" => {
                let entries = field(&event, "entries").as_array().unwrap();
                let responses = field(&event, "responses").as_array().unwrap();
                assert_eq!(entries.len(), 1, "capture supports one ordered batch entry");
                assert!(
                    batch.capacity() >= 1,
                    "batch arena must be reserved before publication"
                );
                assert_eq!(entries.len(), responses.len());
                for (entry, response) in entries.iter().zip(responses) {
                    let root = number(entry, "rootId");
                    assert_eq!(root, number(response, "rootId"));
                    let request_bytes = blob(directory, entry, "request");
                    assert_eq!(request_bytes.len(), number(entry, "requestLength") as usize);
                    let expected = blob(directory, response, "result");
                    let transport = frames.get_mut(&root).unwrap();
                    assert!(request_bytes.len() <= transport.request.capacity() as usize);
                    transport.request.bytes_mut()[..request_bytes.len()]
                        .copy_from_slice(&request_bytes);
                    let request = parse_update_request(
                        transport
                            .request_at_current(request_bytes.len() as u32)
                            .unwrap(),
                        root,
                    )
                    .unwrap();
                    let generation = transport.next_publication_generation().unwrap();
                    let prepared = engine
                        .prepare_update_with_shaper(&mut registry, request, generation)
                        .unwrap();
                    let plan = engine.prepared_plan(prepared).unwrap();
                    let semantic = engine.prepared_semantic_views(prepared).unwrap();
                    let layout = publication_layout(plan, semantic).unwrap();
                    assert!(layout.byte_length <= request.limits.max_output_bytes);
                    transport
                        .reserve_publish_capacity(layout.byte_length)
                        .unwrap();
                    let staged = transport.stage_publication(plan, semantic, layout).unwrap();
                    let committed = engine.commit_update(prepared).unwrap();
                    transport.publish_success(committed, staged);
                    let length = read_u32(transport.output.bytes(), ENGINE_RESULT_BYTE_LENGTH)
                        .unwrap() as usize;
                    compare_result(
                        sequence,
                        &event,
                        &expected,
                        &transport.output.bytes()[..length],
                    );
                }
            }
            _ => panic!("unhandled captured event {kind} at {sequence}"),
        }
        count += 1;
    }
    assert!(count > 0);
    assert!(initialized);
    assert!(frames.is_empty(), "every captured root must be disposed");
    println!("authenticated {count} exact shipping Wasm events");
}
