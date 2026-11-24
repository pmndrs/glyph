//! Unit identities across a text edit: the changed range and the identities it mints.

use crate::cold_growth::ColdGrowth as _;

use super::*;

pub(super) fn changed_identity_range(previous: &[u32], next: &[u32]) -> Option<TextEdit> {
    let shared = previous.len().min(next.len());
    let mut start = 0usize;
    while start < shared && previous[start] == next[start] {
        start += 1;
    }
    if start == previous.len() && start == next.len() {
        return None;
    }
    let mut previous_end = previous.len();
    let mut next_end = next.len();
    while previous_end > start
        && next_end > start
        && previous[previous_end - 1] == next[next_end - 1]
    {
        previous_end -= 1;
        next_end -= 1;
    }
    Some(TextEdit {
        old_start: start,
        old_end: previous_end,
        new_start: start,
        new_end: next_end,
    })
}

/// Appends the edits inside `edit`, the range where two identity lanes differ: stretches of
/// units that kept their ids, in order, separate them. An id at or past `fresh` was minted for
/// inserted text; any other id the new lane has and the old lane lacks at that point means the
/// lanes do not pair in order, and the whole range stays one edit.
pub(super) fn split_identity_edit(
    previous: &[u32],
    next: &[u32],
    fresh: u32,
    edit: TextEdit,
    edits: &mut Vec<TextEdit>,
) -> Result<(), EngineError> {
    let first = edits.len();
    let (mut old, mut new) = (edit.old_start, edit.new_start);
    let mut open: Option<TextEdit> = None;
    let mut paired = true;
    while old < edit.old_end || new < edit.new_end {
        if old < edit.old_end && new < edit.new_end && previous[old] == next[new] {
            if let Some(done) = open.take() {
                edits
                    .try_reserve_cold(1)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                edits.push(done);
            }
            old += 1;
            new += 1;
            continue;
        }
        let span = open.get_or_insert(TextEdit {
            old_start: old,
            old_end: old,
            new_start: new,
            new_end: new,
        });
        if new < edit.new_end && next[new] >= fresh {
            new += 1;
            span.new_end = new;
        } else if old < edit.old_end {
            old += 1;
            span.old_end = old;
        } else {
            paired = false;
            break;
        }
    }
    if !paired {
        edits.truncate(first);
        edits
            .try_reserve_cold(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        edits.push(edit);
        return Ok(());
    }
    if let Some(done) = open {
        edits
            .try_reserve_cold(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        edits.push(done);
    }
    Ok(())
}

pub(super) fn bounding_text_edit(edits: &[TextEdit]) -> Option<TextEdit> {
    let first = edits.first().copied()?;
    let last = edits.last().copied()?;
    Some(TextEdit {
        old_start: first.old_start,
        old_end: last.old_end,
        new_start: first.new_start,
        new_end: last.new_end,
    })
}

#[derive(Clone, Copy)]
pub(super) enum TextReconciliation {
    SameLength { start: usize, end: usize },
    FullReplacement,
}

pub(super) fn text_reconciliation(
    mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
    committed_len: usize,
) -> Option<TextReconciliation> {
    if mutations.len() != 1 {
        return None;
    }
    let mutation = mutations.get(0)?;
    let start = usize::try_from(mutation.text_start).ok()?;
    let delete_count = usize::try_from(mutation.delete_count).ok()?;
    if !mutation.insert_utf16_le.len().is_multiple_of(2) {
        return None;
    }
    let insert_count = mutation.insert_utf16_le.len() / 2;
    if delete_count == insert_count {
        return start
            .checked_add(delete_count)
            .map(|end| TextReconciliation::SameLength { start, end });
    }
    (start == 0 && delete_count == committed_len).then_some(TextReconciliation::FullReplacement)
}

pub(super) fn collect_text_edits(
    committed: &[u16],
    pending: &[u16],
    reconciliation: TextReconciliation,
    edits: &mut Vec<TextEdit>,
    append_start: usize,
) -> Result<(), EngineError> {
    if append_start > edits.len() {
        return Err(EngineError::InvalidRequest);
    }
    match reconciliation {
        TextReconciliation::SameLength { start, end } => {
            for_each_changed_utf16_unit(
                &committed[start..end],
                &pending[start..end],
                |relative_offset| {
                    let offset = start + relative_offset;
                    if let Some(last_index) = edits.len().checked_sub(1)
                        && last_index >= append_start
                        && edits[last_index].old_end == offset
                    {
                        let edit = &mut edits[last_index];
                        edit.old_end += 1;
                        edit.new_end += 1;
                        return Ok(());
                    }
                    edits
                        .try_reserve_cold(1)
                        .map_err(|_| EngineError::ResultTooLarge)?;
                    edits.push(TextEdit {
                        old_start: offset,
                        old_end: offset + 1,
                        new_start: offset,
                        new_end: offset + 1,
                    });
                    Ok(())
                },
            )?;
            align_same_length_edits_to_utf16_scalars(committed, pending, edits, append_start);
        }
        TextReconciliation::FullReplacement => {
            let mut start = packed_common_utf16_prefix(committed, pending);
            while start > 0
                && (!valid_utf16_boundary(committed, u32::try_from(start).unwrap_or(u32::MAX))
                    || !valid_utf16_boundary(pending, u32::try_from(start).unwrap_or(u32::MAX)))
            {
                start -= 1;
            }
            let suffix = packed_common_utf16_suffix(&committed[start..], &pending[start..]);
            let mut old_end = committed.len() - suffix;
            let mut new_end = pending.len() - suffix;
            while old_end < committed.len()
                && new_end < pending.len()
                && (!valid_utf16_boundary(committed, u32::try_from(old_end).unwrap_or(u32::MAX))
                    || !valid_utf16_boundary(pending, u32::try_from(new_end).unwrap_or(u32::MAX)))
            {
                old_end += 1;
                new_end += 1;
            }
            if start != old_end || start != new_end {
                edits
                    .try_reserve_cold(1)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                edits.push(TextEdit {
                    old_start: start,
                    old_end,
                    new_start: start,
                    new_end,
                });
            }
        }
    }
    Ok(())
}

pub(super) fn align_same_length_edits_to_utf16_scalars(
    old: &[u16],
    new: &[u16],
    edits: &mut Vec<TextEdit>,
    start: usize,
) {
    let mut written = start;
    for read in start..edits.len() {
        let mut edit = edits[read];
        while edit.old_start > 0
            && (!valid_utf16_boundary(old, u32::try_from(edit.old_start).unwrap_or(u32::MAX))
                || !valid_utf16_boundary(new, u32::try_from(edit.new_start).unwrap_or(u32::MAX)))
        {
            edit.old_start -= 1;
            edit.new_start -= 1;
        }
        while edit.old_end < old.len()
            && (!valid_utf16_boundary(old, u32::try_from(edit.old_end).unwrap_or(u32::MAX))
                || !valid_utf16_boundary(new, u32::try_from(edit.new_end).unwrap_or(u32::MAX)))
        {
            edit.old_end += 1;
            edit.new_end += 1;
        }
        if written > start && edits[written - 1].old_end >= edit.old_start {
            let previous = &mut edits[written - 1];
            previous.old_end = previous.old_end.max(edit.old_end);
            previous.new_end = previous.new_end.max(edit.new_end);
        } else {
            edits[written] = edit;
            written += 1;
        }
    }
    edits.truncate(written);
}

pub(super) fn reconcile_text_identities(
    committed: &TextStage,
    pending: &mut TextStage,
    edits: &[TextEdit],
    reconciliation: Option<TextReconciliation>,
) -> Result<(), EngineError> {
    let expected_pending_ids =
        if matches!(reconciliation, Some(TextReconciliation::FullReplacement)) {
            committed.units.len()
        } else {
            pending.units.len()
        };
    if pending.unit_ids.len() != expected_pending_ids {
        return Err(EngineError::InvalidRequest);
    }
    match reconciliation {
        Some(TextReconciliation::SameLength { .. }) => {
            for edit in edits {
                let identities = pending
                    .unit_ids
                    .get_mut(edit.new_start..edit.new_end)
                    .ok_or(EngineError::InvalidRequest)?;
                for identity in identities {
                    *identity = take_next_unit_identity(&mut pending.next_unit_id)?;
                }
            }
        }
        Some(TextReconciliation::FullReplacement) => {
            if let Some(edit) = edits.first().copied() {
                apply_text_identity_edit(
                    &mut pending.unit_ids,
                    &mut pending.next_unit_id,
                    edit.new_start,
                    edit.old_end - edit.old_start,
                    edit.new_end - edit.new_start,
                )?;
            }
        }
        None => (),
    }
    if pending.unit_ids.len() != pending.units.len() {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

pub(super) fn packed_common_utf16_prefix(left: &[u16], right: &[u16]) -> usize {
    let shared = left.len().min(right.len());
    let paired = shared & !1;
    let mut offset = 0usize;
    while offset < paired {
        let left_word = u32::from(left[offset]) | (u32::from(left[offset + 1]) << 16);
        let right_word = u32::from(right[offset]) | (u32::from(right[offset + 1]) << 16);
        if left_word != right_word {
            return offset + usize::from(left[offset] == right[offset]);
        }
        offset += 2;
    }
    offset + usize::from(offset < shared && left[offset] == right[offset])
}

pub(super) fn packed_common_utf16_suffix(left: &[u16], right: &[u16]) -> usize {
    let shared = left.len().min(right.len());
    let paired = shared & !1;
    let mut suffix = 0usize;
    while suffix < paired {
        let left_at = left.len() - suffix - 2;
        let right_at = right.len() - suffix - 2;
        let left_word = u32::from(left[left_at]) | (u32::from(left[left_at + 1]) << 16);
        let right_word = u32::from(right[right_at]) | (u32::from(right[right_at + 1]) << 16);
        if left_word != right_word {
            return suffix + usize::from(left[left_at + 1] == right[right_at + 1]);
        }
        suffix += 2;
    }
    suffix
        + usize::from(
            suffix < shared && left[left.len() - suffix - 1] == right[right.len() - suffix - 1],
        )
}

pub(super) fn for_each_changed_utf16_unit(
    accepted: &[u16],
    candidate: &[u16],
    mut changed: impl FnMut(usize) -> Result<(), EngineError>,
) -> Result<(), EngineError> {
    if accepted.len() != candidate.len() {
        return Err(EngineError::InvalidRequest);
    }
    let paired_len = accepted.len() & !1;
    let mut offset = 0usize;
    while offset < paired_len {
        let accepted_word = u32::from(accepted[offset]) | (u32::from(accepted[offset + 1]) << 16);
        let candidate_word =
            u32::from(candidate[offset]) | (u32::from(candidate[offset + 1]) << 16);
        let different_lanes = accepted_word ^ candidate_word;
        if different_lanes & 0xffff != 0 {
            changed(offset)?;
        }
        if different_lanes >> 16 != 0 {
            changed(offset + 1)?;
        }
        offset += 2;
    }
    if paired_len != accepted.len() && accepted[paired_len] != candidate[paired_len] {
        changed(paired_len)?;
    }
    Ok(())
}

pub(super) fn take_next_unit_identity(next_identity: &mut u32) -> Result<u32, EngineError> {
    let identity = *next_identity;
    if identity == 0 {
        return Err(EngineError::RevisionExhausted);
    }
    *next_identity = next_identity
        .checked_add(1)
        .ok_or(EngineError::RevisionExhausted)?;
    Ok(identity)
}

pub(super) fn apply_text_identity_mutation(
    identities: &mut Vec<u32>,
    next_identity: &mut u32,
    mutation: crate::engine::semantic_wire::TextMutation<'_>,
) -> Result<(), EngineError> {
    let start = usize::try_from(mutation.text_start).map_err(|_| EngineError::InvalidRequest)?;
    let delete_count =
        usize::try_from(mutation.delete_count).map_err(|_| EngineError::InvalidRequest)?;
    let insert_count = mutation.insert_utf16_le.len() / 2;
    apply_text_identity_edit(identities, next_identity, start, delete_count, insert_count)
}

pub(super) fn apply_text_identity_edit(
    identities: &mut Vec<u32>,
    next_identity: &mut u32,
    start: usize,
    delete_count: usize,
    insert_count: usize,
) -> Result<(), EngineError> {
    let delete_end = start
        .checked_add(delete_count)
        .ok_or(EngineError::InvalidRequest)?;
    let old_len = identities.len();
    let new_len = old_len
        .checked_sub(delete_count)
        .and_then(|length| length.checked_add(insert_count))
        .ok_or(EngineError::InvalidRequest)?;
    if delete_end > old_len {
        return Err(EngineError::InvalidRequest);
    }
    if new_len > old_len {
        identities
            .try_reserve_cold(new_len - old_len)
            .map_err(|_| EngineError::ResultTooLarge)?;
        identities.resize(new_len, 0);
    }
    identities.copy_within(delete_end..old_len, start + insert_count);
    if new_len < old_len {
        identities.truncate(new_len);
    }
    for identity in &mut identities[start..start + insert_count] {
        *identity = take_next_unit_identity(next_identity)?;
    }
    Ok(())
}
