//! Direct-memory decoding for the retained engine update transaction.
//!
//! The compiler-derived offsets in `abi_contract` remain the sole layout authority. Stage 1
//! admits only semantic sections whose Rust consumer has landed; no request can silently fall
//! back to TypeScript logic.

use crate::{
    STATUS_INVALID_REQUEST,
    abi_contract::{
        ABI_VERSION, ENGINE_RESULT_HEADER_SIZE, ENGINE_UPDATE_ABI_VERSION,
        ENGINE_UPDATE_ACKNOWLEDGED_PUBLICATION_GENERATION, ENGINE_UPDATE_BYTE_LENGTH,
        ENGINE_UPDATE_CAPABILITY_SET, ENGINE_UPDATE_CONSTRAINT_COUNT,
        ENGINE_UPDATE_CONSTRAINTS_OFFSET, ENGINE_UPDATE_CONSUMED_PLAN_REVISION,
        ENGINE_UPDATE_EXCLUSION_COUNT, ENGINE_UPDATE_EXCLUSIONS_OFFSET,
        ENGINE_UPDATE_EXPECTED_ENGINE_REVISION, ENGINE_UPDATE_FLAGS,
        ENGINE_UPDATE_INLINE_OBJECT_COUNT, ENGINE_UPDATE_INLINE_OBJECTS_OFFSET,
        ENGINE_UPDATE_MAX_CLUSTERS, ENGINE_UPDATE_MAX_EXCLUSIONS, ENGINE_UPDATE_MAX_INLINE_OBJECTS,
        ENGINE_UPDATE_MAX_LINES, ENGINE_UPDATE_MAX_OUTPUT_BYTES, ENGINE_UPDATE_MAX_PARAGRAPHS,
        ENGINE_UPDATE_MAX_REGIONS, ENGINE_UPDATE_MAX_SLOTS_PER_BAND,
        ENGINE_UPDATE_PARAGRAPH_MUTATION_COUNT, ENGINE_UPDATE_PARAGRAPH_MUTATIONS_OFFSET,
        ENGINE_UPDATE_POLICY_HANDLE, ENGINE_UPDATE_POLICY_PARAMETERS_LENGTH,
        ENGINE_UPDATE_POLICY_PARAMETERS_OFFSET, ENGINE_UPDATE_REGION_COUNT,
        ENGINE_UPDATE_REGIONS_OFFSET, ENGINE_UPDATE_REQUEST_HEADER_SIZE,
        ENGINE_UPDATE_RETAINED_PLAN_ID, ENGINE_UPDATE_SEMANTIC_VIEW_MASK,
        ENGINE_UPDATE_STYLE_MUTATION_COUNT, ENGINE_UPDATE_STYLE_MUTATIONS_OFFSET,
        ENGINE_UPDATE_TEXT_MUTATION_COUNT, ENGINE_UPDATE_TEXT_MUTATIONS_OFFSET,
    },
    engine::{
        frame::{UpdateLimits, UpdateRequest},
        semantic_wire::{parse_geometry, parse_paragraph_mutations, parse_text_mutations},
    },
    wire::read_u32,
};

const MAX_DECLARED_OUTPUT_BYTES: u32 = 64 * 1024 * 1024;

