//! Applying and validating the text mutations of a request against a paragraph's committed text.

use crate::cold_growth::ColdGrowth as _;

use super::*;

pub(super) fn apply_text_mutation(
    text: &mut Vec<u16>,
    mutation: crate::engine::semantic_wire::TextMutation<'_>,
) -> Result<(), TextMutationError> {
    let old_len = text.len();
    let CheckedTextMutation {
        start,
        delete_end,
        insert_count,
        new_len,
    } = check_text_mutation(old_len, mutation)?;
    if new_len > old_len {
        text.try_reserve_cold(new_len - old_len)
            .map_err(|_| TextMutationError::Allocation)?;
        text.resize(new_len, 0);
    }
    text.copy_within(delete_end..old_len, start + insert_count);
    if new_len < old_len {
        text.truncate(new_len);
    }
    for (unit, decoded) in text[start..start + insert_count]
        .iter_mut()
        .zip(decoded_inserted_units(mutation.insert_utf16_le))
    {
        *unit = decoded;
    }
    Ok(())
}

pub(super) fn decoded_inserted_units(utf16_le: &[u8]) -> impl Iterator<Item = u16> + '_ {
    utf16_le
        .chunks_exact(2)
        .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
}

/// Preflight has already validated every mutation against the accepted text. A single
/// complete replacement can write directly into the reused destination without seeding
/// or shifting old units; ordered and partial edits retain the shared mutation path.
pub(super) fn populate_preflight_text(
    destination: &mut Vec<u16>,
    committed: &[u16],
    mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
    seed_committed: bool,
    preserved_capacity: usize,
) -> Result<(), EngineError> {
    if mutations.len() == 1 {
        let mutation = mutations.get(0).ok_or(EngineError::InvalidRequest)?;
        if mutation.text_start == 0
            && usize::try_from(mutation.delete_count).ok() == Some(committed.len())
        {
            let insert_count = mutation.insert_utf16_le.len() / 2;
            destination.clear();
            destination
                .try_reserve_cold(insert_count.max(preserved_capacity))
                .map_err(|_| EngineError::ResultTooLarge)?;
            destination.extend(decoded_inserted_units(mutation.insert_utf16_le));
            return Ok(());
        }
    }
    if seed_committed {
        destination.clear();
        destination
            .try_reserve_cold(committed.len().max(preserved_capacity))
            .map_err(|_| EngineError::ResultTooLarge)?;
        destination.extend_from_slice(committed);
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.preflight_seeded_old_units += committed.len()
        });
    }
    apply_text_mutations(destination, mutations)
}

pub(super) fn apply_text_mutations(
    text: &mut Vec<u16>,
    mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
) -> Result<(), EngineError> {
    for index in 0..mutations.len() {
        let mutation = mutations.get(index).ok_or(EngineError::InvalidRequest)?;
        apply_text_mutation(text, mutation).map_err(|error| match error {
            TextMutationError::Invalid => EngineError::InvalidRequest,
            TextMutationError::Allocation => EngineError::ResultTooLarge,
        })?;
    }
    Ok(())
}

