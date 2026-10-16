//! Flat retained style storage and transactional mutation merge.

use alloc::vec::Vec;
#[cfg(test)]
use core::cell::Cell;

use crate::{
    FeatureRecord,
    engine::{
        frame::{
            DECORATION_NONE, STYLE_FIELD_BASELINE_SHIFT, STYLE_FIELD_DECORATION,
            STYLE_FIELD_DIRECTION, STYLE_FIELD_FEATURES, STYLE_FIELD_FONT_SIZE,
            STYLE_FIELD_FONT_STACK, STYLE_FIELD_FOREGROUND, STYLE_FIELD_LANGUAGE,
            STYLE_FIELD_LETTER_SPACING, STYLE_FIELD_LINE_HEIGHT, STYLE_FIELD_MATERIAL,
            STYLE_FIELD_OPACITY, STYLE_FIELD_OUTLINE, STYLE_FIELD_RASTER_PIXEL_RATIO,
            STYLE_FIELD_SHADOW, STYLE_FIELD_WORD_SPACING,
        },
        semantic_wire::{StyleMutation, StyleMutationBatch, StyleValue},
    },
    valid_utf16_boundary,
};

use super::{EngineError, FrameFault, sort};

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
    pub authored_text_start: u32,
    pub authored_text_end: u32,
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
    pub opacity: f32,
    pub outline_rgba: u32,
    pub outline_width: f32,
    pub shadow_rgba: u32,
    pub shadow_offset_x: f32,
    pub shadow_offset_y: f32,
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
    #[cfg(test)]
    root_validation_steps: Cell<usize>,
}

#[derive(Clone, Copy)]
pub(crate) struct MutationKey {
    style_id: u32,
    request_index: usize,
}

#[derive(Clone, Copy)]
pub(crate) struct StyleTopologyRecord {
    style_id: u32,
    text_start: u32,
    text_end: u32,
    cascade_order: u32,
    root: bool,
}

pub(crate) struct MutationTopologyScratch<'a> {
    pub topology: &'a mut Vec<StyleTopologyRecord>,
    pub mutations: &'a mut Vec<MutationKey>,
    pub sort_pairs: &'a mut Vec<(u64, u32)>,
    pub order: &'a mut Vec<usize>,
    pub nesting: &'a mut Vec<u32>,
    pub sort_pairs_pass: &'a mut Vec<(u64, u32)>,
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
    pub opacity: f32,
    pub outline_rgba: u32,
    pub outline_width: f32,
    pub shadow_rgba: u32,
    pub shadow_offset_x: f32,
    pub shadow_offset_y: f32,
    pub decoration_rgba: u32,
    pub decoration_flags: u32,
    pub decoration_style: u8,
    pub decoration_thickness: f32,
    pub decoration_offset: f32,
    /// Resolved font size of the span that declared the decoration group: the CSS
    /// decorating box. Descendants inherit it unchanged, so a nested size change keeps
    /// the declared line geometry continuous. Zero falls back to the run's font size.
    pub decoration_font_size: f32,
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
    pub cluster_mapping: bool,
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
            opacity: 1.0,
            outline_rgba: 0,
            outline_width: 0.0,
            shadow_rgba: 0,
            shadow_offset_x: 0.0,
            shadow_offset_y: 0.0,
            decoration_rgba: 0,
            decoration_flags: 0,
            decoration_style: DECORATION_NONE,
            decoration_thickness: 0.0,
            decoration_offset: 0.0,
            decoration_font_size: 0.0,
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
        if self.segments.first().map(|segment| segment.text_start)
            != next.segments.first().map(|segment| segment.text_start)
            || self.segments.last().map(|segment| segment.text_end)
                != next.segments.last().map(|segment| segment.text_end)
        {
            return StyleInvalidation {
                bidi: true,
                shaping: true,
                metrics: true,
                positioning: true,
                cluster_mapping: true,
            };
        }
        let mut invalidation = StyleInvalidation::default();
        let (mut old_index, mut new_index) = (0, 0);
        // Resolved segments cover one continuous text range. Compare effective values
        // over their shared refinement; paint boundaries are not shaping boundaries.
        while let (Some(previous), Some(next)) =
            (self.segments.get(old_index), next.segments.get(new_index))
        {
            invalidation.cluster_mapping |=
                previous.text_start != next.text_start || previous.text_end != next.text_end;
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
                || invalidation.cluster_mapping
                || old.material_id != new.material_id
                || old.raster_pixel_ratio.to_bits() != new.raster_pixel_ratio.to_bits()
                || old.foreground_rgba != new.foreground_rgba
                || old.opacity.to_bits() != new.opacity.to_bits()
                || old.outline_rgba != new.outline_rgba
                || old.outline_width.to_bits() != new.outline_width.to_bits()
                || old.shadow_rgba != new.shadow_rgba
                || old.shadow_offset_x.to_bits() != new.shadow_offset_x.to_bits()
                || old.shadow_offset_y.to_bits() != new.shadow_offset_y.to_bits()
                || old.decoration_rgba != new.decoration_rgba
                || old.decoration_flags != new.decoration_flags
                || old.decoration_style != new.decoration_style
                || old.decoration_thickness.to_bits() != new.decoration_thickness.to_bits()
                || old.decoration_offset.to_bits() != new.decoration_offset.to_bits();
            if previous.text_end <= next.text_end {
                old_index += 1;
            }
            if next.text_end <= previous.text_end {
                new_index += 1;
            }
        }
        invalidation
    }
}

