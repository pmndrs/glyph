//! Wasm exports for the layout oracle probe: the host hands over font files and one text
//! command at a time, and reads the answer back. Only built with the `oracle` feature; no
//! shipped artifact carries it.

use alloc::{boxed::Box, collections::BTreeMap, string::String, vec, vec::Vec};
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::engine::oracle::{fonts::FontLibrary, run};

#[derive(Default)]
struct ProbeState {
    library: FontLibrary,
    /// The reference set's files by name.
    files: BTreeMap<String, String>,
    /// Host-written input buffers, kept alive until the next command consumes them.
    inputs: Vec<Vec<u8>>,
    answer: String,
}

static STATE: AtomicUsize = AtomicUsize::new(0);

fn with_state<Result>(operation: impl FnOnce(&mut ProbeState) -> Result) -> Result {
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 {
        pointer = Box::into_raw(Box::new(ProbeState::default())) as usize;
        STATE.store(pointer, Ordering::Release);
    }
    // SAFETY: the module is single-threaded, the state is allocated once and never freed, and
    // every export returns before another can enter, so this is the only live reference.
    operation(unsafe { &mut *(pointer as *mut ProbeState) })
}

/// Reserves `length` zeroed bytes for the host to fill and returns their address.
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_oracle_alloc(length: u32) -> u32 {
    with_state(|state| {
        state.inputs.push(vec![0; length as usize]);
        state.inputs.last().map_or(0, |input| input.as_ptr() as u32)
    })
}

/// The bytes of an input buffer previously returned by `pmndrs_glyph_oracle_alloc`.
fn input(state: &ProbeState, pointer: u32, length: u32) -> Option<&[u8]> {
    state
        .inputs
        .iter()
        .find(|input| input.as_ptr() as u32 == pointer && input.len() == length as usize)
        .map(Vec::as_slice)
}

/// Registers the font file in one input buffer under the key in another. Returns 0 on success.
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_oracle_font(
    key_pointer: u32,
    key_length: u32,
    font_pointer: u32,
    font_length: u32,
) -> u32 {
    with_state(|state| {
        let key = input(state, key_pointer, key_length)
            .and_then(|key| core::str::from_utf8(key).ok())
            .map(String::from);
        let font = input(state, font_pointer, font_length).map(<[u8]>::to_vec);
        state.inputs.clear();
        match (key, font) {
            (Some(key), Some(font)) => u32::from(state.library.insert(&key, font).is_err()),
            _ => 1,
        }
    })
}

/// Stores one file of the reference set under the name in another input buffer.
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_oracle_file(
    name_pointer: u32,
    name_length: u32,
    file_pointer: u32,
    file_length: u32,
) -> u32 {
    with_state(|state| {
        let text = |pointer, length| {
            input(state, pointer, length)
                .and_then(|bytes| core::str::from_utf8(bytes).ok())
                .map(String::from)
        };
        let entry = (
            text(name_pointer, name_length),
            text(file_pointer, file_length),
        );
        state.inputs.clear();
        match entry {
            (Some(name), Some(file)) => {
                state.files.insert(name, file);
                0
            }
            _ => 1,
        }
    })
}

/// Runs the command line in one input buffer with the payload in another, and returns the
/// address of the UTF-8 answer; `pmndrs_glyph_oracle_answer_length` gives its length.
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_oracle_command(
    line_pointer: u32,
    line_length: u32,
    payload_pointer: u32,
    payload_length: u32,
) -> u32 {
    with_state(|state| {
        let text = |pointer, length| {
            input(state, pointer, length)
                .and_then(|bytes| core::str::from_utf8(bytes).ok())
                .map(String::from)
        };
        let line = text(line_pointer, line_length);
        let payload = if payload_length == 0 {
            Some(String::new())
        } else {
            text(payload_pointer, payload_length)
        };
        state.inputs.clear();
        state.answer = match (line, payload) {
            (Some(line), Some(payload)) => {
                run::command(&state.library, &state.files, &line, &payload)
            }
            _ => String::from("fail\ncommand or payload is not an input buffer of UTF-8 text"),
        };
        state.answer.as_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_oracle_answer_length() -> u32 {
    with_state(|state| state.answer.len() as u32)
}
