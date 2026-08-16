#![cfg_attr(not(feature = "std"), no_std)]
#![recursion_limit = "256"]

extern crate alloc;

mod abi_contract;
pub mod bidi;
pub mod engine;
pub mod line_break;
pub mod unicode;
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
mod wire;

#[cfg(target_arch = "wasm32")]
mod wasm;

use alloc::vec::Vec;
use core::cell::Cell;
use harfrust::{
    BufferClusterLevel, BufferFlags, Direction, Feature, FontRef, GlyphExtents, Language,
    ShapeOptions, ShapePlan, ShaperData, Tag, UnicodeBuffer,
    font::{BuiltinFontFuncs, FontFuncs},
};
use read_fonts::TableProvider;

pub const STATUS_OK: u32 = 0;
pub const STATUS_INVALID_HANDLE: u32 = 1;
pub const STATUS_INVALID_FONT: u32 = 2;
pub const STATUS_INVALID_EXTENTS: u32 = 3;
pub const STATUS_HANDLE_CONFLICT: u32 = 4;
pub const STATUS_FONT_MISSING: u32 = 5;
pub const STATUS_INVALID_REQUEST: u32 = 6;
pub const STATUS_RESULT_TOO_LARGE: u32 = 7;
pub const STATUS_POLICY_CONFLICT: u32 = 8;
pub const STATUS_POLICY_MISSING: u32 = 9;
pub const STATUS_SESSION_CONFLICT: u32 = 10;
pub const STATUS_SESSION_MISSING: u32 = 11;
pub const STATUS_REVISION_CONFLICT: u32 = 12;
pub const STATUS_FONT_STACK_MISSING: u32 = 13;
pub const STATUS_FONT_IN_USE: u32 = 14;

const MAX_CACHED_PLANS_PER_FONT: usize = 64;
const DEFAULT_SHAPE_BUFFER_CAPACITY: usize = 32_768;
const DEFAULT_SHAPE_FEATURE_CAPACITY: usize = 128;

pub struct ShaperRegistry {
    /// Registered fonts in ascending handle order as dense parallel arrays. The
    /// positioning and measurement loops resolve the same handle for long consecutive
    /// runs, so lookups short-circuit through `last_font` and otherwise binary-search
    /// the contiguous handle array; registration and disposal are cold paths that keep
    /// the order sorted.
    font_handles: Vec<u32>,
    fonts: Vec<RegisteredFont>,
    last_font: Cell<usize>,
    shape_buffer: Option<UnicodeBuffer>,
    context_codepoints: Vec<u32>,
    shape_features: Vec<Feature>,
}

impl Default for ShaperRegistry {
    fn default() -> Self {
        Self {
            font_handles: Vec::new(),
            fonts: Vec::new(),
            last_font: Cell::new(usize::MAX),
            shape_buffer: Some(UnicodeBuffer::new()),
            context_codepoints: Vec::new(),
            shape_features: Vec::new(),
        }
    }
}

