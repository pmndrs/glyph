//! Borrowed semantic update records decoded from the compiler-mapped frame ABI.

use crate::{
    FeatureRecord, STATUS_INVALID_REQUEST,
    abi_contract::{
        self as abi, ENGINE_TEXT_MUTATION_DELETE_COUNT, ENGINE_TEXT_MUTATION_ENCODING,
        ENGINE_TEXT_MUTATION_INSERT_COUNT, ENGINE_TEXT_MUTATION_INSERT_OFFSET,
        ENGINE_TEXT_MUTATION_OPCODE, ENGINE_TEXT_MUTATION_RECORD_ALIGNMENT,
        ENGINE_TEXT_MUTATION_PARAGRAPH_ID, ENGINE_TEXT_MUTATION_RECORD_SIZE,
        ENGINE_TEXT_MUTATION_RESERVED0, ENGINE_TEXT_MUTATION_TEXT_START,
        ENGINE_UPDATE_REQUEST_HEADER_SIZE,
    },
    bidi::{DIRECTION_AUTO, DIRECTION_LTR, DIRECTION_RTL},
    engine::frame::{
        ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START, AXIS_AT_MOST, AXIS_EXACT,
        AXIS_UNCONSTRAINED, BASELINE_ALPHABETIC, BASELINE_MIDDLE, BASELINE_TEXT_BOTTOM,
        BASELINE_TEXT_TOP, BLOCK_ALIGN_CENTER, BLOCK_ALIGN_END, BLOCK_ALIGN_START,
        DECORATION_DASHED, DECORATION_DOTTED, DECORATION_DOUBLE, DECORATION_FLAGS_MASK,
        DECORATION_NONE, DECORATION_SOLID, DECORATION_WAVY, EXCLUSION_WRAP_BOTH,
        EXCLUSION_WRAP_INLINE_END, EXCLUSION_WRAP_INLINE_START, EXCLUSION_WRAP_LARGEST,
        ORIENTATION_MIXED, ORIENTATION_SIDEWAYS, ORIENTATION_UPRIGHT, OVERFLOW_CLIP,
        OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE, SHAPE_POLYGON, SHAPE_RECTANGLE,
        STYLE_FIELD_BASELINE_SHIFT, STYLE_FIELD_DECORATION, STYLE_FIELD_DIRECTION,
        STYLE_FIELD_FEATURES, STYLE_FIELD_FONT_SIZE, STYLE_FIELD_FONT_STACK,
        STYLE_FIELD_FOREGROUND, STYLE_FIELD_LANGUAGE, STYLE_FIELD_LETTER_SPACING,
        STYLE_FIELD_LINE_HEIGHT, STYLE_FIELD_MASK, STYLE_FIELD_MATERIAL,
        STYLE_FIELD_RASTER_PIXEL_RATIO, STYLE_FIELD_WORD_SPACING, STYLE_FLAG_ROOT,
        STYLE_MUTATION_REMOVE, STYLE_MUTATION_UPSERT, TEXT_ENCODING_UTF16_LE,
        TEXT_MUTATION_REPLACE_UTF16, UpdateLimits, WRAP_CHARACTER, WRAP_NONE, WRAP_WORD,
        WRITING_HORIZONTAL_TB, WRITING_VERTICAL_LR, WRITING_VERTICAL_RL,
        PARAGRAPH_MUTATION_REMOVE, PARAGRAPH_MUTATION_UPSERT,
    },
    valid_language_bytes, valid_tag,
    wire::{array, read_f32, read_u16, read_u32},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ParagraphMutationBatch<'a> {
    request: &'a [u8],
    records: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ParagraphMutation {
    Upsert { paragraph_id: u32, order: u32 },
    Remove { paragraph_id: u32 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TextMutationBatch<'a> {
    request: &'a [u8],
    records: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TextMutation<'a> {
    pub paragraph_id: u32,
    pub text_start: u32,
    pub delete_count: u32,
    pub insert_utf16_le: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct StyleMutationBatch<'a> {
    request: &'a [u8],
    records: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum StyleMutation<'a> {
    Remove { paragraph_id: u32, style_id: u32 },
    Upsert(StyleValue<'a>),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct StyleValue<'a> {
    pub paragraph_id: u32,
    pub style_id: u32,
    pub cascade_order: u32,
    pub field_mask: u32,
    pub text_start: u32,
    pub text_end: u32,
    pub font_stack_handle: u32,
    pub material_id: u32,
    pub language: &'a [u8],
    pub features: &'a [u8],
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GeometryBatch<'a> {
    request: &'a [u8],
    constraints: &'a [u8],
    regions: &'a [u8],
    exclusions: &'a [u8],
    inline_objects: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowConstraint {
    pub paragraph_id: u32,
    pub flow_thread_id: u32,
    pub width: f32,
    pub height: f32,
    pub viewport_block_start: f32,
    pub viewport_block_end: f32,
    pub resume_block_offset: f32,
    pub max_lines: u32,
    pub region_start: u32,
    pub resume_cluster: u32,
    pub region_count: u16,
    pub resume_region: u16,
    pub width_mode: u8,
    pub height_mode: u8,
    pub wrap: u8,
    pub align: u8,
    pub overflow: u8,
    pub block_align: u8,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowRegion {
    pub id: u32,
    pub geometry_revision: u32,
    pub vertices_offset: u32,
    pub vertex_count: u16,
    pub exclusion_start: u16,
    pub exclusion_count: u16,
    pub shape: u8,
    pub writing_mode: u8,
    pub text_orientation: u8,
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_end: f32,
    pub block_end: f32,
    pub clip_inline_start: f32,
    pub clip_block_start: f32,
    pub clip_inline_end: f32,
    pub clip_block_end: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowExclusion {
    pub id: u32,
    pub region_id: u32,
    pub geometry_revision: u32,
    pub vertices_offset: u32,
    pub vertex_count: u16,
    pub shape: u8,
    pub wrap_side: u8,
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_end: f32,
    pub block_end: f32,
    pub margin_inline: f32,
    pub margin_block: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowVertex {
    pub inline: f32,
    pub block: f32,
}

impl GeometryBatch<'_> {
    pub(crate) const fn empty() -> Self {
        Self {
            request: &[],
            constraints: &[],
            regions: &[],
            exclusions: &[],
            inline_objects: &[],
        }
    }

    pub(crate) fn validate_text_length(self, text_length: usize) -> Result<(), u32> {
        let text_length = u32::try_from(text_length).map_err(|_| STATUS_INVALID_REQUEST)?;
        for record in self
            .constraints
            .chunks_exact(abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize)
        {
            if read_u32(record, abi::ENGINE_CONSTRAINT_RESUME_CLUSTER)? > text_length {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
        let mut previous_offset = None;
        for record in self
            .inline_objects
            .chunks_exact(abi::ENGINE_INLINE_OBJECT_RECORD_SIZE as usize)
        {
            let offset = read_u32(record, abi::ENGINE_INLINE_OBJECT_TEXT_OFFSET)?;
            if offset > text_length || previous_offset.is_some_and(|previous| offset <= previous) {
                return Err(STATUS_INVALID_REQUEST);
            }
            previous_offset = Some(offset);
        }
        Ok(())
    }

    pub(crate) fn constraint_count(self) -> usize {
        self.constraints.len() / abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize
    }

    pub(crate) fn inline_object_count(self) -> usize {
        self.inline_objects.len() / abi::ENGINE_INLINE_OBJECT_RECORD_SIZE as usize
    }

    pub(crate) fn take_paragraph(
        self,
        paragraph_id: u32,
        constraint_cursor: &mut usize,
        inline_object_cursor: &mut usize,
    ) -> Result<Self, u32> {
        let constraints = take_records(
            self.constraints,
            abi::ENGINE_CONSTRAINT_RECORD_SIZE,
            abi::ENGINE_CONSTRAINT_PARAGRAPH_ID,
            paragraph_id,
            constraint_cursor,
        )?;
        let inline_objects = take_records(
            self.inline_objects,
            abi::ENGINE_INLINE_OBJECT_RECORD_SIZE,
            abi::ENGINE_INLINE_OBJECT_PARAGRAPH_ID,
            paragraph_id,
            inline_object_cursor,
        )?;
        Ok(Self {
            request: self.request,
            constraints,
            regions: self.regions,
            exclusions: self.exclusions,
            inline_objects,
        })
    }

    pub(crate) fn paragraph_id(self, index: usize) -> Option<u32> {
        if index < self.constraint_count() {
            let record = record_at(self.constraints, abi::ENGINE_CONSTRAINT_RECORD_SIZE, index)?;
            return read_u32(record, abi::ENGINE_CONSTRAINT_PARAGRAPH_ID).ok();
        }
        let inline_index = index.checked_sub(self.constraint_count())?;
        let record = record_at(
            self.inline_objects,
            abi::ENGINE_INLINE_OBJECT_RECORD_SIZE,
            inline_index,
        )?;
        read_u32(record, abi::ENGINE_INLINE_OBJECT_PARAGRAPH_ID).ok()
    }

    pub(crate) fn constraint(self, index: usize) -> Option<FlowConstraint> {
        let record = record_at(self.constraints, abi::ENGINE_CONSTRAINT_RECORD_SIZE, index)?;
        Some(FlowConstraint {
            paragraph_id: read_u32(record, abi::ENGINE_CONSTRAINT_PARAGRAPH_ID).ok()?,
            flow_thread_id: read_u32(record, abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID).ok()?,
            width: read_f32(record, abi::ENGINE_CONSTRAINT_WIDTH).ok()?,
            height: read_f32(record, abi::ENGINE_CONSTRAINT_HEIGHT).ok()?,
            viewport_block_start: read_f32(record, abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_START)
                .ok()?,
            viewport_block_end: read_f32(record, abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END).ok()?,
            resume_block_offset: read_f32(record, abi::ENGINE_CONSTRAINT_RESUME_BLOCK_OFFSET)
                .ok()?,
            max_lines: read_u32(record, abi::ENGINE_CONSTRAINT_MAX_LINES).ok()?,
            region_start: read_u32(record, abi::ENGINE_CONSTRAINT_REGION_START).ok()?,
            resume_cluster: read_u32(record, abi::ENGINE_CONSTRAINT_RESUME_CLUSTER).ok()?,
            region_count: read_u16(record, abi::ENGINE_CONSTRAINT_REGION_COUNT).ok()?,
            resume_region: read_u16(record, abi::ENGINE_CONSTRAINT_RESUME_REGION).ok()?,
            width_mode: record[abi::ENGINE_CONSTRAINT_WIDTH_MODE],
            height_mode: record[abi::ENGINE_CONSTRAINT_HEIGHT_MODE],
            wrap: record[abi::ENGINE_CONSTRAINT_WRAP],
            align: record[abi::ENGINE_CONSTRAINT_ALIGN],
            overflow: record[abi::ENGINE_CONSTRAINT_OVERFLOW],
            block_align: record[abi::ENGINE_CONSTRAINT_BLOCK_ALIGN],
        })
    }

    pub(crate) fn region(self, index: usize) -> Option<FlowRegion> {
        let record = record_at(self.regions, abi::ENGINE_REGION_RECORD_SIZE, index)?;
        Some(FlowRegion {
            id: read_u32(record, abi::ENGINE_REGION_ID).ok()?,
            geometry_revision: read_u32(record, abi::ENGINE_REGION_GEOMETRY_REVISION).ok()?,
            vertices_offset: read_u32(record, abi::ENGINE_REGION_VERTICES_OFFSET).ok()?,
            vertex_count: read_u16(record, abi::ENGINE_REGION_VERTEX_COUNT).ok()?,
            exclusion_start: read_u16(record, abi::ENGINE_REGION_EXCLUSION_START).ok()?,
            exclusion_count: read_u16(record, abi::ENGINE_REGION_EXCLUSION_COUNT).ok()?,
            shape: record[abi::ENGINE_REGION_SHAPE],
            writing_mode: record[abi::ENGINE_REGION_WRITING_MODE],
            text_orientation: record[abi::ENGINE_REGION_TEXT_ORIENTATION],
            inline_start: read_f32(record, abi::ENGINE_REGION_INLINE_START).ok()?,
            block_start: read_f32(record, abi::ENGINE_REGION_BLOCK_START).ok()?,
            inline_end: read_f32(record, abi::ENGINE_REGION_INLINE_END).ok()?,
            block_end: read_f32(record, abi::ENGINE_REGION_BLOCK_END).ok()?,
            clip_inline_start: read_f32(record, abi::ENGINE_REGION_CLIP_INLINE_START).ok()?,
            clip_block_start: read_f32(record, abi::ENGINE_REGION_CLIP_BLOCK_START).ok()?,
            clip_inline_end: read_f32(record, abi::ENGINE_REGION_CLIP_INLINE_END).ok()?,
            clip_block_end: read_f32(record, abi::ENGINE_REGION_CLIP_BLOCK_END).ok()?,
        })
    }

    pub(crate) fn exclusion(self, index: usize) -> Option<FlowExclusion> {
        let record = record_at(self.exclusions, abi::ENGINE_EXCLUSION_RECORD_SIZE, index)?;
        Some(FlowExclusion {
            id: read_u32(record, abi::ENGINE_EXCLUSION_ID).ok()?,
            region_id: read_u32(record, abi::ENGINE_EXCLUSION_REGION_ID).ok()?,
            geometry_revision: read_u32(record, abi::ENGINE_EXCLUSION_GEOMETRY_REVISION).ok()?,
            vertices_offset: read_u32(record, abi::ENGINE_EXCLUSION_VERTICES_OFFSET).ok()?,
            vertex_count: read_u16(record, abi::ENGINE_EXCLUSION_VERTEX_COUNT).ok()?,
            shape: record[abi::ENGINE_EXCLUSION_SHAPE],
            wrap_side: record[abi::ENGINE_EXCLUSION_WRAP_SIDE],
            inline_start: read_f32(record, abi::ENGINE_EXCLUSION_INLINE_START).ok()?,
            block_start: read_f32(record, abi::ENGINE_EXCLUSION_BLOCK_START).ok()?,
            inline_end: read_f32(record, abi::ENGINE_EXCLUSION_INLINE_END).ok()?,
            block_end: read_f32(record, abi::ENGINE_EXCLUSION_BLOCK_END).ok()?,
            margin_inline: read_f32(record, abi::ENGINE_EXCLUSION_MARGIN_INLINE).ok()?,
            margin_block: read_f32(record, abi::ENGINE_EXCLUSION_MARGIN_BLOCK).ok()?,
        })
    }

    pub(crate) fn vertex(self, offset: u32, index: usize) -> Option<FlowVertex> {
        let stride = usize::try_from(abi::ENGINE_FLOW_VERTEX_RECORD_SIZE).ok()?;
        let byte_offset = usize::try_from(offset)
            .ok()?
            .checked_add(index.checked_mul(stride)?)?;
        let record = self
            .request
            .get(byte_offset..byte_offset.checked_add(stride)?)?;
        Some(FlowVertex {
            inline: read_f32(record, abi::ENGINE_FLOW_VERTEX_INLINE).ok()?,
            block: read_f32(record, abi::ENGINE_FLOW_VERTEX_BLOCK).ok()?,
        })
    }

    pub(crate) fn fingerprint(self) -> u64 {
        let mut hash = 0xcbf2_9ce4_8422_2325_u64;
        for section in [self.constraints, self.inline_objects] {
            mix_bytes(&mut hash, section);
        }
        for record in self
            .regions
            .chunks_exact(abi::ENGINE_REGION_RECORD_SIZE as usize)
        {
            mix_record_without_u32(&mut hash, record, abi::ENGINE_REGION_VERTICES_OFFSET);
            mix_vertex_payload(
                &mut hash,
                self.request,
                record,
                abi::ENGINE_REGION_SHAPE,
                abi::ENGINE_REGION_VERTICES_OFFSET,
                abi::ENGINE_REGION_VERTEX_COUNT,
            );
        }
        for record in self
            .exclusions
            .chunks_exact(abi::ENGINE_EXCLUSION_RECORD_SIZE as usize)
        {
            mix_record_without_u32(&mut hash, record, abi::ENGINE_EXCLUSION_VERTICES_OFFSET);
            mix_vertex_payload(
                &mut hash,
                self.request,
                record,
                abi::ENGINE_EXCLUSION_SHAPE,
                abi::ENGINE_EXCLUSION_VERTICES_OFFSET,
                abi::ENGINE_EXCLUSION_VERTEX_COUNT,
            );
        }
        hash
    }

    fn overlaps_range(self, range: (usize, usize)) -> Result<bool, u32> {
        for section in [
            self.constraints,
            self.regions,
            self.exclusions,
            self.inline_objects,
        ] {
            if !section.is_empty() && overlaps(range, byte_range(self.request, section)?) {
                return Ok(true);
            }
        }
        let total = self.regions.len() / abi::ENGINE_REGION_RECORD_SIZE as usize
            + self.exclusions.len() / abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
        for index in 0..total {
            if indexed_vertex_range(self.request, self.regions, self.exclusions, index)?
                .is_some_and(|vertices| overlaps(range, vertices))
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

impl<'a> ParagraphMutationBatch<'a> {
    pub(crate) const fn empty() -> Self {
        Self {
            request: &[],
            records: &[],
        }
    }

    pub(crate) fn len(self) -> usize {
        self.records.len() / abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE as usize
    }

    pub(crate) fn get(self, index: usize) -> Option<ParagraphMutation> {
        let record = record_at(
            self.records,
            abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE,
            index,
        )?;
        let paragraph_id = read_u32(record, abi::ENGINE_PARAGRAPH_MUTATION_PARAGRAPH_ID).ok()?;
        match record[abi::ENGINE_PARAGRAPH_MUTATION_OPCODE] {
            PARAGRAPH_MUTATION_UPSERT => Some(ParagraphMutation::Upsert {
                paragraph_id,
                order: read_u32(record, abi::ENGINE_PARAGRAPH_MUTATION_ORDER).ok()?,
            }),
            PARAGRAPH_MUTATION_REMOVE => Some(ParagraphMutation::Remove { paragraph_id }),
            _ => None,
        }
    }

    pub(crate) fn validate_disjoint_semantics(
        self,
        text: TextMutationBatch<'_>,
        styles: StyleMutationBatch<'_>,
        geometry: GeometryBatch<'_>,
    ) -> Result<(), u32> {
        if self.records.is_empty() {
            return Ok(());
        }
        let range = byte_range(self.request, self.records)?;
        if text.overlaps_range(range)?
            || styles.overlaps_range(range)?
            || geometry.overlaps_range(range)?
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        Ok(())
    }
}

impl<'a> TextMutationBatch<'a> {
    pub(crate) const fn empty() -> Self {
        Self {
            request: &[],
            records: &[],
        }
    }

    pub(crate) fn len(self) -> usize {
        self.records.len() / ENGINE_TEXT_MUTATION_RECORD_SIZE as usize
    }

    pub(crate) fn get(self, index: usize) -> Option<TextMutation<'a>> {
        let stride = ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
        let start = index.checked_mul(stride)?;
        let record = self.records.get(start..start.checked_add(stride)?)?;
        let insert_count = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT).ok()?;
        let insert_utf16_le = if insert_count == 0 {
            &[]
        } else {
            array(
                self.request,
                read_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET).ok()?,
                insert_count,
                2,
                2,
            )
            .ok()?
        };
        Some(TextMutation {
            paragraph_id: read_u32(record, ENGINE_TEXT_MUTATION_PARAGRAPH_ID).ok()?,
            text_start: read_u32(record, ENGINE_TEXT_MUTATION_TEXT_START).ok()?,
            delete_count: read_u32(record, ENGINE_TEXT_MUTATION_DELETE_COUNT).ok()?,
            insert_utf16_le,
        })
    }

    pub(crate) fn paragraph_id(self, index: usize) -> Option<u32> {
        self.get(index).map(|mutation| mutation.paragraph_id)
    }

    pub(crate) fn take_paragraph(
        self,
        paragraph_id: u32,
        cursor: &mut usize,
    ) -> Result<Self, u32> {
        Ok(Self {
            request: self.request,
            records: take_records(
                self.records,
                ENGINE_TEXT_MUTATION_RECORD_SIZE,
                ENGINE_TEXT_MUTATION_PARAGRAPH_ID,
                paragraph_id,
                cursor,
            )?,
        })
    }

    pub(crate) fn validate_disjoint_geometry(self, geometry: GeometryBatch<'_>) -> Result<(), u32> {
        if !self.records.is_empty()
            && geometry.overlaps_range(byte_range(self.request, self.records)?)?
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        for record in self
            .records
            .chunks_exact(ENGINE_TEXT_MUTATION_RECORD_SIZE as usize)
        {
            if let Some(range) = text_payload_range(self.request, record)?
                && geometry.overlaps_range(range)?
            {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
        Ok(())
    }

    fn overlaps_range(self, range: (usize, usize)) -> Result<bool, u32> {
        if !self.records.is_empty() && overlaps(range, byte_range(self.request, self.records)?) {
            return Ok(true);
        }
        for record in self
            .records
            .chunks_exact(ENGINE_TEXT_MUTATION_RECORD_SIZE as usize)
        {
            if text_payload_range(self.request, record)?
                .is_some_and(|payload| overlaps(range, payload))
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

impl<'a> StyleMutationBatch<'a> {
    pub(crate) const fn empty() -> Self {
        Self {
            request: &[],
            records: &[],
        }
    }

    pub(crate) fn len(self) -> usize {
        self.records.len() / abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize
    }

    pub(crate) fn get(self, index: usize) -> Option<StyleMutation<'a>> {
        let stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        let start = index.checked_mul(stride)?;
        let record = self.records.get(start..start.checked_add(stride)?)?;
        let style_id = read_u32(record, abi::ENGINE_STYLE_MUTATION_STYLE_ID).ok()?;
        let paragraph_id = read_u32(record, abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID).ok()?;
        if record[abi::ENGINE_STYLE_MUTATION_OPCODE] == STYLE_MUTATION_REMOVE {
            return Some(StyleMutation::Remove {
                paragraph_id,
                style_id,
            });
        }
        let language_length =
            u32::from(read_u16(record, abi::ENGINE_STYLE_MUTATION_LANGUAGE_LENGTH).ok()?);
        let language = if language_length == 0 {
            &[]
        } else {
            array(
                self.request,
                read_u32(record, abi::ENGINE_STYLE_MUTATION_LANGUAGE_OFFSET).ok()?,
                language_length,
                1,
                1,
            )
            .ok()?
        };
        let feature_count =
            u32::from(read_u16(record, abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT).ok()?);
        let features = if feature_count == 0 {
            &[]
        } else {
            array(
                self.request,
                read_u32(record, abi::ENGINE_STYLE_MUTATION_FEATURES_OFFSET).ok()?,
                feature_count,
                abi::FEATURE_RECORD_SIZE,
                abi::FEATURE_RECORD_ALIGNMENT,
            )
            .ok()?
        };
        Some(StyleMutation::Upsert(StyleValue {
            paragraph_id,
            style_id,
            cascade_order: read_u32(record, abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER).ok()?,
            field_mask: read_u32(record, abi::ENGINE_STYLE_MUTATION_FIELD_MASK).ok()?,
            text_start: read_u32(record, abi::ENGINE_STYLE_MUTATION_TEXT_START).ok()?,
            text_end: read_u32(record, abi::ENGINE_STYLE_MUTATION_TEXT_END).ok()?,
            font_stack_handle: read_u32(record, abi::ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE)
                .ok()?,
            material_id: read_u32(record, abi::ENGINE_STYLE_MUTATION_MATERIAL_ID).ok()?,
            language,
            features,
            font_size: read_f32(record, abi::ENGINE_STYLE_MUTATION_FONT_SIZE).ok()?,
            line_height: read_f32(record, abi::ENGINE_STYLE_MUTATION_LINE_HEIGHT).ok()?,
            letter_spacing: read_f32(record, abi::ENGINE_STYLE_MUTATION_LETTER_SPACING).ok()?,
            word_spacing: read_f32(record, abi::ENGINE_STYLE_MUTATION_WORD_SPACING).ok()?,
            baseline_shift: read_f32(record, abi::ENGINE_STYLE_MUTATION_BASELINE_SHIFT).ok()?,
            raster_pixel_ratio: read_f32(record, abi::ENGINE_STYLE_MUTATION_RASTER_PIXEL_RATIO)
                .ok()?,
            direction: record[abi::ENGINE_STYLE_MUTATION_DIRECTION],
            foreground_rgba: read_u32(record, abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA).ok()?,
            decoration_rgba: read_u32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_RGBA).ok()?,
            decoration_flags: read_u32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_FLAGS).ok()?,
            decoration_style: record[abi::ENGINE_STYLE_MUTATION_DECORATION_STYLE],
            decoration_thickness: read_f32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_THICKNESS)
                .ok()?,
            decoration_offset: read_f32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_OFFSET)
                .ok()?,
            root: record[abi::ENGINE_STYLE_MUTATION_FLAGS] == STYLE_FLAG_ROOT,
        }))
    }

    pub(crate) fn paragraph_id(self, index: usize) -> Option<u32> {
        match self.get(index)? {
            StyleMutation::Remove { paragraph_id, .. }
            | StyleMutation::Upsert(StyleValue { paragraph_id, .. }) => Some(paragraph_id),
        }
    }

    pub(crate) fn take_paragraph(
        self,
        paragraph_id: u32,
        cursor: &mut usize,
    ) -> Result<Self, u32> {
        Ok(Self {
            request: self.request,
            records: take_records(
                self.records,
                abi::ENGINE_STYLE_MUTATION_RECORD_SIZE,
                abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
                paragraph_id,
                cursor,
            )?,
        })
    }

    pub(crate) fn feature(value: StyleValue<'_>, index: usize) -> Option<FeatureRecord> {
        let stride = abi::FEATURE_RECORD_SIZE as usize;
        let start = index.checked_mul(stride)?;
        let record = value.features.get(start..start.checked_add(stride)?)?;
        Some(FeatureRecord {
            tag: read_u32(record, abi::FEATURE_TAG).ok()?,
            value: read_u32(record, abi::FEATURE_VALUE).ok()?,
            start: read_u32(record, abi::FEATURE_START).ok()?,
            end: read_u32(record, abi::FEATURE_END).ok()?,
        })
    }

    pub(crate) fn validate_disjoint_semantics(
        self,
        text: TextMutationBatch<'_>,
        geometry: GeometryBatch<'_>,
    ) -> Result<(), u32> {
        if !self.records.is_empty() {
            let records = byte_range(self.request, self.records)?;
            if text.overlaps_range(records)? || geometry.overlaps_range(records)? {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
        for record in self
            .records
            .chunks_exact(abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize)
        {
            for range in style_payload_ranges(self.request, record)?
                .into_iter()
                .flatten()
            {
                if text.overlaps_range(range)? || geometry.overlaps_range(range)? {
                    return Err(STATUS_INVALID_REQUEST);
                }
            }
        }
        Ok(())
    }

    fn overlaps_range(self, range: (usize, usize)) -> Result<bool, u32> {
        if !self.records.is_empty() && overlaps(range, byte_range(self.request, self.records)?) {
            return Ok(true);
        }
        for record in self
            .records
            .chunks_exact(abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize)
        {
            if style_payload_ranges(self.request, record)?
                .into_iter()
                .flatten()
                .any(|payload| overlaps(range, payload))
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

pub(crate) fn parse_style_mutations(
    request: &[u8],
    offset: u32,
    count: u32,
) -> Result<StyleMutationBatch<'_>, u32> {
    if count == 0 {
        return if offset == 0 {
            Ok(StyleMutationBatch::empty())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    let records = record_table(
        request,
        offset,
        count,
        abi::ENGINE_STYLE_MUTATION_RECORD_SIZE,
        abi::ENGINE_STYLE_MUTATION_RECORD_ALIGNMENT,
    )?;
    let records_range = byte_range(request, records)?;
    let mut previous_payload_end = records_range.1;
    for record in records.chunks_exact(abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize) {
        let current = style_payload_ranges(request, record)?;
        for range in current.into_iter().flatten() {
            if range.0 < previous_payload_end {
                return Err(STATUS_INVALID_REQUEST);
            }
            previous_payload_end = range.1;
        }
    }
    for record in records.chunks_exact(abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize) {
        validate_style_record(request, record)?;
    }
    Ok(StyleMutationBatch { request, records })
}

fn style_payload_ranges(request: &[u8], record: &[u8]) -> Result<[Option<(usize, usize)>; 2], u32> {
    let mut ranges = [None, None];
    for (index, (offset_field, count_field, stride, alignment)) in [
        (
            abi::ENGINE_STYLE_MUTATION_LANGUAGE_OFFSET,
            abi::ENGINE_STYLE_MUTATION_LANGUAGE_LENGTH,
            1,
            1,
        ),
        (
            abi::ENGINE_STYLE_MUTATION_FEATURES_OFFSET,
            abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT,
            abi::FEATURE_RECORD_SIZE,
            abi::FEATURE_RECORD_ALIGNMENT,
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let count = u32::from(read_u16(record, count_field)?);
        if count != 0 {
            let payload = array(
                request,
                read_u32(record, offset_field)?,
                count,
                stride,
                alignment,
            )?;
            ranges[index] = Some(byte_range(request, payload)?);
        }
    }
    Ok(ranges)
}

fn validate_style_record(request: &[u8], record: &[u8]) -> Result<(), u32> {
    let opcode = byte(record, abi::ENGINE_STYLE_MUTATION_OPCODE)?;
    let style_id = read_u32(record, abi::ENGINE_STYLE_MUTATION_STYLE_ID)?;
    let paragraph_id = read_u32(record, abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID)?;
    if style_id == 0 || paragraph_id == 0 {
        return Err(STATUS_INVALID_REQUEST);
    }
    if opcode == STYLE_MUTATION_REMOVE {
        for (index, value) in record.iter().copied().enumerate() {
            let identity = index == abi::ENGINE_STYLE_MUTATION_OPCODE
                || (abi::ENGINE_STYLE_MUTATION_STYLE_ID..abi::ENGINE_STYLE_MUTATION_STYLE_ID + 4)
                    .contains(&index)
                || (abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID
                    ..abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID + 4)
                    .contains(&index);
            if !identity && value != 0 {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
        return Ok(());
    }
    if opcode != STYLE_MUTATION_UPSERT {
        return Err(STATUS_INVALID_REQUEST);
    }
    let flags = byte(record, abi::ENGINE_STYLE_MUTATION_FLAGS)?;
    let root = flags == STYLE_FLAG_ROOT;
    if flags & !STYLE_FLAG_ROOT != 0 {
        return Err(STATUS_INVALID_REQUEST);
    }
    let field_mask = read_u32(record, abi::ENGINE_STYLE_MUTATION_FIELD_MASK)?;
    if field_mask & !STYLE_FIELD_MASK != 0 {
        return Err(STATUS_INVALID_REQUEST);
    }
    let text_start = read_u32(record, abi::ENGINE_STYLE_MUTATION_TEXT_START)?;
    let text_end = read_u32(record, abi::ENGINE_STYLE_MUTATION_TEXT_END)?;
    if text_start > text_end || (!root && text_start == text_end) {
        return Err(STATUS_INVALID_REQUEST);
    }
    validate_stated_u32(
        record,
        field_mask,
        STYLE_FIELD_FONT_STACK,
        abi::ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE,
        true,
    )?;
    validate_stated_u32(
        record,
        field_mask,
        STYLE_FIELD_MATERIAL,
        abi::ENGINE_STYLE_MUTATION_MATERIAL_ID,
        true,
    )?;
    validate_style_payload(request, record, field_mask, text_start, text_end)?;
    validate_style_float(
        record,
        field_mask,
        STYLE_FIELD_FONT_SIZE,
        abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
        true,
    )?;
    validate_style_float(
        record,
        field_mask,
        STYLE_FIELD_LINE_HEIGHT,
        abi::ENGINE_STYLE_MUTATION_LINE_HEIGHT,
        true,
    )?;
    for (field, offset) in [
        (
            STYLE_FIELD_LETTER_SPACING,
            abi::ENGINE_STYLE_MUTATION_LETTER_SPACING,
        ),
        (
            STYLE_FIELD_WORD_SPACING,
            abi::ENGINE_STYLE_MUTATION_WORD_SPACING,
        ),
        (
            STYLE_FIELD_BASELINE_SHIFT,
            abi::ENGINE_STYLE_MUTATION_BASELINE_SHIFT,
        ),
    ] {
        validate_style_float(record, field_mask, field, offset, false)?;
    }
    validate_style_float(
        record,
        field_mask,
        STYLE_FIELD_RASTER_PIXEL_RATIO,
        abi::ENGINE_STYLE_MUTATION_RASTER_PIXEL_RATIO,
        true,
    )?;
    if field_mask & STYLE_FIELD_RASTER_PIXEL_RATIO != 0 && !root {
        return Err(STATUS_INVALID_REQUEST);
    }
    let direction = byte(record, abi::ENGINE_STYLE_MUTATION_DIRECTION)?;
    if field_mask & STYLE_FIELD_DIRECTION == 0 {
        if direction != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
    } else if !matches!(direction, DIRECTION_AUTO | DIRECTION_LTR | DIRECTION_RTL) {
        return Err(STATUS_INVALID_REQUEST);
    }
    if field_mask & STYLE_FIELD_FOREGROUND == 0
        && read_u32(record, abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA)? != 0
    {
        return Err(STATUS_INVALID_REQUEST);
    }
    validate_decoration(record, field_mask)?;
    Ok(())
}

fn validate_style_payload(
    request: &[u8],
    record: &[u8],
    field_mask: u32,
    text_start: u32,
    text_end: u32,
) -> Result<(), u32> {
    let language_offset = read_u32(record, abi::ENGINE_STYLE_MUTATION_LANGUAGE_OFFSET)?;
    let language_length = u32::from(read_u16(
        record,
        abi::ENGINE_STYLE_MUTATION_LANGUAGE_LENGTH,
    )?);
    if field_mask & STYLE_FIELD_LANGUAGE == 0 {
        if language_offset != 0 || language_length != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
    } else {
        let language = array(request, language_offset, language_length, 1, 1)?;
        if language.is_empty() || !valid_language_bytes(language) {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    let features_offset = read_u32(record, abi::ENGINE_STYLE_MUTATION_FEATURES_OFFSET)?;
    let feature_count = u32::from(read_u16(record, abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT)?);
    if field_mask & STYLE_FIELD_FEATURES == 0 {
        if features_offset != 0 || feature_count != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
        return Ok(());
    }
    if feature_count == 0 {
        return if features_offset == 0 {
            Ok(())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    let features = array(
        request,
        features_offset,
        feature_count,
        abi::FEATURE_RECORD_SIZE,
        abi::FEATURE_RECORD_ALIGNMENT,
    )?;
    for feature in features.chunks_exact(abi::FEATURE_RECORD_SIZE as usize) {
        let start = read_u32(feature, abi::FEATURE_START)?;
        let end = read_u32(feature, abi::FEATURE_END)?;
        if !valid_tag(read_u32(feature, abi::FEATURE_TAG)?)
            || start >= end
            || start < text_start
            || end > text_end
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(())
}

fn validate_stated_u32(
    record: &[u8],
    field_mask: u32,
    field: u32,
    offset: usize,
    positive: bool,
) -> Result<(), u32> {
    let value = read_u32(record, offset)?;
    if field_mask & field == 0 {
        if value != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
    } else if positive && value == 0 {
        return Err(STATUS_INVALID_REQUEST);
    }
    Ok(())
}

fn validate_style_float(
    record: &[u8],
    field_mask: u32,
    field: u32,
    offset: usize,
    positive: bool,
) -> Result<(), u32> {
    if field_mask & field == 0 {
        return if read_u32(record, offset)? == 0 {
            Ok(())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    let value = read_f32(record, offset)?;
    if !value.is_finite() || (positive && value <= 0.0) {
        Err(STATUS_INVALID_REQUEST)
    } else {
        Ok(())
    }
}

fn validate_decoration(record: &[u8], field_mask: u32) -> Result<(), u32> {
    let style = byte(record, abi::ENGINE_STYLE_MUTATION_DECORATION_STYLE)?;
    let rgba = read_u32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_RGBA)?;
    let flags = read_u32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_FLAGS)?;
    let thickness_bits = read_u32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_THICKNESS)?;
    let offset_bits = read_u32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_OFFSET)?;
    if field_mask & STYLE_FIELD_DECORATION == 0 {
        return if style == 0 && rgba == 0 && flags == 0 && thickness_bits == 0 && offset_bits == 0 {
            Ok(())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if !matches!(
        style,
        DECORATION_NONE
            | DECORATION_SOLID
            | DECORATION_DOUBLE
            | DECORATION_DOTTED
            | DECORATION_DASHED
            | DECORATION_WAVY
    ) || flags & !DECORATION_FLAGS_MASK != 0
    {
        return Err(STATUS_INVALID_REQUEST);
    }
    let thickness = read_f32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_THICKNESS)?;
    let offset = read_f32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_OFFSET)?;
    if !thickness.is_finite() || thickness < 0.0 || !offset.is_finite() {
        return Err(STATUS_INVALID_REQUEST);
    }
    if style == DECORATION_NONE
        && (flags != 0 || rgba != 0 || thickness_bits != 0 || offset_bits != 0)
    {
        return Err(STATUS_INVALID_REQUEST);
    }
    Ok(())
}

pub(crate) fn parse_paragraph_mutations(
    request: &[u8],
    offset: u32,
    count: u32,
) -> Result<ParagraphMutationBatch<'_>, u32> {
    if count == 0 {
        return if offset == 0 {
            Ok(ParagraphMutationBatch::empty())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if offset < ENGINE_UPDATE_REQUEST_HEADER_SIZE {
        return Err(STATUS_INVALID_REQUEST);
    }
    let records = array(
        request,
        offset,
        count,
        abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE,
        abi::ENGINE_PARAGRAPH_MUTATION_RECORD_ALIGNMENT,
    )?;
    for (index, record) in records
        .chunks_exact(abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE as usize)
        .enumerate()
    {
        let opcode = byte(record, abi::ENGINE_PARAGRAPH_MUTATION_OPCODE)?;
        let paragraph_id = read_u32(record, abi::ENGINE_PARAGRAPH_MUTATION_PARAGRAPH_ID)?;
        let order = read_u32(record, abi::ENGINE_PARAGRAPH_MUTATION_ORDER)?;
        if paragraph_id == 0
            || byte(record, abi::ENGINE_PARAGRAPH_MUTATION_FLAGS)? != 0
            || read_u16(record, abi::ENGINE_PARAGRAPH_MUTATION_RESERVED0)? != 0
            || !matches!(opcode, PARAGRAPH_MUTATION_UPSERT | PARAGRAPH_MUTATION_REMOVE)
            || (opcode == PARAGRAPH_MUTATION_REMOVE && order != 0)
            || prior_u32_duplicate(
                records,
                abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE,
                abi::ENGINE_PARAGRAPH_MUTATION_PARAGRAPH_ID,
                index,
                paragraph_id,
            )?
            || (opcode == PARAGRAPH_MUTATION_UPSERT
                && prior_upsert_order_duplicate(records, index, order)?)
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(ParagraphMutationBatch { request, records })
}

fn prior_upsert_order_duplicate(records: &[u8], index: usize, order: u32) -> Result<bool, u32> {
    for record in records[..index * abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE as usize]
        .chunks_exact(abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE as usize)
    {
        if byte(record, abi::ENGINE_PARAGRAPH_MUTATION_OPCODE)? == PARAGRAPH_MUTATION_UPSERT
            && read_u32(record, abi::ENGINE_PARAGRAPH_MUTATION_ORDER)? == order
        {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(crate) fn parse_text_mutations(
    request: &[u8],
    offset: u32,
    count: u32,
) -> Result<TextMutationBatch<'_>, u32> {
    if count == 0 {
        return if offset == 0 {
            Ok(TextMutationBatch::empty())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if offset < ENGINE_UPDATE_REQUEST_HEADER_SIZE {
        return Err(STATUS_INVALID_REQUEST);
    }
    let records = array(
        request,
        offset,
        count,
        ENGINE_TEXT_MUTATION_RECORD_SIZE,
        ENGINE_TEXT_MUTATION_RECORD_ALIGNMENT,
    )?;
    let record_start = offset as usize;
    let record_end = record_start
        .checked_add(records.len())
        .ok_or(STATUS_INVALID_REQUEST)?;
    for (index, record) in records
        .chunks_exact(ENGINE_TEXT_MUTATION_RECORD_SIZE as usize)
        .enumerate()
    {
        if record[ENGINE_TEXT_MUTATION_OPCODE] != TEXT_MUTATION_REPLACE_UTF16
            || record[ENGINE_TEXT_MUTATION_ENCODING] != TEXT_ENCODING_UTF16_LE
            || read_u16(record, ENGINE_TEXT_MUTATION_RESERVED0)? != 0
            || read_u32(record, ENGINE_TEXT_MUTATION_PARAGRAPH_ID)? == 0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let insert_count = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT)?;
        let insert_offset = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET)?;
        if insert_count == 0 {
            if insert_offset != 0 {
                return Err(STATUS_INVALID_REQUEST);
            }
            continue;
        }
        let payload = array(request, insert_offset, insert_count, 2, 2)?;
        let payload_range = byte_range(request, payload)?;
        if overlaps(payload_range, (record_start, record_end)) {
            return Err(STATUS_INVALID_REQUEST);
        }
        for previous in records[..index * ENGINE_TEXT_MUTATION_RECORD_SIZE as usize]
            .chunks_exact(ENGINE_TEXT_MUTATION_RECORD_SIZE as usize)
        {
            if text_payload_range(request, previous)?
                .is_some_and(|range| overlaps(payload_range, range))
            {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(TextMutationBatch { request, records })
}

fn text_payload_range(request: &[u8], record: &[u8]) -> Result<Option<(usize, usize)>, u32> {
    let count = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT)?;
    if count == 0 {
        return Ok(None);
    }
    let payload = array(
        request,
        read_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET)?,
        count,
        2,
        2,
    )?;
    Ok(Some(byte_range(request, payload)?))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn parse_geometry(
    request: &[u8],
    constraints_offset: u32,
    constraint_count: u32,
    regions_offset: u32,
    region_count: u32,
    exclusions_offset: u32,
    exclusion_count: u32,
    inline_objects_offset: u32,
    inline_object_count: u32,
    limits: UpdateLimits,
) -> Result<GeometryBatch<'_>, u32> {
    if region_count > limits.max_regions
        || exclusion_count > limits.max_exclusions
        || inline_object_count > limits.max_inline_objects
        || constraint_count > limits.max_regions
    {
        return Err(STATUS_INVALID_REQUEST);
    }
    let all_empty = constraint_count == 0
        && region_count == 0
        && exclusion_count == 0
        && inline_object_count == 0;
    if all_empty {
        return if constraints_offset == 0
            && regions_offset == 0
            && exclusions_offset == 0
            && inline_objects_offset == 0
        {
            Ok(GeometryBatch::empty())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if constraint_count == 0 || region_count == 0 {
        return Err(STATUS_INVALID_REQUEST);
    }
    let constraints = record_table(
        request,
        constraints_offset,
        constraint_count,
        abi::ENGINE_CONSTRAINT_RECORD_SIZE,
        abi::ENGINE_CONSTRAINT_RECORD_ALIGNMENT,
    )?;
    let regions = record_table(
        request,
        regions_offset,
        region_count,
        abi::ENGINE_REGION_RECORD_SIZE,
        abi::ENGINE_REGION_RECORD_ALIGNMENT,
    )?;
    let exclusions = record_table(
        request,
        exclusions_offset,
        exclusion_count,
        abi::ENGINE_EXCLUSION_RECORD_SIZE,
        abi::ENGINE_EXCLUSION_RECORD_ALIGNMENT,
    )?;
    let inline_objects = record_table(
        request,
        inline_objects_offset,
        inline_object_count,
        abi::ENGINE_INLINE_OBJECT_RECORD_SIZE,
        abi::ENGINE_INLINE_OBJECT_RECORD_ALIGNMENT,
    )?;
    let fixed = [constraints, regions, exclusions, inline_objects];
    reject_overlapping_slices(request, &fixed)?;
    validate_constraints(constraints, region_count, limits)?;
    validate_regions(request, regions, exclusions, &fixed)?;
    validate_exclusions(request, exclusions, regions, &fixed)?;
    validate_inline_objects(inline_objects)?;
    reject_overlapping_vertex_payloads(request, regions, exclusions)?;
    Ok(GeometryBatch {
        request,
        constraints,
        regions,
        exclusions,
        inline_objects,
    })
}

fn record_table(
    request: &[u8],
    offset: u32,
    count: u32,
    stride: u32,
    alignment: u32,
) -> Result<&[u8], u32> {
    if count == 0 {
        return if offset == 0 {
            Ok(&[])
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if offset < abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE {
        return Err(STATUS_INVALID_REQUEST);
    }
    array(request, offset, count, stride, alignment)
}

fn record_at(records: &[u8], stride: u32, index: usize) -> Option<&[u8]> {
    let stride = usize::try_from(stride).ok()?;
    let start = index.checked_mul(stride)?;
    records.get(start..start.checked_add(stride)?)
}

fn take_records<'a>(
    records: &'a [u8],
    stride: u32,
    paragraph_field: usize,
    paragraph_id: u32,
    cursor: &mut usize,
) -> Result<&'a [u8], u32> {
    let stride = usize::try_from(stride).map_err(|_| STATUS_INVALID_REQUEST)?;
    let count = records.len() / stride;
    if *cursor > count {
        return Err(STATUS_INVALID_REQUEST);
    }
    let start = *cursor;
    while *cursor < count {
        let record = record_at(
            records,
            u32::try_from(stride).map_err(|_| STATUS_INVALID_REQUEST)?,
            *cursor,
        )
        .ok_or(STATUS_INVALID_REQUEST)?;
        if read_u32(record, paragraph_field)? != paragraph_id {
            break;
        }
        *cursor += 1;
    }
    records
        .get(start * stride..*cursor * stride)
        .ok_or(STATUS_INVALID_REQUEST)
}

fn validate_constraints(
    constraints: &[u8],
    region_count: u32,
    limits: UpdateLimits,
) -> Result<(), u32> {
    for (index, record) in constraints
        .chunks_exact(abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize)
        .enumerate()
    {
        if read_u32(record, abi::ENGINE_CONSTRAINT_PARAGRAPH_ID)? == 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
        let flow_thread_id = read_u32(record, abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID)?;
        if flow_thread_id == 0
            || prior_u32_duplicate(
                constraints,
                abi::ENGINE_CONSTRAINT_RECORD_SIZE,
                abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID,
                index,
                flow_thread_id,
            )?
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let width_mode = byte(record, abi::ENGINE_CONSTRAINT_WIDTH_MODE)?;
        let height_mode = byte(record, abi::ENGINE_CONSTRAINT_HEIGHT_MODE)?;
        let width = finite(record, abi::ENGINE_CONSTRAINT_WIDTH)?;
        let height = finite(record, abi::ENGINE_CONSTRAINT_HEIGHT)?;
        if !valid_axis(width_mode, width) || !valid_axis(height_mode, height) {
            return Err(STATUS_INVALID_REQUEST);
        }
        let viewport_start = finite(record, abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_START)?;
        let viewport_end = finite(record, abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END)?;
        if viewport_start > viewport_end
            || !finite(record, abi::ENGINE_CONSTRAINT_RESUME_BLOCK_OFFSET)?.is_finite()
            || read_u32(record, abi::ENGINE_CONSTRAINT_MAX_LINES)? > limits.max_lines
            || !matches!(
                byte(record, abi::ENGINE_CONSTRAINT_WRAP)?,
                WRAP_NONE | WRAP_WORD | WRAP_CHARACTER
            )
            || !matches!(
                byte(record, abi::ENGINE_CONSTRAINT_ALIGN)?,
                ALIGN_START | ALIGN_CENTER | ALIGN_END | ALIGN_JUSTIFY
            )
            || !matches!(
                byte(record, abi::ENGINE_CONSTRAINT_OVERFLOW)?,
                OVERFLOW_VISIBLE | OVERFLOW_CLIP | OVERFLOW_ELLIPSIS
            )
            || !matches!(
                byte(record, abi::ENGINE_CONSTRAINT_BLOCK_ALIGN)?,
                BLOCK_ALIGN_START | BLOCK_ALIGN_CENTER | BLOCK_ALIGN_END
            )
            || read_u16(record, abi::ENGINE_CONSTRAINT_FLAGS)? != 0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let region_start = read_u32(record, abi::ENGINE_CONSTRAINT_REGION_START)?;
        let selected_count = u32::from(read_u16(record, abi::ENGINE_CONSTRAINT_REGION_COUNT)?);
        let resume_region = u32::from(read_u16(record, abi::ENGINE_CONSTRAINT_RESUME_REGION)?);
        if selected_count == 0
            || region_start
                .checked_add(selected_count)
                .is_none_or(|end| end > region_count)
            || resume_region > selected_count
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(())
}

fn validate_regions(
    request: &[u8],
    regions: &[u8],
    exclusions: &[u8],
    fixed: &[&[u8]],
) -> Result<(), u32> {
    let exclusion_total = exclusions.len() / abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
    for (index, record) in regions
        .chunks_exact(abi::ENGINE_REGION_RECORD_SIZE as usize)
        .enumerate()
    {
        let id = read_u32(record, abi::ENGINE_REGION_ID)?;
        if id == 0
            || prior_u32_duplicate(
                regions,
                abi::ENGINE_REGION_RECORD_SIZE,
                abi::ENGINE_REGION_ID,
                index,
                id,
            )?
            || read_u16(record, abi::ENGINE_REGION_FLAGS)? != 0
            || byte(record, abi::ENGINE_REGION_RESERVED0)? != 0
            || !matches!(
                byte(record, abi::ENGINE_REGION_WRITING_MODE)?,
                WRITING_HORIZONTAL_TB | WRITING_VERTICAL_RL | WRITING_VERTICAL_LR
            )
            || !matches!(
                byte(record, abi::ENGINE_REGION_TEXT_ORIENTATION)?,
                ORIENTATION_MIXED | ORIENTATION_UPRIGHT | ORIENTATION_SIDEWAYS
            )
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let region_bounds = bounds(
            record,
            abi::ENGINE_REGION_INLINE_START,
            abi::ENGINE_REGION_BLOCK_START,
            abi::ENGINE_REGION_INLINE_END,
            abi::ENGINE_REGION_BLOCK_END,
        )?;
        let clip = bounds(
            record,
            abi::ENGINE_REGION_CLIP_INLINE_START,
            abi::ENGINE_REGION_CLIP_BLOCK_START,
            abi::ENGINE_REGION_CLIP_INLINE_END,
            abi::ENGINE_REGION_CLIP_BLOCK_END,
        )?;
        if clip.0 < region_bounds.0
            || clip.1 < region_bounds.1
            || clip.2 > region_bounds.2
            || clip.3 > region_bounds.3
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        validate_shape(
            request,
            record,
            abi::ENGINE_REGION_SHAPE,
            abi::ENGINE_REGION_VERTICES_OFFSET,
            abi::ENGINE_REGION_VERTEX_COUNT,
            region_bounds,
            fixed,
        )?;
        let exclusion_start = usize::from(read_u16(record, abi::ENGINE_REGION_EXCLUSION_START)?);
        let exclusion_count = usize::from(read_u16(record, abi::ENGINE_REGION_EXCLUSION_COUNT)?);
        let end = exclusion_start
            .checked_add(exclusion_count)
            .ok_or(STATUS_INVALID_REQUEST)?;
        if end > exclusion_total {
            return Err(STATUS_INVALID_REQUEST);
        }
        for exclusion in exclusions[exclusion_start * abi::ENGINE_EXCLUSION_RECORD_SIZE as usize
            ..end * abi::ENGINE_EXCLUSION_RECORD_SIZE as usize]
            .chunks_exact(abi::ENGINE_EXCLUSION_RECORD_SIZE as usize)
        {
            if read_u32(exclusion, abi::ENGINE_EXCLUSION_REGION_ID)? != id {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(())
}

fn validate_exclusions(
    request: &[u8],
    exclusions: &[u8],
    regions: &[u8],
    fixed: &[&[u8]],
) -> Result<(), u32> {
    for (index, record) in exclusions
        .chunks_exact(abi::ENGINE_EXCLUSION_RECORD_SIZE as usize)
        .enumerate()
    {
        let id = read_u32(record, abi::ENGINE_EXCLUSION_ID)?;
        let region_id = read_u32(record, abi::ENGINE_EXCLUSION_REGION_ID)?;
        if id == 0
            || prior_u32_duplicate(
                exclusions,
                abi::ENGINE_EXCLUSION_RECORD_SIZE,
                abi::ENGINE_EXCLUSION_ID,
                index,
                id,
            )?
            || !contains_u32(
                regions,
                abi::ENGINE_REGION_RECORD_SIZE,
                abi::ENGINE_REGION_ID,
                region_id,
            )?
            || read_u16(record, abi::ENGINE_EXCLUSION_FLAGS)? != 0
            || read_u16(record, abi::ENGINE_EXCLUSION_RESERVED0)? != 0
            || !matches!(
                byte(record, abi::ENGINE_EXCLUSION_WRAP_SIDE)?,
                EXCLUSION_WRAP_BOTH
                    | EXCLUSION_WRAP_INLINE_START
                    | EXCLUSION_WRAP_INLINE_END
                    | EXCLUSION_WRAP_LARGEST
            )
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let shape_bounds = bounds(
            record,
            abi::ENGINE_EXCLUSION_INLINE_START,
            abi::ENGINE_EXCLUSION_BLOCK_START,
            abi::ENGINE_EXCLUSION_INLINE_END,
            abi::ENGINE_EXCLUSION_BLOCK_END,
        )?;
        if finite(record, abi::ENGINE_EXCLUSION_MARGIN_INLINE)? < 0.0
            || finite(record, abi::ENGINE_EXCLUSION_MARGIN_BLOCK)? < 0.0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        validate_shape(
            request,
            record,
            abi::ENGINE_EXCLUSION_SHAPE,
            abi::ENGINE_EXCLUSION_VERTICES_OFFSET,
            abi::ENGINE_EXCLUSION_VERTEX_COUNT,
            shape_bounds,
            fixed,
        )?;
    }
    Ok(())
}

fn validate_inline_objects(records: &[u8]) -> Result<(), u32> {
    for (index, record) in records
        .chunks_exact(abi::ENGINE_INLINE_OBJECT_RECORD_SIZE as usize)
        .enumerate()
    {
        let id = read_u32(record, abi::ENGINE_INLINE_OBJECT_ID)?;
        if read_u32(record, abi::ENGINE_INLINE_OBJECT_PARAGRAPH_ID)? == 0
            || id == 0
            || prior_u32_duplicate(
                records,
                abi::ENGINE_INLINE_OBJECT_RECORD_SIZE,
                abi::ENGINE_INLINE_OBJECT_ID,
                index,
                id,
            )?
            || read_u32(record, abi::ENGINE_INLINE_OBJECT_RESOURCE_ID)? == 0
            || read_u32(record, abi::ENGINE_INLINE_OBJECT_RESOURCE_GENERATION)? == 0
            || finite(record, abi::ENGINE_INLINE_OBJECT_INLINE_EXTENT)? < 0.0
            || finite(record, abi::ENGINE_INLINE_OBJECT_BLOCK_EXTENT)? < 0.0
            || !finite(record, abi::ENGINE_INLINE_OBJECT_BASELINE_OFFSET)?.is_finite()
            || !finite(record, abi::ENGINE_INLINE_OBJECT_MARGIN_INLINE_START)?.is_finite()
            || !finite(record, abi::ENGINE_INLINE_OBJECT_MARGIN_INLINE_END)?.is_finite()
            || !finite(record, abi::ENGINE_INLINE_OBJECT_MARGIN_BLOCK_START)?.is_finite()
            || !finite(record, abi::ENGINE_INLINE_OBJECT_MARGIN_BLOCK_END)?.is_finite()
            || !matches!(
                byte(record, abi::ENGINE_INLINE_OBJECT_BASELINE_ALIGNMENT)?,
                BASELINE_ALPHABETIC | BASELINE_TEXT_TOP | BASELINE_MIDDLE | BASELINE_TEXT_BOTTOM
            )
            || byte(record, abi::ENGINE_INLINE_OBJECT_FLAGS)? != 0
            || read_u16(record, abi::ENGINE_INLINE_OBJECT_RESERVED0)? != 0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(())
}

fn validate_shape(
    request: &[u8],
    record: &[u8],
    shape_offset: usize,
    vertices_offset: usize,
    vertex_count_offset: usize,
    shape_bounds: (f32, f32, f32, f32),
    fixed: &[&[u8]],
) -> Result<(), u32> {
    let shape = byte(record, shape_offset)?;
    let offset = read_u32(record, vertices_offset)?;
    let count = u32::from(read_u16(record, vertex_count_offset)?);
    match shape {
        SHAPE_RECTANGLE if offset == 0 && count == 0 => Ok(()),
        SHAPE_POLYGON if count >= 3 => {
            let vertices = record_table(
                request,
                offset,
                count,
                abi::ENGINE_FLOW_VERTEX_RECORD_SIZE,
                abi::ENGINE_FLOW_VERTEX_RECORD_ALIGNMENT,
            )?;
            reject_payload_overlap(request, vertices, fixed)?;
            for vertex in vertices.chunks_exact(abi::ENGINE_FLOW_VERTEX_RECORD_SIZE as usize) {
                let inline = finite(vertex, abi::ENGINE_FLOW_VERTEX_INLINE)?;
                let block = finite(vertex, abi::ENGINE_FLOW_VERTEX_BLOCK)?;
                if inline < shape_bounds.0
                    || block < shape_bounds.1
                    || inline > shape_bounds.2
                    || block > shape_bounds.3
                {
                    return Err(STATUS_INVALID_REQUEST);
                }
            }
            Ok(())
        }
        _ => Err(STATUS_INVALID_REQUEST),
    }
}

fn bounds(
    record: &[u8],
    inline_start: usize,
    block_start: usize,
    inline_end: usize,
    block_end: usize,
) -> Result<(f32, f32, f32, f32), u32> {
    let values = (
        finite(record, inline_start)?,
        finite(record, block_start)?,
        finite(record, inline_end)?,
        finite(record, block_end)?,
    );
    if values.0 >= values.2 || values.1 >= values.3 {
        Err(STATUS_INVALID_REQUEST)
    } else {
        Ok(values)
    }
}

fn valid_axis(mode: u8, value: f32) -> bool {
    match mode {
        AXIS_UNCONSTRAINED => value == 0.0,
        AXIS_AT_MOST | AXIS_EXACT => value >= 0.0,
        _ => false,
    }
}

fn finite(record: &[u8], offset: usize) -> Result<f32, u32> {
    let value = read_f32(record, offset)?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(STATUS_INVALID_REQUEST)
    }
}

fn byte(record: &[u8], offset: usize) -> Result<u8, u32> {
    record.get(offset).copied().ok_or(STATUS_INVALID_REQUEST)
}

fn prior_u32_duplicate(
    records: &[u8],
    stride: u32,
    field: usize,
    index: usize,
    value: u32,
) -> Result<bool, u32> {
    for record in records[..index * stride as usize].chunks_exact(stride as usize) {
        if read_u32(record, field)? == value {
            return Ok(true);
        }
    }
    Ok(false)
}

fn contains_u32(records: &[u8], stride: u32, field: usize, value: u32) -> Result<bool, u32> {
    for record in records.chunks_exact(stride as usize) {
        if read_u32(record, field)? == value {
            return Ok(true);
        }
    }
    Ok(false)
}

fn reject_overlapping_slices(request: &[u8], slices: &[&[u8]]) -> Result<(), u32> {
    for (index, slice) in slices.iter().enumerate() {
        if slice.is_empty() {
            continue;
        }
        let current = byte_range(request, slice)?;
        for other in &slices[..index] {
            if !other.is_empty() && overlaps(current, byte_range(request, other)?) {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(())
}

fn reject_payload_overlap(request: &[u8], payload: &[u8], fixed: &[&[u8]]) -> Result<(), u32> {
    let payload = byte_range(request, payload)?;
    for table in fixed {
        if !table.is_empty() && overlaps(payload, byte_range(request, table)?) {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(())
}

fn reject_overlapping_vertex_payloads(
    request: &[u8],
    regions: &[u8],
    exclusions: &[u8],
) -> Result<(), u32> {
    let total = regions.len() / abi::ENGINE_REGION_RECORD_SIZE as usize
        + exclusions.len() / abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
    for index in 0..total {
        let Some(current) = indexed_vertex_range(request, regions, exclusions, index)? else {
            continue;
        };
        for previous in 0..index {
            if indexed_vertex_range(request, regions, exclusions, previous)?
                .is_some_and(|range| overlaps(current, range))
            {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(())
}

fn indexed_vertex_range(
    request: &[u8],
    regions: &[u8],
    exclusions: &[u8],
    index: usize,
) -> Result<Option<(usize, usize)>, u32> {
    let region_count = regions.len() / abi::ENGINE_REGION_RECORD_SIZE as usize;
    let (record, shape, offset, count) = if index < region_count {
        let start = index * abi::ENGINE_REGION_RECORD_SIZE as usize;
        (
            &regions[start..start + abi::ENGINE_REGION_RECORD_SIZE as usize],
            abi::ENGINE_REGION_SHAPE,
            abi::ENGINE_REGION_VERTICES_OFFSET,
            abi::ENGINE_REGION_VERTEX_COUNT,
        )
    } else {
        let start = (index - region_count) * abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
        (
            &exclusions[start..start + abi::ENGINE_EXCLUSION_RECORD_SIZE as usize],
            abi::ENGINE_EXCLUSION_SHAPE,
            abi::ENGINE_EXCLUSION_VERTICES_OFFSET,
            abi::ENGINE_EXCLUSION_VERTEX_COUNT,
        )
    };
    if byte(record, shape)? != SHAPE_POLYGON {
        return Ok(None);
    }
    let vertices = array(
        request,
        read_u32(record, offset)?,
        u32::from(read_u16(record, count)?),
        abi::ENGINE_FLOW_VERTEX_RECORD_SIZE,
        abi::ENGINE_FLOW_VERTEX_RECORD_ALIGNMENT,
    )?;
    Ok(Some(byte_range(request, vertices)?))
}

fn byte_range(request: &[u8], slice: &[u8]) -> Result<(usize, usize), u32> {
    let request_start = request.as_ptr() as usize;
    let start = (slice.as_ptr() as usize)
        .checked_sub(request_start)
        .ok_or(STATUS_INVALID_REQUEST)?;
    let end = start
        .checked_add(slice.len())
        .ok_or(STATUS_INVALID_REQUEST)?;
    if end > request.len() {
        Err(STATUS_INVALID_REQUEST)
    } else {
        Ok((start, end))
    }
}

fn overlaps(left: (usize, usize), right: (usize, usize)) -> bool {
    left.0 < right.1 && right.0 < left.1
}

fn mix_bytes(hash: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
}

fn mix_record_without_u32(hash: &mut u64, record: &[u8], offset: usize) {
    mix_bytes(hash, &record[..offset]);
    mix_bytes(hash, &record[offset + 4..]);
}

fn mix_vertex_payload(
    hash: &mut u64,
    request: &[u8],
    record: &[u8],
    shape: usize,
    offset: usize,
    count: usize,
) {
    if byte(record, shape).ok() != Some(SHAPE_POLYGON) {
        return;
    }
    if let (Ok(offset), Ok(count)) = (read_u32(record, offset), read_u16(record, count))
        && let Ok(vertices) = array(
            request,
            offset,
            u32::from(count),
            abi::ENGINE_FLOW_VERTEX_RECORD_SIZE,
            abi::ENGINE_FLOW_VERTEX_RECORD_ALIGNMENT,
        )
    {
        mix_bytes(hash, vertices);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::flow_geometry::{FlowGeometryArena, InlineSlot, InlineSlotArena};
    use crate::{
        abi_contract::{
            ENGINE_TEXT_MUTATION_DELETE_COUNT, ENGINE_TEXT_MUTATION_ENCODING,
            ENGINE_TEXT_MUTATION_INSERT_COUNT, ENGINE_TEXT_MUTATION_INSERT_OFFSET,
            ENGINE_TEXT_MUTATION_OPCODE, ENGINE_TEXT_MUTATION_TEXT_START,
        },
        wire::write_u32,
    };
    use alloc::vec;

    #[test]
    fn validates_explicit_paragraph_order_and_removal_records() {
        let offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let stride = abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE as usize;
        let mut bytes = vec![0; offset + 2 * stride];
        bytes[offset + abi::ENGINE_PARAGRAPH_MUTATION_OPCODE] = PARAGRAPH_MUTATION_UPSERT;
        write_u32(
            &mut bytes,
            offset + abi::ENGINE_PARAGRAPH_MUTATION_PARAGRAPH_ID,
            7,
        );
        write_u32(
            &mut bytes,
            offset + abi::ENGINE_PARAGRAPH_MUTATION_ORDER,
            3,
        );
        let second = offset + stride;
        bytes[second + abi::ENGINE_PARAGRAPH_MUTATION_OPCODE] = PARAGRAPH_MUTATION_REMOVE;
        write_u32(
            &mut bytes,
            second + abi::ENGINE_PARAGRAPH_MUTATION_PARAGRAPH_ID,
            8,
        );
        let batch = parse_paragraph_mutations(&bytes, offset as u32, 2).unwrap();
        assert_eq!(
            batch.get(0),
            Some(ParagraphMutation::Upsert {
                paragraph_id: 7,
                order: 3,
            })
        );
        assert_eq!(
            batch.get(1),
            Some(ParagraphMutation::Remove { paragraph_id: 8 })
        );

        write_u32(
            &mut bytes,
            second + abi::ENGINE_PARAGRAPH_MUTATION_ORDER,
            1,
        );
        assert!(parse_paragraph_mutations(&bytes, offset as u32, 2).is_err());
        write_u32(
            &mut bytes,
            second + abi::ENGINE_PARAGRAPH_MUTATION_ORDER,
            0,
        );
        bytes[second + abi::ENGINE_PARAGRAPH_MUTATION_OPCODE] = PARAGRAPH_MUTATION_UPSERT;
        write_u32(
            &mut bytes,
            second + abi::ENGINE_PARAGRAPH_MUTATION_ORDER,
            3,
        );
        assert!(parse_paragraph_mutations(&bytes, offset as u32, 2).is_err());
    }

    #[test]
    fn validates_borrowed_style_snapshots_and_canonical_removals() {
        let bytes = valid_style_bytes();
        let batch = parse_style_mutations(&bytes, STYLE_OFFSET as u32, 1).unwrap();
        let StyleMutation::Upsert(style) = batch.get(0).unwrap() else {
            panic!("upsert");
        };
        assert_eq!(style.style_id, 7);
        assert_eq!(style.language, b"en");
        assert_eq!(
            StyleMutationBatch::feature(style, 0).unwrap().tag,
            u32::from_be_bytes(*b"kern")
        );

        let mut removal = vec![0; STYLE_OFFSET + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize];
        removal[STYLE_OFFSET + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_REMOVE;
        write_u32(
            &mut removal,
            STYLE_OFFSET + abi::ENGINE_STYLE_MUTATION_STYLE_ID,
            7,
        );
        write_u32(
            &mut removal,
            STYLE_OFFSET + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            1,
        );
        assert!(parse_style_mutations(&removal, STYLE_OFFSET as u32, 1).is_ok());
        removal[STYLE_OFFSET + abi::ENGINE_STYLE_MUTATION_DIRECTION] = DIRECTION_LTR;
        assert!(parse_style_mutations(&removal, STYLE_OFFSET as u32, 1).is_err());
    }

    #[test]
    fn rejects_unstated_noncanonical_and_aliased_style_data() {
        let mut unstated = valid_style_bytes();
        write_f32(
            &mut unstated,
            STYLE_OFFSET + abi::ENGINE_STYLE_MUTATION_WORD_SPACING,
            1.0,
        );
        assert!(parse_style_mutations(&unstated, STYLE_OFFSET as u32, 1).is_err());

        let mut density_span = valid_style_bytes();
        density_span[STYLE_OFFSET + abi::ENGINE_STYLE_MUTATION_FLAGS] = 0;
        assert!(parse_style_mutations(&density_span, STYLE_OFFSET as u32, 1).is_err());

        let mut aliased = valid_style_bytes();
        write_u32(
            &mut aliased,
            STYLE_OFFSET + abi::ENGINE_STYLE_MUTATION_LANGUAGE_OFFSET,
            STYLE_OFFSET as u32,
        );
        assert!(parse_style_mutations(&aliased, STYLE_OFFSET as u32, 1).is_err());
    }

    const STYLE_OFFSET: usize = abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;

    fn valid_style_bytes() -> Vec<u8> {
        let language_offset = STYLE_OFFSET + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        let features_offset = (language_offset + 2 + 3) & !3;
        let mut bytes = vec![0; features_offset + abi::FEATURE_RECORD_SIZE as usize];
        let record = STYLE_OFFSET;
        bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
        bytes[record + abi::ENGINE_STYLE_MUTATION_FLAGS] = STYLE_FLAG_ROOT;
        write_u32(&mut bytes, record + abi::ENGINE_STYLE_MUTATION_STYLE_ID, 7);
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            1,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER,
            3,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
            STYLE_FIELD_FONT_STACK
                | STYLE_FIELD_LANGUAGE
                | STYLE_FIELD_FEATURES
                | STYLE_FIELD_FONT_SIZE
                | STYLE_FIELD_LINE_HEIGHT
                | STYLE_FIELD_RASTER_PIXEL_RATIO,
        );
        write_u32(&mut bytes, record + abi::ENGINE_STYLE_MUTATION_TEXT_END, 4);
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE,
            9,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_LANGUAGE_OFFSET,
            language_offset as u32,
        );
        write_u16(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_LANGUAGE_LENGTH,
            2,
        );
        write_u16(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT,
            1,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FEATURES_OFFSET,
            features_offset as u32,
        );
        write_f32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
            16.0,
        );
        write_f32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_LINE_HEIGHT,
            1.2,
        );
        write_f32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_RASTER_PIXEL_RATIO,
            2.0,
        );
        bytes[language_offset..language_offset + 2].copy_from_slice(b"en");
        write_u32(
            &mut bytes,
            features_offset + abi::FEATURE_TAG,
            u32::from_be_bytes(*b"kern"),
        );
        write_u32(&mut bytes, features_offset + abi::FEATURE_VALUE, 1);
        write_u32(&mut bytes, features_offset + abi::FEATURE_END, 4);
        bytes
    }

    #[test]
    fn validates_and_borrows_utf16_replacements_without_decoding_objects() {
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE;
        let payload_offset = record_offset + ENGINE_TEXT_MUTATION_RECORD_SIZE;
        let mut bytes = vec![0; payload_offset as usize + 4];
        let record = &mut bytes[record_offset as usize..payload_offset as usize];
        record[ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
        record[ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
        write_u32(record, ENGINE_TEXT_MUTATION_PARAGRAPH_ID, 1);
        write_u32(record, ENGINE_TEXT_MUTATION_TEXT_START, 2);
        write_u32(record, ENGINE_TEXT_MUTATION_DELETE_COUNT, 1);
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET, payload_offset);
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT, 2);
        bytes[payload_offset as usize..payload_offset as usize + 2]
            .copy_from_slice(&0x0061_u16.to_le_bytes());
        bytes[payload_offset as usize + 2..payload_offset as usize + 4]
            .copy_from_slice(&0xd83d_u16.to_le_bytes());

        let batch = parse_text_mutations(&bytes, record_offset, 1).unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(
            batch.get(0),
            Some(TextMutation {
                paragraph_id: 1,
                text_start: 2,
                delete_count: 1,
                insert_utf16_le: &[0x61, 0x00, 0x3d, 0xd8],
            })
        );
    }

    #[test]
    fn consumes_contiguous_paragraph_spans_without_copying_records() {
        let offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let stride = ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
        let mut bytes = vec![0; offset + 3 * stride];
        for (index, paragraph_id) in [7, 7, 9].into_iter().enumerate() {
            let record = offset + index * stride;
            bytes[record + ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
            bytes[record + ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
            write_u32(
                &mut bytes,
                record + ENGINE_TEXT_MUTATION_PARAGRAPH_ID,
                paragraph_id,
            );
        }
        let batch = parse_text_mutations(&bytes, offset as u32, 3).unwrap();
        let mut cursor = 0;
        let first = batch.take_paragraph(7, &mut cursor).unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(cursor, 2);
        let empty = batch.take_paragraph(8, &mut cursor).unwrap();
        assert_eq!(empty.len(), 0);
        assert_eq!(cursor, 2);
        let last = batch.take_paragraph(9, &mut cursor).unwrap();
        assert_eq!(last.len(), 1);
        assert_eq!(cursor, 3);

        let style_bytes = valid_style_bytes();
        let styles = parse_style_mutations(&style_bytes, STYLE_OFFSET as u32, 1).unwrap();
        let mut style_cursor = 0;
        assert_eq!(styles.take_paragraph(2, &mut style_cursor).unwrap().len(), 0);
        assert_eq!(styles.take_paragraph(1, &mut style_cursor).unwrap().len(), 1);
        assert_eq!(style_cursor, 1);

        let geometry_bytes = valid_geometry_bytes();
        let geometry = parse_valid_geometry(&geometry_bytes).unwrap();
        let (mut constraint_cursor, mut inline_cursor) = (0, 0);
        let absent = geometry
            .take_paragraph(2, &mut constraint_cursor, &mut inline_cursor)
            .unwrap();
        assert_eq!(absent.constraint_count(), 0);
        assert_eq!(absent.inline_object_count(), 0);
        let present = geometry
            .take_paragraph(1, &mut constraint_cursor, &mut inline_cursor)
            .unwrap();
        assert_eq!(present.constraint_count(), 1);
        assert_eq!(present.inline_object_count(), 1);
        assert_eq!((constraint_cursor, inline_cursor), (1, 1));
    }

    #[test]
    fn rejects_noncanonical_empty_and_overlapping_payloads() {
        assert!(parse_text_mutations(&[], 4, 0).is_err());
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE;
        let mut bytes = vec![0; record_offset as usize + ENGINE_TEXT_MUTATION_RECORD_SIZE as usize];
        let record = &mut bytes[record_offset as usize..];
        record[ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
        record[ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET, record_offset);
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT, 1);
        assert!(parse_text_mutations(&bytes, record_offset, 1).is_err());
    }

    #[test]
    fn validates_one_call_rectangle_flow_and_text_anchored_objects() {
        let bytes = valid_geometry_bytes();
        let geometry = parse_valid_geometry(&bytes).unwrap();
        geometry.validate_text_length(0).unwrap();
        assert_ne!(geometry.fingerprint(), 0);
        assert_eq!(geometry.constraint_count(), 1);
        assert_eq!(geometry.constraint(0).unwrap().flow_thread_id, 1);
        assert_eq!(geometry.region(0).unwrap().inline_end, 100.0);
        assert_eq!(geometry.exclusion(0).unwrap().region_id, 1);

        let mut polygon = bytes.clone();
        polygon.resize(
            polygon.len() + 3 * abi::ENGINE_FLOW_VERTEX_RECORD_SIZE as usize,
            0,
        );
        polygon[REGION_OFFSET + abi::ENGINE_REGION_SHAPE] = SHAPE_POLYGON;
        write_u32(
            &mut polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTICES_OFFSET,
            GEOMETRY_LENGTH as u32,
        );
        write_u16(
            &mut polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTEX_COUNT,
            3,
        );
        for (index, (inline, block)) in [(0.0, 0.0), (100.0, 0.0), (0.0, 100.0)]
            .into_iter()
            .enumerate()
        {
            let offset = GEOMETRY_LENGTH + index * abi::ENGINE_FLOW_VERTEX_RECORD_SIZE as usize;
            write_f32(
                &mut polygon,
                offset + abi::ENGINE_FLOW_VERTEX_INLINE,
                inline,
            );
            write_f32(&mut polygon, offset + abi::ENGINE_FLOW_VERTEX_BLOCK, block);
        }
        let polygon_geometry = parse_valid_geometry(&polygon).unwrap();
        assert_ne!(polygon_geometry.fingerprint(), geometry.fingerprint());
        let mut retained = FlowGeometryArena::default();
        retained.build(polygon_geometry).unwrap();
        assert_eq!(retained.constraints.len(), 1);
        assert_eq!(retained.regions.len(), 1);
        assert_eq!(retained.exclusions.len(), 1);
        assert_eq!(retained.vertices.len(), 3);
        assert_eq!(retained.regions[0].vertex_start, 0);
        assert_eq!(
            retained.vertices[2],
            FlowVertex {
                inline: 0.0,
                block: 100.0
            }
        );
        retained.regions[0].record.exclusion_count = 0;
        let mut polygon_slots = InlineSlotArena::default();
        assert_eq!(
            polygon_slots
                .resolve_band(&retained, 0, 0.0, 50.0, 4)
                .unwrap(),
            [InlineSlot {
                start: 0.0,
                end: 50.0,
            }]
        );
        let mut rectangle = FlowGeometryArena::default();
        rectangle.build(geometry).unwrap();
        let mut slots = InlineSlotArena::default();
        assert_eq!(
            slots
                .resolve_rectangle_band(&rectangle, 0, 20.0, 30.0, 4)
                .unwrap(),
            [
                InlineSlot {
                    start: 0.0,
                    end: 20.0,
                },
                InlineSlot {
                    start: 40.0,
                    end: 100.0,
                },
            ]
        );
        let mut relocated_polygon = polygon[..GEOMETRY_LENGTH].to_vec();
        relocated_polygon.resize(GEOMETRY_LENGTH + 8, 0);
        relocated_polygon.extend_from_slice(&polygon[GEOMETRY_LENGTH..]);
        write_u32(
            &mut relocated_polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTICES_OFFSET,
            (GEOMETRY_LENGTH + 8) as u32,
        );
        assert_eq!(
            parse_valid_geometry(&relocated_polygon)
                .unwrap()
                .fingerprint(),
            polygon_geometry.fingerprint(),
            "request placement is not semantic geometry",
        );

        let mut outside_text = bytes.clone();
        let inline = INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_TEXT_OFFSET;
        write_u32(&mut outside_text, inline, 1);
        assert!(
            parse_valid_geometry(&outside_text)
                .unwrap()
                .validate_text_length(0)
                .is_err()
        );
    }

    #[test]
    fn rejects_invalid_geometry_relationships_and_payload_aliasing() {
        let mut wrong_region = valid_geometry_bytes();
        write_u32(
            &mut wrong_region,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_REGION_ID,
            9,
        );
        assert!(parse_valid_geometry(&wrong_region).is_err());

        let mut nonfinite = valid_geometry_bytes();
        write_f32(
            &mut nonfinite,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_MARGIN_INLINE,
            f32::NAN,
        );
        assert!(parse_valid_geometry(&nonfinite).is_err());

        let mut overlapping_polygon = valid_geometry_bytes();
        overlapping_polygon[REGION_OFFSET + abi::ENGINE_REGION_SHAPE] = SHAPE_POLYGON;
        write_u32(
            &mut overlapping_polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTICES_OFFSET,
            CONSTRAINT_OFFSET as u32,
        );
        write_u16(
            &mut overlapping_polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTEX_COUNT,
            3,
        );
        assert!(parse_valid_geometry(&overlapping_polygon).is_err());

        let mut cross_section_alias = valid_geometry_bytes();
        let mutation_offset = cross_section_alias.len();
        cross_section_alias.resize(
            mutation_offset + ENGINE_TEXT_MUTATION_RECORD_SIZE as usize,
            0,
        );
        cross_section_alias[mutation_offset + ENGINE_TEXT_MUTATION_OPCODE] =
            TEXT_MUTATION_REPLACE_UTF16;
        cross_section_alias[mutation_offset + ENGINE_TEXT_MUTATION_ENCODING] =
            TEXT_ENCODING_UTF16_LE;
        write_u32(
            &mut cross_section_alias,
            mutation_offset + ENGINE_TEXT_MUTATION_PARAGRAPH_ID,
            1,
        );
        write_u32(
            &mut cross_section_alias,
            mutation_offset + ENGINE_TEXT_MUTATION_INSERT_OFFSET,
            CONSTRAINT_OFFSET as u32,
        );
        write_u32(
            &mut cross_section_alias,
            mutation_offset + ENGINE_TEXT_MUTATION_INSERT_COUNT,
            2,
        );
        let text = parse_text_mutations(&cross_section_alias, mutation_offset as u32, 1).unwrap();
        let geometry = parse_valid_geometry(&cross_section_alias).unwrap();
        assert!(text.validate_disjoint_geometry(geometry).is_err());

        assert!(
            parse_geometry(
                &valid_geometry_bytes(),
                CONSTRAINT_OFFSET as u32,
                1,
                REGION_OFFSET as u32,
                1,
                EXCLUSION_OFFSET as u32,
                1,
                INLINE_OFFSET as u32,
                1,
                UpdateLimits {
                    max_regions: 1,
                    max_exclusions: 0,
                    ..limits()
                },
            )
            .is_err()
        );
    }

    const CONSTRAINT_OFFSET: usize = abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
    const REGION_OFFSET: usize = CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
    const EXCLUSION_OFFSET: usize = REGION_OFFSET + abi::ENGINE_REGION_RECORD_SIZE as usize;
    const INLINE_OFFSET: usize = EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
    const GEOMETRY_LENGTH: usize = INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_RECORD_SIZE as usize;

    fn parse_valid_geometry(bytes: &[u8]) -> Result<GeometryBatch<'_>, u32> {
        parse_geometry(
            bytes,
            CONSTRAINT_OFFSET as u32,
            1,
            REGION_OFFSET as u32,
            1,
            EXCLUSION_OFFSET as u32,
            1,
            INLINE_OFFSET as u32,
            1,
            limits(),
        )
    }

    fn limits() -> UpdateLimits {
        UpdateLimits {
            max_paragraphs: 4,
            max_clusters: 16,
            max_lines: 16,
            max_regions: 4,
            max_exclusions: 4,
            max_inline_objects: 4,
            max_slots_per_band: 4,
            max_output_bytes: 4096,
        }
    }

    fn valid_geometry_bytes() -> Vec<u8> {
        let mut bytes = vec![0; GEOMETRY_LENGTH];
        write_u32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_PARAGRAPH_ID,
            1,
        );
        write_u32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID,
            1,
        );
        write_f32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_WIDTH,
            100.0,
        );
        write_f32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_HEIGHT,
            100.0,
        );
        write_f32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
            100.0,
        );
        write_u32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_MAX_LINES,
            16,
        );
        write_u16(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_REGION_COUNT,
            1,
        );
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_WIDTH_MODE] = AXIS_EXACT;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_HEIGHT_MODE] = AXIS_EXACT;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_WRAP] = WRAP_WORD;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_ALIGN] = ALIGN_START;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_OVERFLOW] = OVERFLOW_CLIP;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_BLOCK_ALIGN] = BLOCK_ALIGN_START;

        write_u32(&mut bytes, REGION_OFFSET + abi::ENGINE_REGION_ID, 1);
        write_u32(
            &mut bytes,
            REGION_OFFSET + abi::ENGINE_REGION_GEOMETRY_REVISION,
            1,
        );
        write_u16(
            &mut bytes,
            REGION_OFFSET + abi::ENGINE_REGION_EXCLUSION_COUNT,
            1,
        );
        bytes[REGION_OFFSET + abi::ENGINE_REGION_SHAPE] = SHAPE_RECTANGLE;
        bytes[REGION_OFFSET + abi::ENGINE_REGION_WRITING_MODE] = WRITING_HORIZONTAL_TB;
        bytes[REGION_OFFSET + abi::ENGINE_REGION_TEXT_ORIENTATION] = ORIENTATION_MIXED;
        for field in [
            abi::ENGINE_REGION_INLINE_END,
            abi::ENGINE_REGION_BLOCK_END,
            abi::ENGINE_REGION_CLIP_INLINE_END,
            abi::ENGINE_REGION_CLIP_BLOCK_END,
        ] {
            write_f32(&mut bytes, REGION_OFFSET + field, 100.0);
        }

        write_u32(&mut bytes, EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_ID, 2);
        write_u32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_REGION_ID,
            1,
        );
        write_u32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_GEOMETRY_REVISION,
            1,
        );
        bytes[EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_SHAPE] = SHAPE_RECTANGLE;
        bytes[EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_WRAP_SIDE] = EXCLUSION_WRAP_BOTH;
        write_f32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_INLINE_START,
            20.0,
        );
        write_f32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_BLOCK_START,
            20.0,
        );
        write_f32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_INLINE_END,
            40.0,
        );
        write_f32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_BLOCK_END,
            40.0,
        );

        write_u32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_PARAGRAPH_ID,
            1,
        );
        write_u32(&mut bytes, INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_ID, 3);
        write_u32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_CONTENT_REVISION,
            1,
        );
        write_u32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_MATERIAL_ID,
            1,
        );
        write_u32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_RESOURCE_ID,
            4,
        );
        write_u32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_RESOURCE_GENERATION,
            1,
        );
        write_f32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_INLINE_EXTENT,
            10.0,
        );
        write_f32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_BLOCK_EXTENT,
            10.0,
        );
        bytes[INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_BASELINE_ALIGNMENT] = BASELINE_ALPHABETIC;
        bytes
    }

    fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn write_f32(bytes: &mut [u8], offset: usize, value: f32) {
        write_u32(bytes, offset, value.to_bits());
    }
}