impl StyleArena {
    pub(crate) fn len(&self) -> usize {
        self.records.len()
    }

    pub(crate) fn validate_root_mutations(
        &self,
        mutations: StyleMutationBatch<'_>,
        scratch: &mut Vec<MutationKey>,
        sort_pairs: &mut Vec<(u64, u32)>,
    ) -> Result<(), EngineError> {
        if mutations.len() == 0 {
            scratch.clear();
            sort_pairs.clear();
            return Ok(());
        }

        // `records` and the collapsed mutation keys are both sorted by style ID. Merge them
        // instead of searching the full mutation batch once for every retained style.
        let result = (|| {
            prepare_mutation_order(mutations, scratch, sort_pairs)?;

            let mut root_count = 0usize;
            let mut record_index = 0;
            let mut mutation_index = 0;
            #[cfg(test)]
            let mut steps = 0;
            while record_index < self.records.len() || mutation_index < scratch.len() {
                #[cfg(test)]
                {
                    steps += 1;
                }
                match (self.records.get(record_index), scratch.get(mutation_index)) {
                    (Some(style), Some(key)) if style.style_id < key.style_id => {
                        root_count += usize::from(style.root);
                        record_index += 1;
                    }
                    (Some(style), Some(key)) if key.style_id < style.style_id => {
                        root_count += usize::from(mutation_root(mutations, *key)?);
                        mutation_index += 1;
                    }
                    (Some(_), Some(key)) => {
                        root_count += usize::from(mutation_root(mutations, *key)?);
                        record_index += 1;
                        mutation_index += 1;
                    }
                    (Some(style), None) => {
                        root_count += usize::from(style.root);
                        record_index += 1;
                    }
                    (None, Some(key)) => {
                        root_count += usize::from(mutation_root(mutations, *key)?);
                        mutation_index += 1;
                    }
                    (None, None) => break,
                }
            }
            #[cfg(test)]
            self.root_validation_steps.set(steps);

            match root_count {
                0 => Err(EngineError::InvalidRequest),
                1 => Ok(()),
                _ => Err(EngineError::StyleRootInvalid(FrameFault::default())),
            }
        })();
        scratch.clear();
        sort_pairs.clear();
        result
    }

    pub(crate) fn validate_mutations_for_text(
        &self,
        mutations: StyleMutationBatch<'_>,
        text_length: u32,
        mut is_utf16_boundary: impl FnMut(u32) -> bool,
        mut font_stack_exists: impl FnMut(u32) -> bool,
        scratch: &mut Vec<MutationKey>,
        sort_pairs: &mut Vec<(u64, u32)>,
    ) -> Result<(), EngineError> {
        self.validate_root_mutations(mutations, scratch, sort_pairs)?;
        for index in 0..mutations.len() {
            if let StyleMutation::Upsert(value) =
                mutations.get(index).ok_or(EngineError::InvalidRequest)?
            {
                validate_style_value(
                    value,
                    text_length,
                    &mut is_utf16_boundary,
                    &mut font_stack_exists,
                )?;
            }
        }
        Ok(())
    }

    pub(crate) fn validate_mutation_topology(
        committed: &Self,
        mutations: StyleMutationBatch<'_>,
        grapheme_boundaries: &[u32],
        scratch: &mut MutationTopologyScratch<'_>,
    ) -> Result<(), EngineError> {
        let MutationTopologyScratch {
            topology: topology_scratch,
            mutations: mutation_scratch,
            sort_pairs,
            order: order_scratch,
            nesting: nesting_scratch,
            sort_pairs_pass,
        } = scratch;
        prepare_mutation_order(mutations, mutation_scratch, sort_pairs)?;
        let capacity = committed
            .records
            .len()
            .checked_add(mutation_scratch.len())
            .ok_or(EngineError::ResultTooLarge)?;
        topology_scratch.clear();
        topology_scratch
            .try_reserve(capacity)
            .map_err(|_| EngineError::ResultTooLarge)?;

        let mut committed_index = 0;
        let mut mutation_index = 0;
        while committed_index < committed.records.len() || mutation_index < mutation_scratch.len() {
            let committed_id = committed
                .records
                .get(committed_index)
                .map_or(u32::MAX, |style| style.style_id);
            let mutation = mutation_scratch.get(mutation_index).copied();
            let mutation_id = mutation.map_or(u32::MAX, |key| key.style_id);
            if committed_id < mutation_id {
                topology_scratch.push(topology_record(
                    committed.records[committed_index],
                    grapheme_boundaries,
                ));
                committed_index += 1;
                continue;
            }
            if let Some(key) = mutation
                && mutation_id <= committed_id
            {
                if let StyleMutation::Upsert(value) = mutations
                    .get(key.request_index)
                    .ok_or(EngineError::InvalidRequest)?
                {
                    topology_scratch.push(topology_value(value, grapheme_boundaries));
                }
                mutation_index += 1;
                if mutation_id == committed_id {
                    committed_index += 1;
                }
                continue;
            }
            if let Some(style) = committed.records.get(committed_index).copied() {
                topology_scratch.push(topology_record(style, grapheme_boundaries));
                committed_index += 1;
            }
        }

        validate_topology_records(
            topology_scratch,
            order_scratch,
            nesting_scratch,
            sort_pairs,
            sort_pairs_pass,
        )
    }

