//! Renderer-neutral retained text-engine state.
//!
//! The public types in this module are available to native consumers. Wasm memory ownership and
//! pointer validation stay in the target-gated transport module.

mod cluster_state;
#[cfg_attr(not(test), allow(dead_code))]
mod flow_composition;
#[cfg_attr(not(test), allow(dead_code))]
mod flow_geometry;
pub mod font_binding;
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
pub(crate) mod font_binding_wire;
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) mod frame;
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
pub(crate) mod frame_wire;
mod identity_index;
#[cfg(feature = "kernel-lab")]
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) mod kernel_lab;
pub(crate) mod layout_query;
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod layout_units;
#[cfg_attr(not(test), allow(dead_code))]
mod line_composition;
pub(crate) mod line_kernels;
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
mod state;
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) mod transport;

pub mod ordered_plan;
mod plan_draw;
mod plan_error;
pub mod plan_input;
mod plan_packing;
pub mod policy;
pub mod policy_gather;
mod positioning;
pub mod render_plan;
pub mod render_plan_compiler;
pub(crate) mod render_plan_wire;
pub(crate) mod semantic_view;
mod semantic_wire;
mod shaping_state;
pub(crate) mod sort;
#[cfg_attr(not(test), allow(dead_code))]
mod stable_order;
pub mod stable_plan;
#[cfg_attr(not(test), allow(dead_code))]
mod stable_pool;
mod staged;
mod style_state;
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
pub(crate) mod wire;

pub use state::{EngineError, FrameFault, TextEngine};