struct RegisteredFont {
    sfnt: Vec<u8>,
    extents: Vec<u8>,
    availability: Vec<u8>,
    metrics: FontMetrics,
    data: ShaperData,
    plans: Vec<CachedPlan>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FontMetrics {
    pub units_per_em: u16,
    pub ascender: i16,
    pub descender: i16,
    pub line_gap: i16,
    pub underline_position: i16,
    pub underline_thickness: i16,
    pub strikeout_position: i16,
    pub strikeout_size: i16,
}

/// Packs a decoration metric pair as `(position << 16) | thickness`, both `i16` bit patterns.
/// The host supplies values from the validated artifact metrics; the shaping SFNT does not
/// retain `post`, so underline values cannot be re-derived in the engine.
#[cfg(test)]
pub(crate) fn pack_decoration_metrics(position: i16, value: i16) -> u32 {
    (u32::from(position as u16) << 16) | u32::from(value as u16)
}

fn unpack_decoration_metrics(packed: u32) -> (i16, i16) {
    ((packed >> 16) as u16 as i16, packed as u16 as i16)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FontGlyphExtents {
    pub x_min: i32,
    pub y_min: i32,
    pub x_max: i32,
    pub y_max: i32,
}

struct CachedPlan {
    key: PlanKey,
    plan: ShapePlan,
}

#[derive(Clone, PartialEq, Eq)]
struct PlanKey {
    direction: u8,
    script: u32,
    language: Option<Vec<u8>>,
    features: Vec<PlanFeatureKey>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct PlanFeatureKey {
    tag: u32,
    value: u32,
    global: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeatureRecord {
    pub tag: u32,
    pub value: u32,
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Copy)]
pub(crate) struct ShapeRangeRef {
    pub item_start: u32,
    pub item_end: u32,
    pub context_start: u32,
    pub context_end: u32,
    pub flags: u32,
}

#[derive(Clone, Copy)]
pub(crate) struct ShapeRunRef<'a> {
    pub text_start: u32,
    pub text_end: u32,
    pub script: u32,
    pub language: Option<&'a [u8]>,
    pub features: &'a [FeatureRecord],
    pub direction: u8,
    pub cluster_level: u8,
    pub flags: u32,
}

impl ShaperRegistry {
    pub fn initialize(&mut self) -> Result<(), u32> {
        let Some(shape_buffer) = self.shape_buffer.as_mut() else {
            return Err(STATUS_INVALID_REQUEST);
        };
        if !shape_buffer.reserve(DEFAULT_SHAPE_BUFFER_CAPACITY) {
            return Err(STATUS_RESULT_TOO_LARGE);
        }
        self.context_codepoints
            .try_reserve_exact(
                DEFAULT_SHAPE_BUFFER_CAPACITY.saturating_sub(self.context_codepoints.len()),
            )
            .map_err(|_| STATUS_RESULT_TOO_LARGE)?;
        self.shape_features
            .try_reserve_exact(DEFAULT_SHAPE_FEATURE_CAPACITY)
            .map_err(|_| STATUS_RESULT_TOO_LARGE)
    }

    pub fn register_font(
        &mut self,
        handle: u32,
        sfnt: &[u8],
        extents: &[u8],
        availability: &[u8],
        underline_packed: u32,
        strikeout_packed: u32,
    ) -> u32 {
        if handle == 0 {
            return STATUS_INVALID_HANDLE;
        }
        let font = match FontRef::new(sfnt) {
            Ok(font) => font,
            Err(_) => return STATUS_INVALID_FONT,
        };
        let glyph_count = match font.maxp() {
            Ok(maxp) => usize::from(maxp.num_glyphs()),
            Err(_) => return STATUS_INVALID_FONT,
        };
        if !valid_extents(glyph_count, extents, availability) {
            return STATUS_INVALID_EXTENTS;
        }
        let (underline_position, underline_thickness) = unpack_decoration_metrics(underline_packed);
        let (strikeout_position, strikeout_size) = unpack_decoration_metrics(strikeout_packed);
        let metrics = match (font.head(), font.hhea()) {
            (Ok(head), Ok(hhea)) => FontMetrics {
                units_per_em: head.units_per_em(),
                ascender: hhea.ascender().to_i16(),
                descender: hhea.descender().to_i16(),
                line_gap: hhea.line_gap().to_i16(),
                underline_position,
                underline_thickness,
                strikeout_position,
                strikeout_size,
            },
            _ => return STATUS_INVALID_FONT,
        };
        match self.font_handles.binary_search(&handle) {
            Ok(index) => {
                let existing = &self.fonts[index];
                return if existing.sfnt == sfnt
                    && existing.extents == extents
                    && existing.availability == availability
                {
                    STATUS_OK
                } else {
                    STATUS_HANDLE_CONFLICT
                };
            }
            Err(index) => {
                let data = ShaperData::new(&font);
                self.font_handles.insert(index, handle);
                self.fonts.insert(
                    index,
                    RegisteredFont {
                        sfnt: sfnt.to_vec(),
                        extents: extents.to_vec(),
                        availability: availability.to_vec(),
                        metrics,
                        data,
                        plans: Vec::new(),
                    },
                );
            }
        }
        STATUS_OK
    }

    /// Resolves a handle to its dense index. The memo makes the common consecutive
    /// same-font resolution one compare; a stale memo is harmless because the hit is
    /// accepted only when the handle stored at that index still matches.
    fn font_index(&self, handle: u32) -> Option<usize> {
        let last = self.last_font.get();
        if self.font_handles.get(last) == Some(&handle) {
            return Some(last);
        }
        let index = self.font_handles.binary_search(&handle).ok()?;
        self.last_font.set(index);
        Some(index)
    }

    pub(crate) fn font_metrics(&self, handle: u32) -> Option<FontMetrics> {
        self.font_index(handle).map(|index| self.fonts[index].metrics)
    }

    pub(crate) fn font_glyph_extents(&self, handle: u32, glyph: u32) -> Option<FontGlyphExtents> {
        let font = &self.fonts[self.font_index(handle)?];
        FlatExtents {
            records: &font.extents,
            availability: &font.availability,
        }
        .raw_extent_for_glyph(usize::try_from(glyph).ok()?)
    }

    pub fn dispose_font(&mut self, handle: u32) -> u32 {
        match self.font_handles.binary_search(&handle) {
            Ok(index) => {
                self.font_handles.remove(index);
                self.fonts.remove(index);
                STATUS_OK
            }
            Err(_) => STATUS_FONT_MISSING,
        }
    }

    pub(crate) fn with_shaped_run<T>(
        &mut self,
        font_handle: u32,
        text: &[u16],
        run: ShapeRunRef<'_>,
        consume: impl FnOnce(&harfrust::GlyphBuffer) -> Result<T, u32>,
    ) -> Result<T, u32> {
        let range = ShapeRangeRef {
            item_start: run.text_start,
            item_end: run.text_end,
            context_start: run.text_start,
            context_end: run.text_end,
            flags: run.flags,
        };
        self.with_shaped_range(font_handle, text, run, range, consume)
    }

    pub(crate) fn with_shaped_range<T>(
        &mut self,
        font_handle: u32,
        text: &[u16],
        run: ShapeRunRef<'_>,
        range: ShapeRangeRef,
        consume: impl FnOnce(&harfrust::GlyphBuffer) -> Result<T, u32>,
    ) -> Result<T, u32> {
        let index = self.font_index(font_handle).ok_or(STATUS_FONT_MISSING)?;
        let font = &mut self.fonts[index];
        let shaped = shape_segment(
            font,
            text,
            run,
            range,
            &mut self.shape_buffer,
            &mut self.context_codepoints,
            &mut self.shape_features,
        )?;
        let result = consume(&shaped);
        self.shape_buffer = Some(shaped.clear());
        result
    }

    pub fn font_count(&self) -> u32 {
        self.fonts.len().try_into().unwrap_or(u32::MAX)
    }

    pub fn contains_font(&self, handle: u32) -> bool {
        self.font_index(handle).is_some()
    }

    pub fn glyph_count(&self, handle: u32) -> Option<u32> {
        let font = &self.fonts[self.font_index(handle)?];
        u32::try_from(font.extents.len() / 8).ok()
    }

    pub fn retained_font_bytes(&self) -> u32 {
        self.fonts
            .iter()
            .map(|font| font.sfnt.len() + font.extents.len() + font.availability.len())
            .try_fold(0_u32, |total, bytes| {
                total.checked_add(bytes.try_into().unwrap_or(u32::MAX))
            })
            .unwrap_or(u32::MAX)
    }

    pub fn plan_count(&self) -> u32 {
        self.fonts
            .iter()
            .map(|font| u32::try_from(font.plans.len()).unwrap_or(u32::MAX))
            .fold(0_u32, u32::saturating_add)
    }
}

fn shape_segment(
    font: &mut RegisteredFont,
    text: &[u16],
    run: ShapeRunRef<'_>,
    range: ShapeRangeRef,
    buffer_slot: &mut Option<UnicodeBuffer>,
    context_codepoints: &mut Vec<u32>,
    features: &mut Vec<Feature>,
) -> Result<harfrust::GlyphBuffer, u32> {
    let mut buffer = buffer_slot.take().ok_or(STATUS_INVALID_REQUEST)?;
    match shape_segment_inner(
        font,
        text,
        run,
        range,
        &mut buffer,
        context_codepoints,
        features,
    ) {
        Ok(()) => {}
        Err(status) => {
            *buffer_slot = Some(buffer);
            return Err(status);
        }
    }

    let font_ref = match FontRef::new(&font.sfnt) {
        Ok(font_ref) => font_ref,
        Err(_) => {
            *buffer_slot = Some(buffer);
            return Err(STATUS_INVALID_FONT);
        }
    };
    let shaper = font.data.shaper(&font_ref).build();
    let Some(plan) = font.plans.last().map(|cached| &cached.plan) else {
        *buffer_slot = Some(buffer);
        return Err(STATUS_INVALID_REQUEST);
    };
    let mut extents = FlatExtents {
        records: &font.extents,
        availability: &font.availability,
    };
    Ok(shaper.shape(
        buffer,
        ShapeOptions::new()
            .features(features)
            .plan(Some(plan))
            .font_funcs(Some(&mut extents)),
    ))
}

fn shape_segment_inner(
    font: &mut RegisteredFont,
    text: &[u16],
    run: ShapeRunRef<'_>,
    range: ShapeRangeRef,
    buffer: &mut UnicodeBuffer,
    context_codepoints: &mut Vec<u32>,
    features: &mut Vec<Feature>,
) -> Result<(), u32> {
    let direction = match run.direction {
        0 => Direction::LeftToRight,
        1 => Direction::RightToLeft,
        _ => return Err(STATUS_INVALID_REQUEST),
    };
    let script = harfrust::Script::from_iso15924_tag(Tag::from_be_bytes(run.script.to_be_bytes()))
        .ok_or(STATUS_INVALID_REQUEST)?;
    let language = run
        .language
        .map(|value| parse_language(value).ok_or(STATUS_INVALID_REQUEST))
        .transpose()?;
    shape_features(run, range, features)?;
    if let Some(index) = font
        .plans
        .iter()
        .position(|cached| plan_key_matches(&cached.key, run, language.as_ref(), features))
    {
        let cached = font.plans.remove(index);
        font.plans.push(cached);
    } else {
        let font_ref = FontRef::new(&font.sfnt).map_err(|_| STATUS_INVALID_FONT)?;
        let shaper = font.data.shaper(&font_ref).build();
        let plan = ShapePlan::new(
            &shaper,
            direction,
            Some(script),
            language.as_ref(),
            features,
        );
        if font.plans.len() == MAX_CACHED_PLANS_PER_FONT {
            font.plans.remove(0);
        }
        let key = PlanKey {
            direction: run.direction,
            script: run.script,
            language: language.as_ref().map(|value| value.as_bytes().to_vec()),
            features: features
                .iter()
                .map(|feature| PlanFeatureKey {
                    tag: u32::from_be_bytes(feature.tag.to_be_bytes()),
                    value: feature.value,
                    global: feature.start == 0 && feature.end == u32::MAX,
                })
                .collect(),
        };
        font.plans.push(CachedPlan { key, plan });
    }

    buffer.clear();
    add_utf16_range(buffer, text, range.item_start, range.item_end)?;
    if range.context_start < range.item_start {
        decode_utf16_range_into(
            text,
            range.context_start,
            range.item_start,
            context_codepoints,
        )?;
        context_codepoints.reverse();
        buffer.set_pre_context_codepoints(context_codepoints);
    }
    if range.item_end < range.context_end {
        decode_utf16_range_into(text, range.item_end, range.context_end, context_codepoints)?;
        buffer.set_post_context_codepoints(context_codepoints);
    }
    buffer.set_direction(direction);
    buffer.set_script(script);
    if let Some(language) = language {
        buffer.set_language(language);
    }
    buffer.set_cluster_level(match run.cluster_level {
        0 => BufferClusterLevel::MonotoneGraphemes,
        1 => BufferClusterLevel::MonotoneCharacters,
        2 => BufferClusterLevel::Characters,
        3 => BufferClusterLevel::Graphemes,
        _ => return Err(STATUS_INVALID_REQUEST),
    });
    buffer.set_flags(BufferFlags::from_bits(range.flags).ok_or(STATUS_INVALID_REQUEST)?);

    Ok(())
}

fn plan_key_matches(
    key: &PlanKey,
    run: ShapeRunRef<'_>,
    language: Option<&Language>,
    features: &[Feature],
) -> bool {
    key.direction == run.direction
        && key.script == run.script
        && key.language.as_deref() == language.map(Language::as_bytes)
        && key.features.len() == features.len()
        && key.features.iter().zip(features).all(|(cached, feature)| {
            cached.tag == u32::from_be_bytes(feature.tag.to_be_bytes())
                && cached.value == feature.value
                && cached.global == (feature.start == 0 && feature.end == u32::MAX)
        })
}

fn shape_features(
    run: ShapeRunRef<'_>,
    range: ShapeRangeRef,
    output: &mut Vec<Feature>,
) -> Result<(), u32> {
    output.clear();
    output
        .try_reserve(run.features.len())
        .map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    output.extend(run.features.iter().map(|feature| {
        let global = feature.start <= range.item_start && feature.end >= range.item_end;
        Feature {
            tag: Tag::from_be_bytes(feature.tag.to_be_bytes()),
            value: feature.value,
            start: if global { 0 } else { feature.start },
            end: if global { u32::MAX } else { feature.end },
        }
    }));
    Ok(())
}

struct FlatExtents<'a> {
    records: &'a [u8],
    availability: &'a [u8],
}

impl FontFuncs for FlatExtents<'_> {
    fn extents(
        &mut self,
        _builtin: &BuiltinFontFuncs,
        glyph: read_fonts::types::GlyphId,
    ) -> Option<GlyphExtents> {
        self.extent_for_glyph(usize::try_from(glyph.to_u32()).ok()?)
    }
}

