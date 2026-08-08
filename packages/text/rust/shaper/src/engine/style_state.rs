//! Flat retained style storage and transactional mutation merge.

use alloc::vec::Vec;

use crate::{
    FeatureRecord,
    engine::{
        frame::{
            STYLE_FIELD_FONT_SIZE, STYLE_FIELD_FONT_STACK, STYLE_FIELD_LINE_HEIGHT,
            STYLE_FIELD_RASTER_PIXEL_RATIO,
        },
        semantic_wire::{StyleMutation, StyleMutationBatch, StyleValue},
    },
    valid_utf16_boundary,
};

use super::EngineError;

const ROOT_REQUIRED_FIELDS: u32 = STYLE_FIELD_FONT_STACK
    | STYLE_FIELD_FONT_SIZE
    | STYLE_FIELD_LINE_HEIGHT
    | STYLE_FIELD_RASTER_PIXEL_RATIO;
pub(crate) const DEFAULT_STYLE_CAPACITY: usize = 64;
const DEFAULT_LANGUAGE_CAPACITY: usize = 512;
const DEFAULT_FEATURE_CAPACITY: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RetainedStyle {
    pub style_id: u32,
    pub cascade_order: u32,
    pub field_mask: u32,
    pub text_start: u32,
    pub text_end: u32,
    pub font_stack_handle: u32,
    pub material_id: u32,
    pub language_start: u32,
    pub language_length: u16,
    pub feature_start: u32,
    pub feature_count: u16,
    pub font_size: f32,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub word_spacing: f32,
    pub baseline_shift: f32,
    pub raster_pixel_ratio: f32,
    pub direction: u8,
    pub foreground_rgba: u32,
    pub decoration_rgba: u32,
    pub decoration_flags: u32,
    pub decoration_style: u8,
    pub decoration_thickness: f32,
    pub decoration_offset: f32,
    pub root: bool,
}

#[derive(Default)]
pub(crate) struct StyleArena {
    records: Vec<RetainedStyle>,
    languages: Vec<u8>,
    features: Vec<FeatureRecord>,
}

#[derive(Clone, Copy)]
pub(crate) struct MutationKey {
    style_id: u32,
    request_index: usize,
}

impl StyleArena {
    pub(crate) fn len(&self) -> usize {
        self.records.len()
    }

    pub(crate) fn reserve_default(&mut self) -> Result<(), EngineError> {
        self.records
            .try_reserve_exact(DEFAULT_STYLE_CAPACITY)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.languages
            .try_reserve_exact(DEFAULT_LANGUAGE_CAPACITY)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.features
            .try_reserve_exact(DEFAULT_FEATURE_CAPACITY)
            .map_err(|_| EngineError::ResultTooLarge)
    }

    pub(crate) fn clear(&mut self) {
        self.records.clear();
        self.languages.clear();
        self.features.clear();
    }