pub(crate) fn parse_update_request(
    bytes: &[u8],
    retained_plan_id: u32,
) -> Result<UpdateRequest<'_>, u32> {
    if bytes.len() < ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
        || read_u32(bytes, ENGINE_UPDATE_ABI_VERSION)? != ABI_VERSION
        || read_u32(bytes, ENGINE_UPDATE_RETAINED_PLAN_ID)? != retained_plan_id
        || read_u32(bytes, ENGINE_UPDATE_BYTE_LENGTH)?
            != u32::try_from(bytes.len()).map_err(|_| STATUS_INVALID_REQUEST)?
    {
        return Err(STATUS_INVALID_REQUEST);
    }
    let flags = read_u32(bytes, ENGINE_UPDATE_FLAGS)?;
    if flags & !super::frame::FRAME_FLAGS != 0 {
        return Err(STATUS_INVALID_REQUEST);
    }
    let semantic_view_mask = read_u32(bytes, ENGINE_UPDATE_SEMANTIC_VIEW_MASK)?;
    if semantic_view_mask & !super::frame::SEMANTIC_VIEW_MASK != 0 {
        return Err(STATUS_INVALID_REQUEST);
    }

    for (offset, count) in [(
        ENGINE_UPDATE_POLICY_PARAMETERS_OFFSET,
        ENGINE_UPDATE_POLICY_PARAMETERS_LENGTH,
    )] {
        if read_u32(bytes, offset)? != 0 || read_u32(bytes, count)? != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    let limits = UpdateLimits {
        max_paragraphs: positive(bytes, ENGINE_UPDATE_MAX_PARAGRAPHS)?,
        max_clusters: positive(bytes, ENGINE_UPDATE_MAX_CLUSTERS)?,
        max_lines: positive(bytes, ENGINE_UPDATE_MAX_LINES)?,
        max_regions: positive(bytes, ENGINE_UPDATE_MAX_REGIONS)?,
        max_exclusions: positive(bytes, ENGINE_UPDATE_MAX_EXCLUSIONS)?,
        max_inline_objects: positive(bytes, ENGINE_UPDATE_MAX_INLINE_OBJECTS)?,
        max_slots_per_band: positive(bytes, ENGINE_UPDATE_MAX_SLOTS_PER_BAND)?,
        max_output_bytes: read_u32(bytes, ENGINE_UPDATE_MAX_OUTPUT_BYTES)?,
    };
    if !limits.all_nonzero()
        || limits.max_output_bytes < ENGINE_RESULT_HEADER_SIZE
        || limits.max_output_bytes > MAX_DECLARED_OUTPUT_BYTES
    {
        return Err(STATUS_INVALID_REQUEST);
    }
    let paragraph_mutation_count = read_u32(bytes, ENGINE_UPDATE_PARAGRAPH_MUTATION_COUNT)?;
    if paragraph_mutation_count > limits.max_paragraphs {
        return Err(STATUS_INVALID_REQUEST);
    }
    let paragraph_mutations = parse_paragraph_mutations(
        bytes,
        read_u32(bytes, ENGINE_UPDATE_PARAGRAPH_MUTATIONS_OFFSET)?,
        paragraph_mutation_count,
    )?;
    let text_mutation_count = read_u32(bytes, ENGINE_UPDATE_TEXT_MUTATION_COUNT)?;
    if text_mutation_count > limits.max_clusters {
        return Err(STATUS_INVALID_REQUEST);
    }
    let text_mutations = parse_text_mutations(
        bytes,
        read_u32(bytes, ENGINE_UPDATE_TEXT_MUTATIONS_OFFSET)?,
        text_mutation_count,
    )?;
    let style_mutation_count = read_u32(bytes, ENGINE_UPDATE_STYLE_MUTATION_COUNT)?;
    if style_mutation_count > limits.max_clusters {
        return Err(STATUS_INVALID_REQUEST);
    }
    let style_mutations = super::semantic_wire::parse_style_mutations(
        bytes,
        read_u32(bytes, ENGINE_UPDATE_STYLE_MUTATIONS_OFFSET)?,
        style_mutation_count,
    )?;
    let constraint_count = read_u32(bytes, ENGINE_UPDATE_CONSTRAINT_COUNT)?;
    let region_count = read_u32(bytes, ENGINE_UPDATE_REGION_COUNT)?;
    let exclusion_count = read_u32(bytes, ENGINE_UPDATE_EXCLUSION_COUNT)?;
    let inline_object_count = read_u32(bytes, ENGINE_UPDATE_INLINE_OBJECT_COUNT)?;
    let geometry = parse_geometry(
        bytes,
        read_u32(bytes, ENGINE_UPDATE_CONSTRAINTS_OFFSET)?,
        constraint_count,
        read_u32(bytes, ENGINE_UPDATE_REGIONS_OFFSET)?,
        region_count,
        read_u32(bytes, ENGINE_UPDATE_EXCLUSIONS_OFFSET)?,
        exclusion_count,
        read_u32(bytes, ENGINE_UPDATE_INLINE_OBJECTS_OFFSET)?,
        inline_object_count,
        limits,
    )?;
    text_mutations.validate_disjoint_geometry(geometry)?;
    style_mutations.validate_disjoint_semantics(text_mutations, geometry)?;
    paragraph_mutations.validate_disjoint_semantics(text_mutations, style_mutations, geometry)?;
    if paragraph_mutation_count == 0
        && text_mutation_count == 0
        && style_mutation_count == 0
        && constraint_count == 0
        && region_count == 0
        && exclusion_count == 0
        && inline_object_count == 0
        && bytes.len() != ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
    {
        return Err(STATUS_INVALID_REQUEST);
    }
    Ok(UpdateRequest {
        retained_plan_id,
        expected_engine_revision: read_u32(bytes, ENGINE_UPDATE_EXPECTED_ENGINE_REVISION)?,
        consumed_plan_revision: read_u32(bytes, ENGINE_UPDATE_CONSUMED_PLAN_REVISION)?,
        acknowledged_publication_generation: read_u32(
            bytes,
            ENGINE_UPDATE_ACKNOWLEDGED_PUBLICATION_GENERATION,
        )?,
        policy_handle: read_u32(bytes, ENGINE_UPDATE_POLICY_HANDLE)?,
        capability_set: positive(bytes, ENGINE_UPDATE_CAPABILITY_SET)?,
        semantic_view_mask,
        compositing_independent: flags & super::frame::FRAME_FLAG_COMPOSITING_INDEPENDENT != 0,
        limits,
        paragraph_mutations,
        text_mutations,
        style_mutations,
        geometry,
    })
}

