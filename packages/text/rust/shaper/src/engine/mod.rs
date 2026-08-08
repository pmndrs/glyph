//! Renderer-neutral retained text-engine state.
//!
//! The public types in this module are available to native consumers. Wasm memory ownership and
//! pointer validation stay in the target-gated transport module.

mod state;

pub mod policy;
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
pub(crate) mod wire;

pub use state::{EngineError, TextEngine};
