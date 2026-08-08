//! Renderer-neutral retained text-engine state.
//!
//! The public types in this module are available to native consumers. Wasm memory ownership and
//! pointer validation stay in the target-gated transport module.

pub mod policy;