    /// Validates retained styles that survive this batch. Incoming upserts are validated by
    /// `validate_mutations_for_text`; a mutation of an existing identity replaces or removes its
    /// committed value in the resulting style set.
    pub(crate) fn validate_retained_ranges_for_text(
        &self,
        mutations: StyleMutationBatch<'_>,
        text_length: u32,
        mut is_utf16_boundary: impl FnMut(u32) -> bool,
        scratch: &mut Vec<MutationKey>,
        sort_pairs: &mut Vec<(u64, u32)>,
    ) -> Result<(), EngineError> {
        prepare_mutation_order(mutations, scratch, sort_pairs)?;
        let result = (|| {
            for style in &self.records {
                if scratch
                    .binary_search_by_key(&style.style_id, |key| key.style_id)
                    .is_ok()
                {
                    continue;
                }
                validate_retained_style(
                    *style,
                    self.features(*style),
                    text_length,
                    &mut is_utf16_boundary,
                    &mut |_| true,
                )?;
            }
            Ok(())
        })();
        scratch.clear();
        sort_pairs.clear();
        result
    }

    pub(crate) fn references_font_stack(&self, handle: u32) -> bool {
        self.records.iter().any(|style| {
            style.field_mask & STYLE_FIELD_FONT_STACK != 0 && style.font_stack_handle == handle
        })
    }