impl FlatExtents<'_> {
    fn extent_for_glyph(&self, glyph: usize) -> Option<GlyphExtents> {
        let raw = self.raw_extent_for_glyph(glyph)?;
        Some(GlyphExtents {
            x_bearing: raw.x_min,
            y_bearing: raw.y_max,
            width: raw.x_max - raw.x_min,
            height: raw.y_min - raw.y_max,
        })
    }

    fn raw_extent_for_glyph(&self, glyph: usize) -> Option<FontGlyphExtents> {
        if self
            .availability
            .get(glyph >> 3)
            .is_none_or(|byte| byte & (1 << (glyph & 7)) == 0)
        {
            return None;
        }
        let record = self
            .records
            .get(glyph.checked_mul(8)?..glyph.checked_mul(8)? + 8)?;
        let x_min = i16::from_le_bytes([record[0], record[1]]) as i32;
        let y_min = i16::from_le_bytes([record[2], record[3]]) as i32;
        let x_max = i16::from_le_bytes([record[4], record[5]]) as i32;
        let y_max = i16::from_le_bytes([record[6], record[7]]) as i32;
        Some(FontGlyphExtents {
            x_min,
            y_min,
            x_max,
            y_max,
        })
    }
}

fn add_utf16_range(
    buffer: &mut UnicodeBuffer,
    text: &[u16],
    start: u32,
    end: u32,
) -> Result<(), u32> {
    let start = usize::try_from(start).map_err(|_| STATUS_INVALID_REQUEST)?;
    let end = usize::try_from(end).map_err(|_| STATUS_INVALID_REQUEST)?;
    let units = text.get(start..end).ok_or(STATUS_INVALID_REQUEST)?;
    let mut local = 0;
    while local < units.len() {
        let (character, consumed) = decode_scalar(units, local);
        buffer.add(
            character,
            u32::try_from(start + local).map_err(|_| STATUS_INVALID_REQUEST)?,
        );
        local += consumed;
    }
    Ok(())
}