fn positive(bytes: &[u8], offset: usize) -> Result<u32, u32> {
    let value = read_u32(bytes, offset)?;
    if value == 0 {
        Err(STATUS_INVALID_REQUEST)
    } else {
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::write_u32;
    use alloc::vec;

    #[test]
    fn accepts_only_the_canonical_empty_stage_one_transaction() {
        let bytes = request();
        let parsed = parse_update_request(&bytes, 4).unwrap();
        assert_eq!(parsed.retained_plan_id, 4);
        assert_eq!(parsed.policy_handle, 9);

        let mut independent = bytes.clone();
        write_u32(
            &mut independent,
            ENGINE_UPDATE_FLAGS,
            super::super::frame::FRAME_FLAG_COMPOSITING_INDEPENDENT,
        );
        assert!(
            parse_update_request(&independent, 4)
                .unwrap()
                .compositing_independent
        );

        let mut unknown_flag = bytes.clone();
        write_u32(&mut unknown_flag, ENGINE_UPDATE_FLAGS, 1 << 31);
        assert_eq!(
            parse_update_request(&unknown_flag, 4),
            Err(STATUS_INVALID_REQUEST)
        );

        let mut measurement = bytes.clone();
        write_u32(
            &mut measurement,
            ENGINE_UPDATE_SEMANTIC_VIEW_MASK,
            super::super::frame::SEMANTIC_VIEW_MEASUREMENT,
        );
        assert_eq!(
            parse_update_request(&measurement, 4)
                .unwrap()
                .semantic_view_mask,
            super::super::frame::SEMANTIC_VIEW_MEASUREMENT
        );

        let mut unknown_view = bytes.clone();
        write_u32(&mut unknown_view, ENGINE_UPDATE_SEMANTIC_VIEW_MASK, 1 << 31);
        assert_eq!(
            parse_update_request(&unknown_view, 4),
            Err(STATUS_INVALID_REQUEST)
        );

        let mut trailing = bytes.clone();
        trailing.push(0);
        let trailing_length = u32::try_from(trailing.len()).unwrap();
        write_u32(&mut trailing, ENGINE_UPDATE_BYTE_LENGTH, trailing_length);
        assert_eq!(
            parse_update_request(&trailing, 4),
            Err(STATUS_INVALID_REQUEST)
        );

        let mut nonempty = bytes;
        write_u32(&mut nonempty, ENGINE_UPDATE_REGION_COUNT, 1);
        assert_eq!(
            parse_update_request(&nonempty, 4),
            Err(STATUS_INVALID_REQUEST)
        );
    }

    pub(super) fn request() -> Vec<u8> {
        let mut bytes = vec![0; ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize];
        write_u32(&mut bytes, ENGINE_UPDATE_ABI_VERSION, ABI_VERSION);
        write_u32(
            &mut bytes,
            ENGINE_UPDATE_BYTE_LENGTH,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE,
        );
        write_u32(&mut bytes, ENGINE_UPDATE_RETAINED_PLAN_ID, 4);
        write_u32(&mut bytes, ENGINE_UPDATE_POLICY_HANDLE, 9);
        write_u32(&mut bytes, ENGINE_UPDATE_CAPABILITY_SET, 1);
        for offset in [
            ENGINE_UPDATE_MAX_PARAGRAPHS,
            ENGINE_UPDATE_MAX_CLUSTERS,
            ENGINE_UPDATE_MAX_LINES,
            ENGINE_UPDATE_MAX_REGIONS,
            ENGINE_UPDATE_MAX_EXCLUSIONS,
            ENGINE_UPDATE_MAX_INLINE_OBJECTS,
            ENGINE_UPDATE_MAX_SLOTS_PER_BAND,
        ] {
            write_u32(&mut bytes, offset, 1);
        }
        write_u32(
            &mut bytes,
            ENGINE_UPDATE_MAX_OUTPUT_BYTES,
            ENGINE_RESULT_HEADER_SIZE,
        );
        bytes
    }
}
