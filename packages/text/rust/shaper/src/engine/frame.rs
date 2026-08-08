pub(crate) const RESULT_FLAG_CHECKPOINT: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct UpdateRequest {
    pub session_id: u32,
    pub expected_engine_revision: u32,
    pub consumed_plan_revision: u32,
    pub policy_handle: u32,
    pub capability_set: u32,
    pub limits: UpdateLimits,
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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CommittedUpdate {
    pub session_id: u32,
    pub revision: SessionRevision,
    pub required_base_revision: u32,
    pub checkpoint: bool,
}