#[cfg(test)]
fn decode_utf16_range(text: &[u16], start: u32, end: u32) -> Result<Vec<u32>, u32> {
    let mut decoded = Vec::new();
    decode_utf16_range_into(text, start, end, &mut decoded)?;
    Ok(decoded)
}

fn decode_utf16_range_into(
    text: &[u16],
    start: u32,
    end: u32,
    decoded: &mut Vec<u32>,
) -> Result<(), u32> {
    let start = usize::try_from(start).map_err(|_| STATUS_INVALID_REQUEST)?;
    let end = usize::try_from(end).map_err(|_| STATUS_INVALID_REQUEST)?;
    let units = text.get(start..end).ok_or(STATUS_INVALID_REQUEST)?;
    decoded.clear();
    decoded
        .try_reserve(units.len())
        .map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    let mut local = 0;
    while local < units.len() {
        let (character, consumed) = decode_scalar(units, local);
        decoded.push(character as u32);
        local += consumed;
    }
    Ok(())
}

fn decode_scalar(units: &[u16], index: usize) -> (char, usize) {
    let first = units[index];
    if (0xd800..=0xdbff).contains(&first)
        && let Some(second) = units.get(index + 1).copied()
        && (0xdc00..=0xdfff).contains(&second)
    {
        let scalar = 0x1_0000 + (((first as u32 - 0xd800) << 10) | (second as u32 - 0xdc00));
        return (
            char::from_u32(scalar).unwrap_or(char::REPLACEMENT_CHARACTER),
            2,
        );
    }
    if (0xd800..=0xdfff).contains(&first) {
        (char::REPLACEMENT_CHARACTER, 1)
    } else {
        (
            char::from_u32(first as u32).unwrap_or(char::REPLACEMENT_CHARACTER),
            1,
        )
    }
}

