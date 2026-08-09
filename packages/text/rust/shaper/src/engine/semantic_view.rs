//! Demand-shaped semantic records returned only when explicitly requested.
//!
//! Semantic views can share a publication with a render plan, but they are not commands and are
//! never part of `RenderPlanView`.

pub const SEMANTIC_LINE: u16 = 1;
pub const SEMANTIC_FRAGMENT: u16 = 2;
pub const SEMANTIC_RUN: u16 = 3;
pub const SEMANTIC_CLUSTER: u16 = 4;
pub const SEMANTIC_CARET: u16 = 5;
pub const SEMANTIC_SELECTION: u16 = 6;
pub const SEMANTIC_INSERTED_GLYPH: u16 = 7;
pub const SEMANTIC_PARAGRAPH_MEASUREMENT: u16 = 8;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SemanticRecord {
    pub id: u32,
    pub kind: u16,
    pub flags: u16,
    pub parent_id: u32,
    pub text_start: u32,
    pub text_end: u32,
    pub item_start: u32,
    pub item_count: u32,
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_extent: f32,
    pub block_extent: f32,
}

const _: () = assert!(core::mem::size_of::<SemanticRecord>() == 44);
