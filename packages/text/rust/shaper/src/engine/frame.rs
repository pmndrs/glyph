pub(crate) const RESULT_FLAG_CHECKPOINT: u32 = 1;

pub(crate) const TEXT_MUTATION_REPLACE_UTF16: u8 = 1;
pub(crate) const TEXT_ENCODING_UTF16_LE: u8 = 1;
pub(crate) const STYLE_MUTATION_UPSERT: u8 = 1;
pub(crate) const STYLE_MUTATION_REMOVE: u8 = 2;
pub(crate) const STYLE_FLAG_ROOT: u8 = 1;
pub(crate) const STYLE_FIELD_FONT_STACK: u32 = 1 << 0;
pub(crate) const STYLE_FIELD_MATERIAL: u32 = 1 << 1;
pub(crate) const STYLE_FIELD_LANGUAGE: u32 = 1 << 2;
pub(crate) const STYLE_FIELD_FEATURES: u32 = 1 << 3;
pub(crate) const STYLE_FIELD_FONT_SIZE: u32 = 1 << 4;
pub(crate) const STYLE_FIELD_LINE_HEIGHT: u32 = 1 << 5;
pub(crate) const STYLE_FIELD_LETTER_SPACING: u32 = 1 << 6;
pub(crate) const STYLE_FIELD_WORD_SPACING: u32 = 1 << 7;
pub(crate) const STYLE_FIELD_BASELINE_SHIFT: u32 = 1 << 8;
pub(crate) const STYLE_FIELD_RASTER_PIXEL_RATIO: u32 = 1 << 9;
pub(crate) const STYLE_FIELD_DIRECTION: u32 = 1 << 10;
pub(crate) const STYLE_FIELD_FOREGROUND: u32 = 1 << 11;
pub(crate) const STYLE_FIELD_DECORATION: u32 = 1 << 12;
pub(crate) const STYLE_FIELD_MASK: u32 = (1 << 13) - 1;
pub(crate) const DECORATION_NONE: u8 = 0;
pub(crate) const DECORATION_SOLID: u8 = 1;
pub(crate) const DECORATION_DOUBLE: u8 = 2;
pub(crate) const DECORATION_DOTTED: u8 = 3;
pub(crate) const DECORATION_DASHED: u8 = 4;
pub(crate) const DECORATION_WAVY: u8 = 5;
pub(crate) const DECORATION_UNDERLINE: u32 = 1 << 0;
pub(crate) const DECORATION_OVERLINE: u32 = 1 << 1;
pub(crate) const DECORATION_LINE_THROUGH: u32 = 1 << 2;
pub(crate) const DECORATION_SKIP_INK: u32 = 1 << 3;
pub(crate) const DECORATION_FLAGS_MASK: u32 = (1 << 4) - 1;
pub(crate) const SHAPE_RECTANGLE: u8 = 1;
pub(crate) const SHAPE_POLYGON: u8 = 2;
pub(crate) const WRITING_HORIZONTAL_TB: u8 = 1;
pub(crate) const WRITING_VERTICAL_RL: u8 = 2;
pub(crate) const WRITING_VERTICAL_LR: u8 = 3;
pub(crate) const ORIENTATION_MIXED: u8 = 1;
pub(crate) const ORIENTATION_UPRIGHT: u8 = 2;
pub(crate) const ORIENTATION_SIDEWAYS: u8 = 3;
pub(crate) const AXIS_UNCONSTRAINED: u8 = 1;
pub(crate) const AXIS_AT_MOST: u8 = 2;
pub(crate) const AXIS_EXACT: u8 = 3;
pub(crate) const WRAP_NONE: u8 = 1;
pub(crate) const WRAP_WORD: u8 = 2;
pub(crate) const WRAP_CHARACTER: u8 = 3;
pub(crate) const ALIGN_START: u8 = 1;
pub(crate) const ALIGN_CENTER: u8 = 2;
pub(crate) const ALIGN_END: u8 = 3;
pub(crate) const ALIGN_JUSTIFY: u8 = 4;
pub(crate) const OVERFLOW_VISIBLE: u8 = 1;
pub(crate) const OVERFLOW_CLIP: u8 = 2;
pub(crate) const OVERFLOW_ELLIPSIS: u8 = 3;
pub(crate) const BLOCK_ALIGN_START: u8 = 1;
pub(crate) const BLOCK_ALIGN_CENTER: u8 = 2;
pub(crate) const BLOCK_ALIGN_END: u8 = 3;
pub(crate) const EXCLUSION_WRAP_BOTH: u8 = 1;
pub(crate) const EXCLUSION_WRAP_INLINE_START: u8 = 2;
pub(crate) const EXCLUSION_WRAP_INLINE_END: u8 = 3;
pub(crate) const EXCLUSION_WRAP_LARGEST: u8 = 4;
pub(crate) const BASELINE_ALPHABETIC: u8 = 1;
pub(crate) const BASELINE_TEXT_TOP: u8 = 2;
pub(crate) const BASELINE_MIDDLE: u8 = 3;
pub(crate) const BASELINE_TEXT_BOTTOM: u8 = 4;
pub(crate) const DEFAULT_SESSION_TEXT_CAPACITY: u32 = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct UpdateRequest<'a> {
    pub session_id: u32,
    pub expected_engine_revision: u32,
    pub consumed_plan_revision: u32,
    pub acknowledged_publication_generation: u32,
    pub policy_handle: u32,
    pub capability_set: u32,
    pub limits: UpdateLimits,
    pub text_mutations: super::semantic_wire::TextMutationBatch<'a>,
    pub style_mutations: super::semantic_wire::StyleMutationBatch<'a>,
    pub geometry: super::semantic_wire::GeometryBatch<'a>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct UpdateLimits {
    pub max_clusters: u32,
    pub max_lines: u32,
    pub max_regions: u32,
    pub max_exclusions: u32,
    pub max_inline_objects: u32,
    pub max_slots_per_band: u32,
    pub max_output_bytes: u32,
}

impl UpdateLimits {
    pub fn all_nonzero(self) -> bool {
        self.max_clusters != 0
            && self.max_lines != 0
            && self.max_regions != 0
            && self.max_exclusions != 0
            && self.max_inline_objects != 0
            && self.max_slots_per_band != 0
            && self.max_output_bytes != 0
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SessionRevision {
    pub engine: u32,
    pub plan: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PreparedUpdate {
    pub(super) session_id: u32,
    pub(super) previous: SessionRevision,
    pub(super) next: SessionRevision,
    pub(super) required_base_revision: u32,
    pub(super) checkpoint: bool,
    pub(super) policy_handle: u32,
    pub(super) capability_set: u32,
    pub(super) policy_fingerprint: u64,
}

impl PreparedUpdate {
    pub(crate) fn session_id(self) -> u32 {
        self.session_id
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CommittedUpdate {
    pub session_id: u32,
    pub revision: SessionRevision,
    pub required_base_revision: u32,
    pub checkpoint: bool,
}
