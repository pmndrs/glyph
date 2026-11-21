//! The layout correctness oracle (unit 0 of the dense-stage refactor).
//!
//! Three things, all behind the `oracle` feature and all free of `std` so the same code runs
//! natively and inside the optimized wasm32 build:
//!
//! - a **lane capture** of the engine's accepted state at every stage boundary, whose digests
//!   are the frozen reference a rewritten stage is compared against;
//! - a **fixture matrix** of scripts, alignments, directions, fallback, spans, drop caps,
//!   ellipses and exclusions, each at paragraph size and at inline-label size;
//! - a **seeded differential driver** that edits, resizes and restyles a paragraph and requires
//!   every step to equal a cold layout of the same input.
//!
//! The module is a child of `state` because the capture reads paragraph-private stages.

pub mod capture;
pub mod corpus;
mod documents;
mod effects;
pub mod fonts;
pub mod fuzz;
mod inline_objects;
pub mod lanes;
pub mod matrix;
mod mechanisms;
pub mod model;
mod regions;
pub mod rng;
pub mod run;
pub mod session;
#[cfg(feature = "stage-bench")]
pub mod stage_bench;
pub mod tier;