pub(super) fn copy_preflight_text_edits(
    destination: &mut Vec<TextEdit>,
    source: &[TextEdit],
    start: usize,
    end: usize,
) -> Result<(), EngineError> {
    let edits = source.get(start..end).ok_or(EngineError::InvalidRequest)?;
    destination.clear();
    destination
        .try_reserve_cold(edits.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    destination.extend_from_slice(edits);
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct CheckedTextMutation {
    pub(super) start: usize,
    pub(super) delete_end: usize,
    pub(super) insert_count: usize,
    pub(super) new_len: usize,
}

pub(super) fn check_text_mutation(
    old_len: usize,
    mutation: crate::engine::semantic_wire::TextMutation<'_>,
) -> Result<CheckedTextMutation, TextMutationError> {
    let start = usize::try_from(mutation.text_start).map_err(|_| TextMutationError::Invalid)?;
    let delete_count =
        usize::try_from(mutation.delete_count).map_err(|_| TextMutationError::Invalid)?;
    let delete_end = start
        .checked_add(delete_count)
        .ok_or(TextMutationError::Invalid)?;
    if delete_end > old_len || !mutation.insert_utf16_le.len().is_multiple_of(2) {
        return Err(TextMutationError::Invalid);
    }
    let insert_count = mutation.insert_utf16_le.len() / 2;
    let new_len = old_len
        .checked_sub(delete_count)
        .and_then(|length| length.checked_add(insert_count))
        .ok_or(TextMutationError::Invalid)?;
    if u32::try_from(new_len).is_err() {
        return Err(TextMutationError::Invalid);
    }
    Ok(CheckedTextMutation {
        start,
        delete_end,
        insert_count,
        new_len,
    })
}

pub(super) fn validate_text_mutations(
    committed: &[u16],
    mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
) -> Result<usize, EngineError> {
    let mut text_len = committed.len();
    for index in 0..mutations.len() {
        let mutation = mutations.get(index).ok_or(EngineError::InvalidRequest)?;
        let checked =
            check_text_mutation(text_len, mutation).map_err(|_| EngineError::InvalidRequest)?;
        let left = checked
            .start
            .checked_sub(1)
            .and_then(|unit| text_unit_before_mutation(committed, mutations, index, unit));
        let start_right = text_unit_before_mutation(committed, mutations, index, checked.start);
        let end_left = checked
            .delete_end
            .checked_sub(1)
            .and_then(|unit| text_unit_before_mutation(committed, mutations, index, unit));
        let right = text_unit_before_mutation(committed, mutations, index, checked.delete_end);
        if !valid_utf16_boundary_pair(left, start_right)
            || !valid_utf16_boundary_pair(end_left, right)
        {
            return Err(EngineError::InvalidRequest);
        }

        let inserted_units = mutation
            .insert_utf16_le
            .chunks_exact(2)
            .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]));
        if core::char::decode_utf16(inserted_units).any(|decoded| decoded.is_err()) {
            return Err(EngineError::InvalidRequest);
        }
        let first = inserted_unit(mutation, 0);
        let last = checked
            .insert_count
            .checked_sub(1)
            .and_then(|index| inserted_unit(mutation, index));
        let seam_valid = if checked.insert_count == 0 {
            valid_utf16_join(left, right)
        } else {
            valid_utf16_join(left, first) && valid_utf16_join(last, right)
        };
        if !seam_valid {
            return Err(EngineError::InvalidRequest);
        }
        text_len = checked.new_len;
    }
    Ok(text_len)
}

pub(super) fn has_text_mutations_for(
    mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
    paragraph_id: u32,
) -> bool {
    (0..mutations.len()).any(|index| mutations.paragraph_id(index) == Some(paragraph_id))
}

pub(super) fn inserted_unit(
    mutation: crate::engine::semantic_wire::TextMutation<'_>,
    index: usize,
) -> Option<u16> {
    let offset = index.checked_mul(2)?;
    Some(u16::from_le_bytes([
        *mutation.insert_utf16_le.get(offset)?,
        *mutation.insert_utf16_le.get(offset + 1)?,
    ]))
}

pub(super) fn text_unit_before_mutation(
    committed: &[u16],
    mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
    mutation_index: usize,
    mut unit_index: usize,
) -> Option<u16> {
    for prior_index in (0..mutation_index).rev() {
        let prior = mutations.get(prior_index)?;
        let start = usize::try_from(prior.text_start).ok()?;
        let deleted = usize::try_from(prior.delete_count).ok()?;
        let inserted = prior.insert_utf16_le.len() / 2;
        let inserted_end = start.checked_add(inserted)?;
        if unit_index < start {
            continue;
        }
        if unit_index < inserted_end {
            let offset = (unit_index - start).checked_mul(2)?;
            return Some(u16::from_le_bytes([
                *prior.insert_utf16_le.get(offset)?,
                *prior.insert_utf16_le.get(offset + 1)?,
            ]));
        }
        unit_index = unit_index.checked_sub(inserted)?.checked_add(deleted)?;
    }
    committed.get(unit_index).copied()
}

pub(super) fn utf16_boundary_after_mutations(
    committed: &[u16],
    mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
    length: u32,
    offset: u32,
) -> bool {
    if offset > length {
        return false;
    }
    if offset == 0 || offset == length {
        return true;
    }
    // Both callers pass the final length returned by validate_text_mutations
    // for this same committed text and mutation batch.
    let Ok(offset) = usize::try_from(offset) else {
        return false;
    };
    let Some(left) = text_unit_before_mutation(committed, mutations, mutations.len(), offset - 1)
    else {
        return false;
    };
    let Some(right) = text_unit_before_mutation(committed, mutations, mutations.len(), offset)
    else {
        return false;
    };
    valid_utf16_boundary_pair(Some(left), Some(right))
}

pub(super) fn valid_utf16_join(left: Option<u16>, right: Option<u16>) -> bool {
    let left_high = left.is_some_and(|unit| (0xd800..=0xdbff).contains(&unit));
    let right_low = right.is_some_and(|unit| (0xdc00..=0xdfff).contains(&unit));
    left_high == right_low
}

pub(super) fn valid_utf16_boundary_pair(left: Option<u16>, right: Option<u16>) -> bool {
    !(left.is_some_and(|unit| (0xd800..=0xdbff).contains(&unit))
        && right.is_some_and(|unit| (0xdc00..=0xdfff).contains(&unit)))
}