    pub(crate) fn needs_range_realign(&self, grapheme_boundaries: &[u32]) -> bool {
        self.records.iter().any(|style| {
            !style.root
                && normalize_style_range(
                    style.authored_text_start,
                    style.authored_text_end,
                    grapheme_boundaries,
                ) != (style.text_start, style.text_end)
        })
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
        grapheme_boundaries: &[u32],
        scratch: &mut Vec<MutationKey>,
        sort_pairs: &mut Vec<(u64, u32)>,
    ) -> Result<(), EngineError> {
        self.clear();
        prepare_mutation_order(mutations, scratch, sort_pairs)?;

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
                self.push_retained(committed, committed_index, grapheme_boundaries)?;
                committed_index += 1;
            } else if mutation_id < committed_id {
                self.push_mutation(
                    mutations,
                    scratch[mutation_index].request_index,
                    grapheme_boundaries,
                )?;
                mutation_index += 1;
            } else {
                self.push_mutation(
                    mutations,
                    scratch[mutation_index].request_index,
                    grapheme_boundaries,
                )?;
                committed_index += 1;
                mutation_index += 1;
            }
        }
        Ok(())
    }

    /// Rechecks caller-dependent text and font validity without rediscovering unchanged nesting.
    pub(crate) fn validate_text(
        &self,
        text: &[u16],
        mut font_stack_exists: impl FnMut(u32) -> bool,
    ) -> Result<(), EngineError> {
        if self.records.is_empty() {
            return Ok(());
        }
        let text_length = u32::try_from(text.len()).map_err(|_| EngineError::InvalidRequest)?;
        let mut root_count = 0;
        for style in &self.records {
            if style.root {
                root_count += 1;
            }
            validate_retained_style(
                *style,
                self.features(*style),
                text_length,
                &mut |offset| valid_utf16_boundary(text, offset),
                &mut font_stack_exists,
            )?;
        }
        if root_count != 1 {
            return Err(EngineError::StyleRootInvalid(FrameFault::default()));
        }
        Ok(())
    }

    pub(crate) fn validate(
        &self,
        text: &[u16],
        font_stack_exists: impl FnMut(u32) -> bool,
        order_scratch: &mut Vec<usize>,
        nesting_scratch: &mut Vec<u32>,
        sort_pairs: &mut Vec<(u64, u32)>,
        sort_pairs_pass: &mut Vec<(u64, u32)>,
    ) -> Result<(), EngineError> {
        self.validate_text(text, font_stack_exists)?;
        if self.records.is_empty() {
            return Ok(());
        }

        validate_style_topology(
            self.records.len(),
            |index| self.records.get(index).copied().map(topology_current),
            order_scratch,
            nesting_scratch,
            sort_pairs,
            sort_pairs_pass,
        )
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

    fn push_retained(
        &mut self,
        source: &Self,
        index: usize,
        grapheme_boundaries: &[u32],
    ) -> Result<(), EngineError> {
        let mut style = source.records[index];
        if !style.root {
            (style.text_start, style.text_end) = normalize_style_range(
                style.authored_text_start,
                style.authored_text_end,
                grapheme_boundaries,
            );
        }
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
        grapheme_boundaries: &[u32],
    ) -> Result<(), EngineError> {
        let mutation = mutations
            .get(request_index)
            .ok_or(EngineError::InvalidRequest)?;
        let StyleMutation::Upsert(value) = mutation else {
            return Ok(());
        };
        let mut style = retained(value);
        if !value.root {
            (style.text_start, style.text_end) =
                normalize_style_range(value.text_start, value.text_end, grapheme_boundaries);
        }
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

fn validate_style_value(
    value: crate::engine::semantic_wire::StyleValue<'_>,
    text_length: u32,
    is_utf16_boundary: &mut impl FnMut(u32) -> bool,
    font_stack_exists: &mut impl FnMut(u32) -> bool,
) -> Result<(), EngineError> {
    validate_style_ranges(
        value.style_id,
        value.text_start,
        value.text_end,
        value.text_start,
        value.text_end,
        value.root,
        value.field_mask,
        value.font_stack_handle,
        text_length,
        is_utf16_boundary,
        font_stack_exists,
    )?;
    for index in 0..(value.features.len() / 16) {
        let feature =
            StyleMutationBatch::feature(value, index).ok_or(EngineError::InvalidRequest)?;
        if !is_utf16_boundary(feature.start) || !is_utf16_boundary(feature.end) {
            return Err(EngineError::StyleRangeInvalid(FrameFault::style(
                value.style_id,
            )));
        }
    }
    Ok(())
}

fn validate_retained_style(
    style: RetainedStyle,
    features: &[FeatureRecord],
    text_length: u32,
    is_utf16_boundary: &mut impl FnMut(u32) -> bool,
    font_stack_exists: &mut impl FnMut(u32) -> bool,
) -> Result<(), EngineError> {
    validate_style_ranges(
        style.style_id,
        style.authored_text_start,
        style.authored_text_end,
        style.text_start,
        style.text_end,
        style.root,
        style.field_mask,
        style.font_stack_handle,
        text_length,
        is_utf16_boundary,
        font_stack_exists,
    )?;
    for feature in features {
        if !is_utf16_boundary(feature.start) || !is_utf16_boundary(feature.end) {
            return Err(EngineError::StyleRangeInvalid(FrameFault::style(
                style.style_id,
            )));
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_style_ranges(
    style_id: u32,
    authored_start: u32,
    authored_end: u32,
    text_start: u32,
    text_end: u32,
    root: bool,
    field_mask: u32,
    font_stack_handle: u32,
    text_length: u32,
    is_utf16_boundary: &mut impl FnMut(u32) -> bool,
    font_stack_exists: &mut impl FnMut(u32) -> bool,
) -> Result<(), EngineError> {
    let fault = FrameFault::style(style_id);
    if authored_start > authored_end
        || authored_end > text_length
        || !is_utf16_boundary(authored_start)
        || !is_utf16_boundary(authored_end)
        || text_start > text_end
        || text_end > text_length
        || !is_utf16_boundary(text_start)
        || !is_utf16_boundary(text_end)
    {
        return Err(EngineError::StyleRangeInvalid(fault));
    }
    if field_mask & STYLE_FIELD_FONT_STACK != 0 && !font_stack_exists(font_stack_handle) {
        return Err(EngineError::StyleFontStackMissing(fault));
    }
    if root
        && (text_start != 0
            || text_end != text_length
            || field_mask & ROOT_REQUIRED_FIELDS != ROOT_REQUIRED_FIELDS)
    {
        return Err(EngineError::StyleRootInvalid(fault));
    }
    Ok(())
}

fn cluster_end_at_or_after(boundaries: &[u32], offset: u32) -> u32 {
    let Some(&last) = boundaries.last() else {
        return offset;
    };
    if offset == 0 || offset >= last {
        return offset;
    }
    boundaries
        .get(boundaries.partition_point(|boundary| *boundary < offset))
        .copied()
        .unwrap_or(offset)
}

fn normalize_style_range(start: u32, end: u32, boundaries: &[u32]) -> (u32, u32) {
    let aligned_start = cluster_end_at_or_after(boundaries, start);
    let aligned_end = cluster_end_at_or_after(boundaries, end);
    let normalized_end = if start <= end {
        aligned_end.max(aligned_start)
    } else {
        aligned_end
    };
    (aligned_start, normalized_end)
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
    if fields & STYLE_FIELD_OPACITY != 0 {
        resolved.opacity = style.opacity;
    }
    if fields & STYLE_FIELD_OUTLINE != 0 {
        resolved.outline_rgba = style.outline_rgba;
        resolved.outline_width = style.outline_width;
    }
    if fields & STYLE_FIELD_SHADOW != 0 {
        resolved.shadow_rgba = style.shadow_rgba;
        resolved.shadow_offset_x = style.shadow_offset_x;
        resolved.shadow_offset_y = style.shadow_offset_y;
    }
    if fields & STYLE_FIELD_DECORATION != 0 {
        resolved.decoration_rgba = style.decoration_rgba;
        resolved.decoration_flags = style.decoration_flags;
        resolved.decoration_style = style.decoration_style;
        resolved.decoration_thickness = style.decoration_thickness;
        resolved.decoration_offset = style.decoration_offset;
        resolved.decoration_font_size = resolved.font_size;
    }
    resolved
}

fn topology_record(style: RetainedStyle, grapheme_boundaries: &[u32]) -> StyleTopologyRecord {
    let (text_start, text_end) = if style.root {
        (style.text_start, style.text_end)
    } else {
        normalize_style_range(
            style.authored_text_start,
            style.authored_text_end,
            grapheme_boundaries,
        )
    };
    StyleTopologyRecord {
        style_id: style.style_id,
        text_start,
        text_end,
        cascade_order: style.cascade_order,
        root: style.root,
    }
}

fn topology_current(style: RetainedStyle) -> StyleTopologyRecord {
    StyleTopologyRecord {
        style_id: style.style_id,
        text_start: style.text_start,
        text_end: style.text_end,
        cascade_order: style.cascade_order,
        root: style.root,
    }
}

fn topology_value(value: StyleValue<'_>, grapheme_boundaries: &[u32]) -> StyleTopologyRecord {
    let (text_start, text_end) = if value.root {
        (value.text_start, value.text_end)
    } else {
        normalize_style_range(value.text_start, value.text_end, grapheme_boundaries)
    };
    StyleTopologyRecord {
        style_id: value.style_id,
        text_start,
        text_end,
        cascade_order: value.cascade_order,
        root: value.root,
    }
}

fn validate_style_topology(
    count: usize,
    mut record_at: impl FnMut(usize) -> Option<StyleTopologyRecord>,
    order_scratch: &mut Vec<usize>,
    nesting_scratch: &mut Vec<u32>,
    sort_pairs: &mut Vec<(u64, u32)>,
    sort_pairs_pass: &mut Vec<(u64, u32)>,
) -> Result<(), EngineError> {
    order_scratch.clear();
    order_scratch
        .try_reserve(count)
        .map_err(|_| EngineError::ResultTooLarge)?;
    // Two stable passes preserve cascade order while sorting by range containment.
    sort::prepare_pairs(sort_pairs, count)?;
    for index in 0..count {
        let style = record_at(index).ok_or(EngineError::InvalidRequest)?;
        if !style.root && style.text_start == style.text_end {
            continue;
        }
        sort_pairs.push((
            (u64::from(!style.root) << 32) | u64::from(style.cascade_order),
            u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?,
        ));
    }
    sort::sort_pairs(sort_pairs);
    sort::prepare_pairs(sort_pairs_pass, sort_pairs.len())?;
    for (position, &(_, record_index)) in sort_pairs.iter().enumerate() {
        let style =
            record_at(usize::try_from(record_index).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
        sort_pairs_pass.push((
            sort::pack2(style.text_start, !style.text_end),
            u32::try_from(position).map_err(|_| EngineError::ResultTooLarge)?,
        ));
    }
    sort::sort_pairs(sort_pairs_pass);
    for &(_, position) in sort_pairs_pass.iter() {
        let position = usize::try_from(position).map_err(|_| EngineError::InvalidRequest)?;
        let record_index = sort_pairs
            .get(position)
            .ok_or(EngineError::InvalidRequest)?
            .1;
        order_scratch.push(usize::try_from(record_index).map_err(|_| EngineError::InvalidRequest)?);
    }
    if let Some(pair) = order_scratch.windows(2).find(|pair| {
        let Some(left) = record_at(pair[0]) else {
            return false;
        };
        let Some(right) = record_at(pair[1]) else {
            return false;
        };
        left.text_start == right.text_start
            && left.text_end == right.text_end
            && left.cascade_order == right.cascade_order
    }) {
        let style_id = record_at(pair[1])
            .ok_or(EngineError::InvalidRequest)?
            .style_id;
        return Err(EngineError::StyleNestingInvalid(FrameFault::style(
            style_id,
        )));
    }
    nesting_scratch.clear();
    nesting_scratch
        .try_reserve(order_scratch.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    for index in order_scratch.iter().copied() {
        let style = record_at(index).ok_or(EngineError::InvalidRequest)?;
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
            return Err(EngineError::StyleNestingInvalid(FrameFault::style(
                style.style_id,
            )));
        }
        nesting_scratch.push(style.text_end);
    }
    Ok(())
}

fn validate_topology_records(
    records: &[StyleTopologyRecord],
    order_scratch: &mut Vec<usize>,
    nesting_scratch: &mut Vec<u32>,
    sort_pairs: &mut Vec<(u64, u32)>,
    sort_pairs_pass: &mut Vec<(u64, u32)>,
) -> Result<(), EngineError> {
    validate_style_topology(
        records.len(),
        |index| records.get(index).copied(),
        order_scratch,
        nesting_scratch,
        sort_pairs,
        sort_pairs_pass,
    )
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

fn mutation_root(mutations: StyleMutationBatch<'_>, key: MutationKey) -> Result<bool, EngineError> {
    match mutations
        .get(key.request_index)
        .ok_or(EngineError::InvalidRequest)?
    {
        StyleMutation::Remove { .. } => Ok(false),
        StyleMutation::Upsert(value) => Ok(value.root),
    }
}

fn prepare_mutation_order(
    mutations: StyleMutationBatch<'_>,
    scratch: &mut Vec<MutationKey>,
    sort_pairs: &mut Vec<(u64, u32)>,
) -> Result<(), EngineError> {
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
    sort::prepare_pairs(sort_pairs, scratch.len())?;
    for (index, key) in scratch.iter().enumerate() {
        sort_pairs.push((sort::pack2(key.style_id, index as u32), index as u32));
    }
    sort::sort_pairs(sort_pairs);
    sort::apply_pair_order(scratch, sort_pairs);
    collapse_to_last_mutation(scratch);
    Ok(())
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
        authored_text_start: value.text_start,
        authored_text_end: value.text_end,
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
        opacity: value.opacity,
        outline_rgba: value.outline_rgba,
        outline_width: value.outline_width,
        shadow_rgba: value.shadow_rgba,
        shadow_offset_x: value.shadow_offset_x,
        shadow_offset_y: value.shadow_offset_y,
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
    use crate::abi_contract as abi;
    use crate::engine::frame::{
        STYLE_FIELD_FEATURES, STYLE_FIELD_FOREGROUND, STYLE_FIELD_LANGUAGE,
        STYLE_FIELD_LETTER_SPACING, STYLE_FIELD_MATERIAL, STYLE_FIELD_WORD_SPACING,
        STYLE_FLAG_ROOT, STYLE_MUTATION_REMOVE, STYLE_MUTATION_UPSERT,
    };
    use alloc::vec;

    #[test]
    fn authored_style_ranges_advance_to_the_grapheme_end() {
        let boundaries = [0, 1, 3, 5, 6];
        assert_eq!(cluster_end_at_or_after(&boundaries, 1), 1);
        assert_eq!(cluster_end_at_or_after(&boundaries, 2), 3);
        assert_eq!(cluster_end_at_or_after(&boundaries, 4), 5);
        assert_eq!(cluster_end_at_or_after(&boundaries, 6), 6);
        assert_eq!(cluster_end_at_or_after(&[], 2), 2);
        assert_eq!(normalize_style_range(1, 2, &[0, 2, 3]), (2, 2));
        assert_eq!(normalize_style_range(0, 1, &[0, 2, 3]), (0, 2));
    }

    #[test]
    fn retained_ranges_detect_grapheme_changes_from_authored_offsets() {
        let arena = StyleArena {
            records: vec![
                style(1, 0, 0, 2, ROOT_REQUIRED_FIELDS, true),
                style(2, 1, 0, 1, 0, false),
            ],
            ..StyleArena::default()
        };
        assert!(!arena.needs_range_realign(&[0, 1, 2]));
        assert!(arena.needs_range_realign(&[0, 2, 3]));
    }

    #[test]
    fn root_mutation_merge_preserves_last_write_semantics() {
        let arena = StyleArena {
            records: vec![
                style(10, 0, 0, 8, ROOT_REQUIRED_FIELDS, true),
                style(20, 1, 0, 8, 0, false),
            ],
            ..StyleArena::default()
        };
        let mut scratch = Vec::new();
        let mut sort_pairs = Vec::new();

        let bytes = style_mutation_bytes(&[
            (STYLE_MUTATION_UPSERT, 10, false),
            (STYLE_MUTATION_UPSERT, 10, true),
        ]);
        assert_eq!(
            arena.validate_root_mutations(
                parse_style_mutations(&bytes),
                &mut scratch,
                &mut sort_pairs
            ),
            Ok(())
        );

        let bytes = style_mutation_bytes(&[
            (STYLE_MUTATION_UPSERT, 10, true),
            (STYLE_MUTATION_REMOVE, 10, false),
        ]);
        assert_eq!(
            arena.validate_root_mutations(
                parse_style_mutations(&bytes),
                &mut scratch,
                &mut sort_pairs
            ),
            Err(EngineError::InvalidRequest),
        );

        let bytes = style_mutation_bytes(&[
            (STYLE_MUTATION_UPSERT, 30, true),
            (STYLE_MUTATION_REMOVE, 30, false),
        ]);
        assert_eq!(
            arena.validate_root_mutations(
                parse_style_mutations(&bytes),
                &mut scratch,
                &mut sort_pairs
            ),
            Ok(())
        );

        let bytes = style_mutation_bytes(&[
            (STYLE_MUTATION_UPSERT, 30, true),
            (STYLE_MUTATION_UPSERT, 40, true),
        ]);
        assert_eq!(
            arena.validate_root_mutations(
                parse_style_mutations(&bytes),
                &mut scratch,
                &mut sort_pairs
            ),
            Err(EngineError::StyleRootInvalid(FrameFault::default())),
        );
    }

    #[test]
    fn root_mutation_merge_work_scales_with_records_and_unique_mutations() {
        fn measure_merge_steps(size: usize) -> usize {
            let mut records = vec![style(1, 0, 0, 8, ROOT_REQUIRED_FIELDS, true)];
            records.extend((2..=size as u32).map(|id| style(id, id, 0, 8, 0, false)));
            let arena = StyleArena {
                records,
                ..StyleArena::default()
            };
            let mut scratch = Vec::new();
            let mut sort_pairs = Vec::new();
            let entries = (2..=size as u32)
                .map(|id| (STYLE_MUTATION_REMOVE, id, false))
                .collect::<Vec<_>>();
            let bytes = style_mutation_bytes(&entries);

            assert_eq!(
                arena.validate_root_mutations(
                    parse_style_mutations(&bytes),
                    &mut scratch,
                    &mut sort_pairs
                ),
                Ok(())
            );
            let first_steps = arena.root_validation_steps.get();
            let scratch_capacity = scratch.capacity();
            let scratch_pointer = scratch.as_ptr();
            let sort_capacity = sort_pairs.capacity();
            let sort_pointer = sort_pairs.as_ptr();
            assert_eq!(
                arena.validate_root_mutations(
                    parse_style_mutations(&bytes),
                    &mut scratch,
                    &mut sort_pairs
                ),
                Ok(())
            );
            assert_eq!(arena.root_validation_steps.get(), first_steps);
            assert_eq!(scratch.capacity(), scratch_capacity);
            assert_eq!(scratch.as_ptr(), scratch_pointer);
            assert_eq!(sort_pairs.capacity(), sort_capacity);
            assert_eq!(sort_pairs.as_ptr(), sort_pointer);
            first_steps
        }

        let small = measure_merge_steps(128);
        let large = measure_merge_steps(1024);
        assert_eq!(small, 128);
        assert_eq!(large, 1024);
        assert_eq!(large, small * 8);
    }

    fn style_mutation_bytes(entries: &[(u8, u32, bool)]) -> Vec<u8> {
        let records_offset = abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let record_size = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        let mut bytes = vec![0; records_offset + entries.len() * record_size];
        for (index, &(opcode, style_id, root)) in entries.iter().enumerate() {
            let start = records_offset + index * record_size;
            bytes[start + abi::ENGINE_STYLE_MUTATION_OPCODE] = opcode;
            if opcode == STYLE_MUTATION_UPSERT && root {
                bytes[start + abi::ENGINE_STYLE_MUTATION_FLAGS] = STYLE_FLAG_ROOT;
                crate::wire::write_u32(&mut bytes, start + abi::ENGINE_STYLE_MUTATION_TEXT_END, 8);
            }
            crate::wire::write_u32(
                &mut bytes,
                start + abi::ENGINE_STYLE_MUTATION_STYLE_ID,
                style_id,
            );
            crate::wire::write_u32(
                &mut bytes,
                start + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
                1,
            );
        }
        bytes
    }

    fn parse_style_mutations(bytes: &[u8]) -> StyleMutationBatch<'_> {
        let count = u32::try_from(
            (bytes.len() - abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize)
                / abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize,
        )
        .unwrap();
        super::super::semantic_wire::parse_style_mutations(
            bytes,
            abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE,
            count,
        )
        .unwrap()
    }

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
            ..StyleArena::default()
        };
        let mut order = Vec::new();
        let mut nesting = Vec::new();
        arena
            .validate(
                &[0x61; 8],
                |handle| handle == 7,
                &mut order,
                &mut nesting,
                &mut Vec::new(),
                &mut Vec::new(),
            )
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
    fn retained_style_validation_rechecks_text_features_and_fonts() {
        let arena = StyleArena {
            records: vec![
                style(10, 0, 0, 8, ROOT_REQUIRED_FIELDS, true),
                style(20, 1, 2, 6, STYLE_FIELD_FEATURES, false),
            ],
            languages: Vec::new(),
            features: vec![FeatureRecord {
                tag: u32::from_be_bytes(*b"kern"),
                value: 1,
                start: 3,
                end: 5,
            }],
            ..StyleArena::default()
        };
        arena
            .validate(
                &[0x61; 8],
                |handle| handle == 7,
                &mut Vec::new(),
                &mut Vec::new(),
                &mut Vec::new(),
                &mut Vec::new(),
            )
            .unwrap();
        assert_eq!(
            arena.validate_text(&[0x62; 8], |handle| handle == 7),
            Ok(())
        );
        for start in [1, 2, 4, 5] {
            let mut text = [0x61; 8];
            text[start..start + 2].copy_from_slice(&[0xd83d, 0xde00]);
            assert_eq!(
                arena.validate_text(&text, |handle| handle == 7),
                Err(EngineError::StyleRangeInvalid(FrameFault::style(20))),
                "retained style/feature endpoints must still be scalar boundaries",
            );
        }
        assert_eq!(
            arena.validate_text(&[0x61; 7], |handle| handle == 7),
            Err(EngineError::StyleRangeInvalid(FrameFault::style(10))),
        );
        assert_eq!(
            arena.validate_text(&[0x61; 9], |handle| handle == 7),
            Err(EngineError::StyleRootInvalid(FrameFault::style(10))),
        );
        assert_eq!(
            arena.validate_text(&[0x61; 8], |_| false),
            Err(EngineError::StyleFontStackMissing(FrameFault::style(10))),
        );
        assert_eq!(
            arena.validate_text(&[0x61; 8], |handle| handle == 7),
            Ok(())
        );
    }

    #[test]
    fn invalidation_stops_at_the_first_affected_retained_stage() {
        let storage = StyleArena::default();
        let previous = resolved(ResolvedStyle::default());

        assert_eq!(
            previous.invalidation_against(&storage, &previous, &storage),
            StyleInvalidation::default(),
        );

        let font_size = ResolvedStyle {
            font_size: 24.0,
            ..ResolvedStyle::default()
        };
        assert_eq!(
            previous.invalidation_against(&storage, &resolved(font_size), &storage),
            StyleInvalidation {
                bidi: false,
                shaping: false,
                metrics: true,
                positioning: true,
                cluster_mapping: false,
            },
        );

        let foreground = ResolvedStyle {
            foreground_rgba: 0xff00_00ff,
            ..ResolvedStyle::default()
        };
        assert_eq!(
            previous.invalidation_against(&storage, &resolved(foreground), &storage),
            StyleInvalidation {
                bidi: false,
                shaping: false,
                metrics: false,
                positioning: true,
                cluster_mapping: false,
            },
        );

        let direction = ResolvedStyle {
            direction: 2,
            ..ResolvedStyle::default()
        };
        assert_eq!(
            previous.invalidation_against(&storage, &resolved(direction), &storage),
            StyleInvalidation {
                bidi: true,
                shaping: true,
                metrics: true,
                positioning: true,
                cluster_mapping: false,
            },
        );
    }

    /// Every caller-actionable style rejection reports its own status and names the style id the
    /// REQUEST assigned, so a host maps the failure back to the record it authored instead of
    /// reading one undifferentiated `InvalidRequest` for twenty distinct causes (D-267).
    #[test]
    fn each_caller_actionable_style_fault_reports_its_own_cause_and_names_its_style() {
        let root = style(10, 0, 0, 8, ROOT_REQUIRED_FIELDS, true);
        let validate = |records: alloc::vec::Vec<RetainedStyle>| {
            StyleArena {
                records,
                languages: alloc::vec::Vec::new(),
                features: alloc::vec::Vec::new(),
                ..StyleArena::default()
            }
            .validate(
                &[0x61; 8],
                |handle| handle == 7,
                &mut Vec::new(),
                &mut Vec::new(),
                &mut Vec::new(),
                &mut Vec::new(),
            )
        };

        assert_eq!(
            validate(vec![root, style(21, 1, 5, 3, 0, false)]),
            Err(EngineError::StyleRangeInvalid(FrameFault::style(21))),
            "an inverted range names the style that states it"
        );
        assert_eq!(
            validate(vec![root, style(22, 1, 2, 9, 0, false)]),
            Err(EngineError::StyleRangeInvalid(FrameFault::style(22))),
            "a range past the end of the text names the style that states it"
        );
        assert_eq!(
            validate(vec![
                root,
                style(23, 1, 0, 5, 0, false),
                style(24, 2, 3, 8, 0, false),
            ]),
            Err(EngineError::StyleNestingInvalid(FrameFault::style(24))),
            "partial overlap names the style that escapes its enclosing scope"
        );
        assert_eq!(
            validate(vec![style(25, 0, 0, 6, ROOT_REQUIRED_FIELDS, true)]),
            Err(EngineError::StyleRootInvalid(FrameFault::style(25))),
            "a root that does not span the text names itself"
        );
        assert_eq!(
            validate(vec![
                root,
                RetainedStyle {
                    font_stack_handle: 99,
                    ..style(26, 1, 2, 6, STYLE_FIELD_FONT_STACK, false)
                },
            ]),
            Err(EngineError::StyleFontStackMissing(FrameFault::style(26))),
            "an unregistered font stack names the style that selects it"
        );
        assert_eq!(
            validate(vec![style(27, 1, 0, 8, 0, false)]),
            Err(EngineError::StyleRootInvalid(FrameFault::default())),
            "a missing root belongs to no single style, so it names none"
        );

        // A rejection raised before the paragraph is known picks it up from the paragraph loop, and
        // an attribution the raising site already made is never overwritten.
        assert_eq!(
            EngineError::StyleRangeInvalid(FrameFault::style(21)).in_paragraph(4),
            EngineError::StyleRangeInvalid(FrameFault {
                paragraph_id: 4,
                style_id: 21,
            })
        );
        assert_eq!(
            EngineError::StyleRangeInvalid(FrameFault {
                paragraph_id: 2,
                style_id: 21,
            })
            .in_paragraph(4)
            .fault()
            .paragraph_id,
            2
        );
        assert_eq!(
            EngineError::InvalidRequest.in_paragraph(4),
            EngineError::InvalidRequest,
            "an unclassified rejection names nothing, before or after attribution"
        );
        assert_eq!(EngineError::InvalidRequest.fault(), FrameFault::default());
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
            authored_text_start: text_start,
            authored_text_end: text_end,
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
            opacity: 1.0,
            outline_rgba: 0,
            outline_width: 0.0,
            shadow_rgba: 0,
            shadow_offset_x: 0.0,
            shadow_offset_y: 0.0,
            decoration_rgba: 0,
            decoration_flags: 0,
            decoration_style: DECORATION_NONE,
            decoration_thickness: 0.0,
            decoration_offset: 0.0,
            root,
        }
    }
}
