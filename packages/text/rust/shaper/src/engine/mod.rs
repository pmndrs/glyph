//! Renderer-neutral retained text-engine state.
//!
//! The public types in this module are available to native consumers. Wasm memory ownership and
//! pointer validation stay in the target-gated transport module.

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) mod frame;
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
pub(crate) mod frame_wire;
#[cfg(feature = "kernel-lab")]
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) mod kernel_lab;
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
mod state;
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) mod transport;

pub mod policy;
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
pub(crate) mod wire;

pub use state::{EngineError, TextEngine};