fn parse_language(bytes: &[u8]) -> Option<Language> {
    if valid_language_bytes(bytes) {
        Language::new(bytes)
    } else {
        None
    }
}

pub(crate) fn valid_language_bytes(bytes: &[u8]) -> bool {
    if bytes.len() > u16::MAX as usize {
        return false;
    }

    let mut subtags = bytes.split(|byte| *byte == b'-');
    let Some(primary) = subtags.next() else {
        return false;
    };
    let primary_is_private_or_grandfathered = matches!(primary, [b'x' | b'X'] | [b'i' | b'I']);
    if !(2..=8).contains(&primary.len()) && !primary_is_private_or_grandfathered {
        return false;
    }
    if !primary.iter().all(u8::is_ascii_alphabetic) {
        return false;
    }

    let mut subtag_count = 0;
    for subtag in subtags {
        if subtag.is_empty() || subtag.len() > 8 || !subtag.iter().all(u8::is_ascii_alphanumeric) {
            return false;
        }
        subtag_count += 1;
    }
    if primary_is_private_or_grandfathered && subtag_count == 0 {
        return false;
    }
    true
}

pub(crate) fn valid_tag(tag: u32) -> bool {
    tag.to_be_bytes()
        .iter()
        .all(|byte| (0x20..=0x7e).contains(byte))
}

