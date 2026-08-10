//! Flat retained style storage and transactional mutation merge.

use alloc::vec::Vec;

use crate::{
    FeatureRecord,
    engine::{
        frame::{
            DECORATION_NONE, STYLE_FIELD_BASELINE_SHIFT, STYLE_FIELD_DECORATION,
            STYLE_FIELD_DIRECTION, STYLE_FIELD_FEATURES, STYLE_FIELD_FONT_SIZE,
            STYLE_FIELD_FONT_STACK, STYLE_FIELD_FOREGROUND, STYLE_FIELD_LANGUAGE,
            STYLE_FIELD_LETTER_SPACING, STYLE_FIELD_LINE_HEIGHT, STYLE_FIELD_MATERIAL,
            STYLE_FIELD_RASTER_PIXEL_RATIO, STYLE_FIELD_WORD_SPACING,
        },
        semantic_wire::{StyleMutation, StyleMutationBatch, StyleValue},
    },
    valid_utf16_boundary,
};

use super::EngineError;

const ROOT_REQUIRED_FIELDS: u32 =
    STYLE_FIELD_FONT_STACK | STYLE_FIELD_FONT_SIZE | STYLE_FIELD_RASTER_PIXEL_RATIO;
pub(crate) const DEFAULT_STYLE_CAPACITY: usize = 64;
const DEFAULT_LANGUAGE_CAPACITY: usize = 512;
const DEFAULT_FEATURE_CAPACITY: usize = 128;
const NO_STYLE_SOURCE: u32 = u32::MAX;

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

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ResolvedStyle {
    pub font_stack_handle: u32,
    pub material_id: u32,
    pub font_size: f32,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub word_spacing: f32,
    pub baseline_shift: f32,
    pub raster_pixel_ratio: f32,
    pub direction: u8,
    pub bidi_override: bool,
    pub foreground_rgba: u32,
    pub decoration_rgba: u32,
    pub decoration_flags: u32,
    pub decoration_style: u8,
    pub decoration_thickness: f32,
    pub decoration_offset: f32,
    language_source: u32,
    features_source: u32,
    pub has_line_height: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct StyleSegment {
    pub text_start: u32,
    pub text_end: u32,
    pub style: ResolvedStyle,
}

#[derive(Clone, Copy)]
pub(crate) struct ResolutionScope {
    end: u32,
    style: ResolvedStyle,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct StyleInvalidation {
    pub bidi: bool,
    pub shaping: bool,
    pub metrics: bool,
    pub positioning: bool,
}

#[derive(Default)]
pub(crate) struct ResolvedStyleArena {
    segments: Vec<StyleSegment>,
}

impl Default for ResolvedStyle {
    fn default() -> Self {
        Self {
            font_stack_handle: 0,
            material_id: 0,
            font_size: 16.0,
            line_height: 0.0,
            letter_spacing: 0.0,
            word_spacing: 0.0,
            baseline_shift: 0.0,
            raster_pixel_ratio: 1.0,
            direction: 0,
            bidi_override: false,
            foreground_rgba: u32::MAX,
            decoration_rgba: 0,
            decoration_flags: 0,
            decoration_style: DECORATION_NONE,
            decoration_thickness: 0.0,
            decoration_offset: 0.0,
            language_source: NO_STYLE_SOURCE,
            features_source: NO_STYLE_SOURCE,
            has_line_height: false,
        }
    }
}

impl ResolvedStyle {
    fn same_layout_scalars(self, other: Self) -> bool {
        self.font_stack_handle == other.font_stack_handle
            && self.font_size.to_bits() == other.font_size.to_bits()
            && self.line_height.to_bits() == other.line_height.to_bits()
            && self.has_line_height == other.has_line_height
            && self.letter_spacing.to_bits() == other.letter_spacing.to_bits()
            && self.word_spacing.to_bits() == other.word_spacing.to_bits()
            && self.baseline_shift.to_bits() == other.baseline_shift.to_bits()
            && self.direction == other.direction
            && self.bidi_override == other.bidi_override
    }

    pub(crate) fn same_layout_sources(self, other: Self) -> bool {
        self.same_layout_scalars(other)
            && self.language_source == other.language_source
            && self.features_source == other.features_source
    }
}

#[cfg(test)]
impl ResolvedStyle {
    pub(crate) fn test_typography(font_size: f32, letter_spacing: f32, word_spacing: f32) -> Self {
        Self {
            font_size,
            letter_spacing,
            word_spacing,
            ..Self::default()
        }
    }
}

impl ResolvedStyleArena {
    pub(crate) fn reserve_default(&mut self) -> Result<(), EngineError> {
        self.segments
            .try_reserve_exact(DEFAULT_STYLE_CAPACITY.saturating_mul(2))
            .map_err(|_| EngineError::ResultTooLarge)
    }

    pub(crate) fn clear(&mut self) {
        self.segments.clear();
    }

    pub(crate) fn segments(&self) -> &[StyleSegment] {
        &self.segments
    }

    pub(crate) fn invalidation_against(
        &self,
        previous_storage: &StyleArena,
        next: &Self,
        next_storage: &StyleArena,
    ) -> StyleInvalidation {
        if self.segments.len() != next.segments.len() {
            return StyleInvalidation {
                bidi: true,
                shaping: true,
                metrics: true,
                positioning: true,
            };
        }
        let mut invalidation = StyleInvalidation::default();
        for (previous, next) in self.segments.iter().zip(&next.segments) {
            if previous.text_start != next.text_start || previous.text_end != next.text_end {
                return StyleInvalidation {
                    bidi: true,
                    shaping: true,
                    metrics: true,
                    positioning: true,
                };
            }
            let old = previous.style;
            let new = next.style;
            invalidation.bidi |=
                old.direction != new.direction || old.bidi_override != new.bidi_override;
            invalidation.shaping |= invalidation.bidi
                || old.font_stack_handle != new.font_stack_handle
                || previous_storage.resolved_language(old) != next_storage.resolved_language(new)
                || previous_storage.resolved_features(old) != next_storage.resolved_features(new);
            invalidation.metrics |= invalidation.shaping
                || old.font_size.to_bits() != new.font_size.to_bits()
                || old.line_height.to_bits() != new.line_height.to_bits()
                || old.has_line_height != new.has_line_height
                || old.letter_spacing.to_bits() != new.letter_spacing.to_bits()
                || old.word_spacing.to_bits() != new.word_spacing.to_bits()
                || old.baseline_shift.to_bits() != new.baseline_shift.to_bits();
            invalidation.positioning |= invalidation.metrics
                || old.material_id != new.material_id
                || old.raster_pixel_ratio.to_bits() != new.raster_pixel_ratio.to_bits()
                || old.foreground_rgba != new.foreground_rgba
                || old.decoration_rgba != new.decoration_rgba
                || old.decoration_flags != new.decoration_flags
                || old.decoration_style != new.decoration_style
                || old.decoration_thickness.to_bits() != new.decoration_thickness.to_bits()
                || old.decoration_offset.to_bits() != new.decoration_offset.to_bits();
        }
        invalidation
    }
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
                StyleMutation::Remove { style_id, .. } => style_id,
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
                !style.root,
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

    pub(crate) fn resolve(
        &self,
        containment_order: &[usize],
        output: &mut ResolvedStyleArena,
        scope_scratch: &mut Vec<ResolutionScope>,
    ) -> Result<(), EngineError> {
        output.clear();
        scope_scratch.clear();
        output
            .segments
            .try_reserve(self.records.len().saturating_mul(2))
            .map_err(|_| EngineError::ResultTooLarge)?;
        scope_scratch
            .try_reserve(self.records.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        let root = containment_order
            .first()
            .and_then(|index| self.records.get(*index))
            .filter(|style| style.root)
            .ok_or(EngineError::InvalidRequest)?;
        if root.text_end == 0 {
            output.segments.push(StyleSegment {
                text_start: 0,
                text_end: 0,
                style: apply_style(ResolvedStyle::default(), *root, containment_order[0]),
            });
            return Ok(());
        }

        let mut current = 0;
        let mut opening = 0;
        while current < root.text_end {
            while scope_scratch
                .last()
                .is_some_and(|scope| scope.end <= current)
            {
                scope_scratch.pop();
            }
            while let Some(index) = containment_order.get(opening).copied() {
                let style = self.records[index];
                if style.text_start != current {
                    break;
                }
                let inherited = scope_scratch
                    .last()
                    .map_or_else(ResolvedStyle::default, |scope| scope.style);
                scope_scratch.push(ResolutionScope {
                    end: style.text_end,
                    style: apply_style(inherited, style, index),
                });
                opening += 1;
            }
            let scope = scope_scratch
                .last()
                .copied()
                .ok_or(EngineError::InvalidRequest)?;
            let next_open = containment_order
                .get(opening)
                .map_or(root.text_end, |index| self.records[*index].text_start);
            let next = scope.end.min(next_open);
            if next <= current {
                return Err(EngineError::InvalidRequest);
            }
            if output.segments.last().is_some_and(|previous| {
                previous.text_end == current && self.same_resolved(previous.style, scope.style)
            }) {
                output
                    .segments
                    .last_mut()
                    .ok_or(EngineError::InvalidRequest)?
                    .text_end = next;
            } else {
                output.segments.push(StyleSegment {
                    text_start: current,
                    text_end: next,
                    style: scope.style,
                });
            }
            current = next;
        }
        if opening != containment_order.len()
            || !scope_scratch.iter().all(|scope| scope.end == root.text_end)
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    pub(crate) fn resolved_language(&self, style: ResolvedStyle) -> Option<&[u8]> {
        let index = usize::try_from(style.language_source).ok()?;
        self.records.get(index).map(|source| self.language(*source))
    }

    pub(crate) fn resolved_features(&self, style: ResolvedStyle) -> &[FeatureRecord] {
        let Ok(index) = usize::try_from(style.features_source) else {
            return &[];
        };
        self.records
            .get(index)
            .map_or(&[], |source| self.features(*source))
    }

    pub(crate) fn same_layout_style(&self, left: ResolvedStyle, right: ResolvedStyle) -> bool {
        left.same_layout_scalars(right)
            && self.resolved_language(left) == self.resolved_language(right)
            && self.resolved_features(left) == self.resolved_features(right)
    }

    fn same_resolved(&self, left: ResolvedStyle, right: ResolvedStyle) -> bool {
        let same_scalars = ResolvedStyle {
            language_source: NO_STYLE_SOURCE,
            features_source: NO_STYLE_SOURCE,
            ..left
        } == ResolvedStyle {
            language_source: NO_STYLE_SOURCE,
            features_source: NO_STYLE_SOURCE,
            ..right
        };
        same_scalars
            && self.resolved_language(left) == self.resolved_language(right)
            && self.resolved_features(left) == self.resolved_features(right)
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

fn apply_style(mut resolved: ResolvedStyle, style: RetainedStyle, source: usize) -> ResolvedStyle {
    let fields = style.field_mask;
    if fields & STYLE_FIELD_FONT_STACK != 0 {
        resolved.font_stack_handle = style.font_stack_handle;
    }
    if fields & STYLE_FIELD_MATERIAL != 0 {
        resolved.material_id = style.material_id;
    }
    if fields & STYLE_FIELD_LANGUAGE != 0 {
        resolved.language_source = u32::try_from(source).unwrap_or(NO_STYLE_SOURCE);
    }
    if fields & STYLE_FIELD_FEATURES != 0 {
        resolved.features_source = u32::try_from(source).unwrap_or(NO_STYLE_SOURCE);
    }
    if fields & STYLE_FIELD_FONT_SIZE != 0 {
        resolved.font_size = style.font_size;
    }
    if fields & STYLE_FIELD_LINE_HEIGHT != 0 {
        resolved.line_height = style.line_height;
        resolved.has_line_height = true;
    }
    if fields & STYLE_FIELD_LETTER_SPACING != 0 {
        resolved.letter_spacing = style.letter_spacing;
    }
    if fields & STYLE_FIELD_WORD_SPACING != 0 {
        resolved.word_spacing = style.word_spacing;
    }
    if fields & STYLE_FIELD_BASELINE_SHIFT != 0 {
        resolved.baseline_shift = style.baseline_shift;
    }
    if fields & STYLE_FIELD_RASTER_PIXEL_RATIO != 0 {
        resolved.raster_pixel_ratio = style.raster_pixel_ratio;
    }
    if fields & STYLE_FIELD_DIRECTION != 0 {
        resolved.direction = style.direction;
        resolved.bidi_override = !style.root && style.direction != 0;
    }
    if fields & STYLE_FIELD_FOREGROUND != 0 {
        resolved.foreground_rgba = style.foreground_rgba;
    }
    if fields & STYLE_FIELD_DECORATION != 0 {
        resolved.decoration_rgba = style.decoration_rgba;
        resolved.decoration_flags = style.decoration_flags;
        resolved.decoration_style = style.decoration_style;
        resolved.decoration_thickness = style.decoration_thickness;
        resolved.decoration_offset = style.decoration_offset;
    }
    resolved
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::frame::{
        STYLE_FIELD_FEATURES, STYLE_FIELD_FOREGROUND, STYLE_FIELD_LANGUAGE,
        STYLE_FIELD_LETTER_SPACING, STYLE_FIELD_MATERIAL, STYLE_FIELD_WORD_SPACING,
    };
    use alloc::vec;

    #[test]
    fn resolves_nested_and_equal_range_styles_once_per_boundary() {
        let root_fields = ROOT_REQUIRED_FIELDS
            | STYLE_FIELD_LANGUAGE
            | STYLE_FIELD_FEATURES
            | STYLE_FIELD_FOREGROUND;
        let arena = StyleArena {
            records: vec![
                style(10, 0, 0, 8, root_fields, true),
                RetainedStyle {
                    font_size: 20.0,
                    foreground_rgba: 0xff00_00ff,
                    ..style(
                        20,
                        1,
                        2,
                        6,
                        STYLE_FIELD_FONT_SIZE | STYLE_FIELD_FOREGROUND,
                        false,
                    )
                },
                RetainedStyle {
                    letter_spacing: 1.5,
                    word_spacing: 2.0,
                    ..style(
                        30,
                        2,
                        3,
                        5,
                        STYLE_FIELD_LETTER_SPACING | STYLE_FIELD_WORD_SPACING,
                        false,
                    )
                },
                RetainedStyle {
                    material_id: 9,
                    ..style(40, 3, 3, 5, STYLE_FIELD_MATERIAL, false)
                },
            ],
            languages: b"en".to_vec(),
            features: vec![FeatureRecord {
                tag: u32::from_be_bytes(*b"kern"),
                value: 1,
                start: 0,
                end: 8,
            }],
        };
        let mut order = Vec::new();
        let mut nesting = Vec::new();
        arena
            .validate(&[0x61; 8], |handle| handle == 7, &mut order, &mut nesting)
            .unwrap();
        let mut resolved = ResolvedStyleArena::default();
        let mut scopes = Vec::new();
        arena.resolve(&order, &mut resolved, &mut scopes).unwrap();

        assert_eq!(
            resolved
                .segments()
                .iter()
                .map(|segment| (segment.text_start, segment.text_end))
                .collect::<Vec<_>>(),
            [(0, 2), (2, 3), (3, 5), (5, 6), (6, 8)],
        );
        let deepest = resolved.segments()[2].style;
        assert_eq!(deepest.font_stack_handle, 7);
        assert_eq!(deepest.font_size, 20.0);
        assert_eq!(deepest.letter_spacing, 1.5);
        assert_eq!(deepest.word_spacing, 2.0);
        assert_eq!(deepest.material_id, 9);
        assert_eq!(deepest.foreground_rgba, 0xff00_00ff);
        assert_eq!(arena.resolved_language(deepest), Some(&b"en"[..]));
        assert_eq!(arena.resolved_features(deepest), arena.features.as_slice());
        assert!(!deepest.has_line_height);
        assert_eq!(resolved.segments()[3].style.material_id, 0);
    }

    #[test]
    fn invalidation_stops_at_the_first_affected_retained_stage() {
        let storage = StyleArena::default();
        let previous = resolved(ResolvedStyle::default());

        assert_eq!(
            previous.invalidation_against(&storage, &previous, &storage),
            StyleInvalidation::default(),
        );

        let mut font_size = ResolvedStyle::default();
        font_size.font_size = 24.0;
        assert_eq!(
            previous.invalidation_against(&storage, &resolved(font_size), &storage),
            StyleInvalidation {
                bidi: false,
                shaping: false,
                metrics: true,
                positioning: true,
            },
        );

        let mut foreground = ResolvedStyle::default();
        foreground.foreground_rgba = 0xff00_00ff;
        assert_eq!(
            previous.invalidation_against(&storage, &resolved(foreground), &storage),
            StyleInvalidation {
                bidi: false,
                shaping: false,
                metrics: false,
                positioning: true,
            },
        );

        let mut direction = ResolvedStyle::default();
        direction.direction = 2;
        assert_eq!(
            previous.invalidation_against(&storage, &resolved(direction), &storage),
            StyleInvalidation {
                bidi: true,
                shaping: true,
                metrics: true,
                positioning: true,
            },
        );
    }

    fn resolved(style: ResolvedStyle) -> ResolvedStyleArena {
        ResolvedStyleArena {
            segments: vec![StyleSegment {
                text_start: 0,
                text_end: 8,
                style,
            }],
        }
    }

    fn style(
        style_id: u32,
        cascade_order: u32,
        text_start: u32,
        text_end: u32,
        field_mask: u32,
        root: bool,
    ) -> RetainedStyle {
        RetainedStyle {
            style_id,
            cascade_order,
            field_mask,
            text_start,
            text_end,
            font_stack_handle: if field_mask & STYLE_FIELD_FONT_STACK != 0 {
                7
            } else {
                0
            },
            material_id: 0,
            language_start: 0,
            language_length: if field_mask & STYLE_FIELD_LANGUAGE != 0 {
                2
            } else {
                0
            },
            feature_start: 0,
            feature_count: if field_mask & STYLE_FIELD_FEATURES != 0 {
                1
            } else {
                0
            },
            font_size: 16.0,
            line_height: 1.2,
            letter_spacing: 0.0,
            word_spacing: 0.0,
            baseline_shift: 0.0,
            raster_pixel_ratio: 1.0,
            direction: 0,
            foreground_rgba: u32::MAX,
            decoration_rgba: 0,
            decoration_flags: 0,
            decoration_style: DECORATION_NONE,
            decoration_thickness: 0.0,
            decoration_offset: 0.0,
            root,
        }
    }
}
