//! Renderer-neutral retained text-engine state.
//!
//! The public types in this module are available to native consumers. Wasm memory ownership and
//! pointer validation stay in the target-gated transport module.

pub mod font_binding;
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
pub(crate) mod font_binding_wire;
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

pub mod ordered_plan;
pub mod plan_input;
mod plan_packing;
pub mod policy;
pub mod policy_gather;
pub mod render_plan;
pub mod render_plan_compiler;
pub(crate) mod render_plan_wire;
mod semantic_wire;
mod shaping_state;
#[cfg_attr(not(test), allow(dead_code))]
mod stable_order;
pub mod stable_plan;
#[cfg_attr(not(test), allow(dead_code))]
mod stable_pool;
mod style_state;
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
pub(crate) mod wire;

pub use state::{EngineError, TextEngine};