pub(crate) fn valid_utf16_boundary(text: &[u16], offset: u32) -> bool {
    let Ok(offset) = usize::try_from(offset) else {
        return false;
    };
    if offset == 0 || offset >= text.len() {
        return offset <= text.len();
    }
    !((0xd800..=0xdbff).contains(&text[offset - 1]) && (0xdc00..=0xdfff).contains(&text[offset]))
}

fn valid_extents(glyph_count: usize, extents: &[u8], availability: &[u8]) -> bool {
    let Some(extents_length) = glyph_count.checked_mul(8) else {
        return false;
    };
    let Some(availability_length) = glyph_count.checked_add(7).map(|value| value / 8) else {
        return false;
    };
    if glyph_count == 0
        || extents.len() != extents_length
        || availability.len() != availability_length
    {
        return false;
    }
    if glyph_count & 7 != 0 {
        let used = glyph_count & 7;
        let mask = !((1_u8 << used) - 1);
        if availability.last().is_none_or(|last| last & mask != 0) {
            return false;
        }
    }
    for glyph in 0..glyph_count {
        let present = availability[glyph >> 3] & (1 << (glyph & 7)) != 0;
        if !present
            && extents[glyph * 8..glyph * 8 + 8]
                .iter()
                .any(|byte| *byte != 0)
        {
            return false;
        }
    }
    true
}