    pub(crate) fn prepare_from(
        &mut self,
        committed: &Self,
        mutations: StyleMutationBatch<'_>,
        scratch: &mut Vec<MutationKey>,
    ) -> Result<(), EngineError> {
        self.clear();
        scratch.clear();
        scratch
            .try_reserve(mutations.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for request_index in 0..mutations.len() {
            let mutation = mutations
                .get(request_index)
                .ok_or(EngineError::InvalidRequest)?;
            let style_id = match mutation {
                StyleMutation::Remove { style_id } => style_id,
                StyleMutation::Upsert(value) => value.style_id,
            };
            scratch.push(MutationKey {
                style_id,
                request_index,
            });
        }
        scratch.sort_unstable_by_key(|key| (key.style_id, key.request_index));
        collapse_to_last_mutation(scratch);

        self.records
            .try_reserve(committed.records.len().saturating_add(scratch.len()))
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.languages
            .try_reserve(
                committed
                    .languages
                    .len()
                    .saturating_add(total_language_bytes(mutations)?),
            )
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.features
            .try_reserve(
                committed
                    .features
                    .len()
                    .saturating_add(total_feature_count(mutations)?),
            )
            .map_err(|_| EngineError::ResultTooLarge)?;

        let mut committed_index = 0;
        let mut mutation_index = 0;
        while committed_index < committed.records.len() || mutation_index < scratch.len() {
            let committed_id = committed
                .records
                .get(committed_index)
                .map_or(u32::MAX, |style| style.style_id);
            let mutation_id = scratch
                .get(mutation_index)
                .map_or(u32::MAX, |key| key.style_id);
            if committed_id < mutation_id {
                self.push_retained(committed, committed_index)?;
                committed_index += 1;
            } else if mutation_id < committed_id {
                self.push_mutation(mutations, scratch[mutation_index].request_index)?;
                mutation_index += 1;
            } else {
                self.push_mutation(mutations, scratch[mutation_index].request_index)?;
                committed_index += 1;
                mutation_index += 1;
            }
        }
        Ok(())
    }

    pub(crate) fn validate(
        &self,
        text: &[u16],
        mut font_stack_exists: impl FnMut(u32) -> bool,
        order_scratch: &mut Vec<usize>,
        nesting_scratch: &mut Vec<u32>,
    ) -> Result<(), EngineError> {
        if self.records.is_empty() {
            return Ok(());
        }
        let text_length = u32::try_from(text.len()).map_err(|_| EngineError::InvalidRequest)?;
        let mut root_count = 0;
        for style in &self.records {
            if style.text_end > text_length
                || !valid_utf16_boundary(text, style.text_start)
                || !valid_utf16_boundary(text, style.text_end)
                || style.field_mask & STYLE_FIELD_FONT_STACK != 0
                    && !font_stack_exists(style.font_stack_handle)
            {
                return Err(EngineError::InvalidRequest);
            }
            if style.root {
                root_count += 1;
                if style.text_start != 0
                    || style.text_end != text_length
                    || style.field_mask & ROOT_REQUIRED_FIELDS != ROOT_REQUIRED_FIELDS
                {
                    return Err(EngineError::InvalidRequest);
                }
            }
            for feature in self.features(*style) {
                if !valid_utf16_boundary(text, feature.start)
                    || !valid_utf16_boundary(text, feature.end)
                {
                    return Err(EngineError::InvalidRequest);
                }
            }
        }
        if root_count != 1 {
            return Err(EngineError::InvalidRequest);
        }

        order_scratch.clear();
        order_scratch
            .try_reserve(self.records.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        order_scratch.extend(0..self.records.len());
        order_scratch.sort_unstable_by_key(|index| {
            let style = self.records[*index];
            (
                style.text_start,
                core::cmp::Reverse(style.text_end),
                style.cascade_order,
            )
        });
        if order_scratch.windows(2).any(|pair| {
            let left = self.records[pair[0]];
            let right = self.records[pair[1]];
            left.text_start == right.text_start
                && left.text_end == right.text_end
                && left.cascade_order == right.cascade_order
        }) {
            return Err(EngineError::InvalidRequest);
        }
        nesting_scratch.clear();
        nesting_scratch
            .try_reserve(self.records.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for index in order_scratch.iter().copied() {
            let style = self.records[index];
            while nesting_scratch
                .last()
                .is_some_and(|end| style.text_start >= *end)
            {
                nesting_scratch.pop();
            }
            if nesting_scratch
                .last()
                .is_some_and(|end| style.text_end > *end)
            {
                return Err(EngineError::InvalidRequest);
            }
            nesting_scratch.push(style.text_end);
        }
        Ok(())
    }

    fn push_retained(&mut self, source: &Self, index: usize) -> Result<(), EngineError> {
        let mut style = source.records[index];
        let language = source.language(style);
        let features = source.features(style);
        set_payload_ranges(self, &mut style, language, features)?;
        self.records.push(style);
        Ok(())
    }

    fn push_mutation(
        &mut self,
        mutations: StyleMutationBatch<'_>,
        request_index: usize,
    ) -> Result<(), EngineError> {
        let mutation = mutations
            .get(request_index)
            .ok_or(EngineError::InvalidRequest)?;
        let StyleMutation::Upsert(value) = mutation else {
            return Ok(());
        };
        let mut style = retained(value);
        style.language_start =
            u32::try_from(self.languages.len()).map_err(|_| EngineError::ResultTooLarge)?;
        style.language_length =
            u16::try_from(value.language.len()).map_err(|_| EngineError::ResultTooLarge)?;
        self.languages.extend_from_slice(value.language);
        style.feature_start =
            u32::try_from(self.features.len()).map_err(|_| EngineError::ResultTooLarge)?;
        style.feature_count =
            u16::try_from(value.features.len() / 16).map_err(|_| EngineError::ResultTooLarge)?;
        for index in 0..value.features.len() / 16 {
            self.features.push(
                StyleMutationBatch::feature(value, index).ok_or(EngineError::InvalidRequest)?,
            );
        }
        self.records.push(style);
        Ok(())
    }

    fn language(&self, style: RetainedStyle) -> &[u8] {
        let start = style.language_start as usize;
        &self.languages[start..start + usize::from(style.language_length)]
    }

    fn features(&self, style: RetainedStyle) -> &[FeatureRecord] {
        let start = style.feature_start as usize;
        &self.features[start..start + usize::from(style.feature_count)]
    }
}

fn collapse_to_last_mutation(scratch: &mut Vec<MutationKey>) {
    let mut read = 0;
    let mut write = 0;
    while read < scratch.len() {
        let mut next = read + 1;
        while next < scratch.len() && scratch[next].style_id == scratch[read].style_id {
            next += 1;
        }
        scratch[write] = scratch[next - 1];
        write += 1;
        read = next;
    }
    scratch.truncate(write);
}

fn total_language_bytes(mutations: StyleMutationBatch<'_>) -> Result<usize, EngineError> {
    let mut total = 0usize;
    for index in 0..mutations.len() {
        if let StyleMutation::Upsert(value) =
            mutations.get(index).ok_or(EngineError::InvalidRequest)?
        {
            total = total
                .checked_add(value.language.len())
                .ok_or(EngineError::ResultTooLarge)?;
        }
    }
    Ok(total)
}

fn total_feature_count(mutations: StyleMutationBatch<'_>) -> Result<usize, EngineError> {
    let mut total = 0usize;
    for index in 0..mutations.len() {
        if let StyleMutation::Upsert(value) =
            mutations.get(index).ok_or(EngineError::InvalidRequest)?
        {
            total = total
                .checked_add(value.features.len() / 16)
                .ok_or(EngineError::ResultTooLarge)?;
        }
    }
    Ok(total)
}

fn set_payload_ranges(
    arena: &mut StyleArena,
    style: &mut RetainedStyle,
    language: &[u8],
    features: &[FeatureRecord],
) -> Result<(), EngineError> {
    style.language_start =
        u32::try_from(arena.languages.len()).map_err(|_| EngineError::ResultTooLarge)?;
    style.language_length =
        u16::try_from(language.len()).map_err(|_| EngineError::ResultTooLarge)?;
    arena.languages.extend_from_slice(language);
    style.feature_start =
        u32::try_from(arena.features.len()).map_err(|_| EngineError::ResultTooLarge)?;
    style.feature_count = u16::try_from(features.len()).map_err(|_| EngineError::ResultTooLarge)?;
    arena.features.extend_from_slice(features);
    Ok(())
}

fn retained(value: StyleValue<'_>) -> RetainedStyle {
    RetainedStyle {
        style_id: value.style_id,
        cascade_order: value.cascade_order,
        field_mask: value.field_mask,
        text_start: value.text_start,
        text_end: value.text_end,
        font_stack_handle: value.font_stack_handle,
        material_id: value.material_id,
        language_start: 0,
        language_length: 0,
        feature_start: 0,
        feature_count: 0,
        font_size: value.font_size,
        line_height: value.line_height,
        letter_spacing: value.letter_spacing,
        word_spacing: value.word_spacing,
        baseline_shift: value.baseline_shift,
        raster_pixel_ratio: value.raster_pixel_ratio,
        direction: value.direction,
        foreground_rgba: value.foreground_rgba,
        decoration_rgba: value.decoration_rgba,
        decoration_flags: value.decoration_flags,
        decoration_style: value.decoration_style,
        decoration_thickness: value.decoration_thickness,
        decoration_offset: value.decoration_offset,
        root: value.root,
    }
}