pub fn shaper_abi_json() -> alloc::string::String {
    abi_contract::json()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_retains_packed_decoration_metrics() {
        const INTER: &[u8] = include_bytes!(
            "../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf"
        );
        let glyph_count = 2937usize;
        let extents = alloc::vec![0u8; glyph_count * 8];
        let availability = alloc::vec![0u8; glyph_count.div_ceil(8)];
        let mut registry = ShaperRegistry::default();
        // Inter-Regular 4.1: post -348/140, OS/2 671/140 — packed as (position << 16) | thickness.
        assert_eq!(
            registry.register_font(
                7,
                INTER,
                &extents,
                &availability,
                pack_decoration_metrics(-348, 140),
                pack_decoration_metrics(671, 140),
            ),
            STATUS_OK
        );
        let metrics = registry.font_metrics(7).expect("registered font metrics");
        assert_eq!(metrics.underline_position, -348);
        assert_eq!(metrics.underline_thickness, 140);
        assert_eq!(metrics.strikeout_position, 671);
        assert_eq!(metrics.strikeout_size, 140);
    }

    #[test]
    fn dense_font_lookups_stay_exact_across_disposal_and_reuse() {
        const INTER: &[u8] = include_bytes!(
            "../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf"
        );
        let glyph_count = 2937usize;
        let extents_a = alloc::vec![0u8; glyph_count * 8];
        let extents_b = alloc::vec![0u8; glyph_count * 8];
        let availability = alloc::vec![0u8; glyph_count.div_ceil(8)];
        let mut registry = ShaperRegistry::default();
        assert_eq!(registry.register_font(9, INTER, &extents_a, &availability, 0, 0), STATUS_OK);
        assert_eq!(registry.register_font(3, INTER, &extents_b, &availability, 0, 0), STATUS_OK);
        // Alternating queries exercise the memo's miss path; the same handle twice
        // exercises its hit path.
        assert!(registry.font_metrics(9).is_some());
        assert!(registry.font_metrics(9).is_some());
        assert!(registry.font_metrics(3).is_some());
        assert!(registry.contains_font(9));
        // Disposal shifts the dense arrays under a warm memo; the handle re-check
        // must reject the stale index and every surviving lookup stays exact.
        assert_eq!(registry.dispose_font(3), STATUS_OK);
        assert!(registry.font_metrics(3).is_none());
        assert!(registry.font_metrics(9).is_some());
        assert_eq!(registry.glyph_count(9), Some(glyph_count as u32));
        // Re-registering a lower handle shifts index assignments again.
        assert_eq!(registry.register_font(2, INTER, &extents_b, &availability, 0, 0), STATUS_OK);
        assert!(registry.font_metrics(2).is_some());
        assert!(registry.font_metrics(9).is_some());
        assert_eq!(registry.font_count(), 2);
        assert_eq!(registry.dispose_font(9), STATUS_OK);
        assert_eq!(registry.dispose_font(9), STATUS_FONT_MISSING);
        assert_eq!(registry.font_count(), 1);
    }

    #[test]
    fn registration_rejects_invalid_payloads_and_disposes_owned_state() {
        let mut registry = ShaperRegistry::default();
        assert_eq!(
            registry.register_font(0, &[], &[], &[], 0, 0),
            STATUS_INVALID_HANDLE
        );
        assert_eq!(
            registry.register_font(1, &[], &[], &[], 0, 0),
            STATUS_INVALID_FONT
        );
        assert_eq!(registry.font_count(), 0);
        assert_eq!(registry.dispose_font(1), STATUS_FONT_MISSING);
    }

    #[test]
    fn utf16_decoder_preserves_absolute_clusters_and_replaces_unpaired_surrogates() {
        let text = [b'A' as u16, 0xd83d, 0xde00, 0xd800, b'B' as u16];
        let mut buffer = UnicodeBuffer::new();
        add_utf16_range(&mut buffer, &text, 1, 5).unwrap();
        assert_eq!(buffer.len(), 3);
        assert_eq!(
            decode_utf16_range(&text, 1, 5).unwrap(),
            [0x1f600, 0xfffd, 0x42]
        );
    }

    #[test]
    fn tags_reject_non_opentype_bytes() {
        assert!(valid_tag(u32::from_be_bytes(*b"Latn")));
        assert!(!valid_tag(u32::from_be_bytes([b'L', 0, b't', b'n'])));
    }

    #[test]
    fn languages_preserve_canonical_cjk_tags_and_reject_malformed_bytes() {
        for language in [b"zh-hans".as_slice(), b"zh-hant", b"ja", b"ko"] {
            let parsed = parse_language(language).expect("canonical language tag");
            assert_eq!(parsed.as_bytes(), language);
        }

        for language in [
            b"".as_slice(),
            b"x",
            b"en-",
            b"en--us",
            b"en_us",
            b"en\0us",
            b"en\nus",
            b"123",
            b"englishish",
            &[0xff],
        ] {
            assert!(parse_language(language).is_none(), "accepted {language:?}");
        }

        let excessive = alloc::vec![b'a'; u16::MAX as usize + 1];
        assert!(parse_language(&excessive).is_none());
    }

    #[test]
    fn flat_extents_preserve_the_baked_coordinate_contract() {
        let records = [
            0, 0, 0, 0, 0, 0, 0, 0, // absent glyph 0
            0xf6, 0xff, 0xec, 0xff, 0x1e, 0x00, 0x28, 0x00, // -10,-20,30,40
        ];
        let extents = FlatExtents {
            records: &records,
            availability: &[0b10],
        };
        assert!(extents.extent_for_glyph(0).is_none());
        let present = extents.extent_for_glyph(1).unwrap();
        assert_eq!(present.x_bearing, -10);
        assert_eq!(present.y_bearing, 40);
        assert_eq!(present.width, 40);
        assert_eq!(present.height, -60);
    }
}
