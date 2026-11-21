//! The complete logical input of one paragraph, and the wire request that moves an engine from
//! one input to the next.
//!
//! A cold layout and an incremental step are the same function with a different `previous`:
//! `None` writes everything, `Some` writes only what changed, the way the TypeScript host does.

use alloc::{vec, vec::Vec};

use crate::{
    abi_contract::{self as abi, ABI_VERSION},
    bidi::DIRECTION_AUTO,
    engine::frame::{
        ALIGN_START, AXIS_EXACT, AXIS_UNCONSTRAINED, BLOCK_ALIGN_START, DECORATION_SOLID,
        DECORATION_UNDERLINE, DROP_CAP_ALIGN_BASELINE, DROP_CAP_SIDE_INLINE_START,
        EXCLUSION_WRAP_BOTH, LAST_LINE_AUTO, LAST_LINE_JUSTIFY, ORIENTATION_MIXED,
        OVERFLOW_VISIBLE, SHAPE_POLYGON, SHAPE_RECTANGLE, STYLE_FIELD_BASELINE_SHIFT,
        STYLE_FIELD_DECORATION, STYLE_FIELD_DIRECTION, STYLE_FIELD_FONT_SIZE,
        STYLE_FIELD_FONT_STACK, STYLE_FIELD_FOREGROUND, STYLE_FIELD_LETTER_SPACING,
        STYLE_FIELD_LINE_HEIGHT, STYLE_FIELD_RASTER_PIXEL_RATIO, STYLE_FIELD_WORD_SPACING,
        STYLE_FLAG_ROOT, STYLE_MUTATION_REMOVE, STYLE_MUTATION_UPSERT, TEXT_ENCODING_UTF16_LE,
        TEXT_MUTATION_REPLACE_UTF16, WRAP_WORD, WRITING_HORIZONTAL_TB,
    },
    wire::write_u32,
};

pub const ROOT_ID: u32 = 4;
pub const PARAGRAPH_ID: u32 = 1;
pub const CODEC_HANDLE: u32 = 9;
pub const CAPABILITY_SET: u32 = 1;
/// Font stack handles are `FIRST_STACK_HANDLE + index` into the case's stack list.
pub const FIRST_STACK_HANDLE: u32 = 7;
const ROOT_STYLE_ID: u32 = 1;
/// The host's stand-in for an unconstrained axis when it sizes the region.
const UNBOUNDED_EXTENT: f32 = 16_777_216.0;
const MAX_OUTPUT_BYTES: u32 = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RootStyle {
    pub font_stack: u32,
    pub font_size: f32,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub word_spacing: f32,
    pub direction: u8,
}

impl Default for RootStyle {
    fn default() -> Self {
        Self {
            font_stack: 0,
            font_size: 16.0,
            line_height: 1.2,
            letter_spacing: 0.0,
            word_spacing: 0.0,
            direction: DIRECTION_AUTO,
        }
    }
}

/// Overrides one nested span declares; `None` inherits.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SpanStyle {
    pub font_stack: Option<u32>,
    pub font_size: Option<f32>,
    pub letter_spacing: Option<f32>,
    pub baseline_shift: Option<f32>,
    pub foreground: Option<u32>,
    pub underline: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Span {
    /// Stable style id, at least 2; the root is 1.
    pub id: u32,
    pub start: u32,
    pub end: u32,
    pub style: SpanStyle,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Exclusion {
    pub inline_start: f32,
    pub inline_end: f32,
    pub block_start: f32,
    pub block_end: f32,
    /// A diamond inscribed in the box instead of the box itself: contour flow.
    pub polygon: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    /// Exact inline measure; zero is unconstrained.
    pub width: f32,
    /// Exact block measure; zero is unconstrained.
    pub height: f32,
    pub align: u8,
    pub wrap: u8,
    pub overflow: u8,
    pub max_lines: u32,
    pub justify_last_line: bool,
    pub first_line_indent: f32,
    pub drop_cap_lines: u8,
    pub exclusion: Option<Exclusion>,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            width: 600.0,
            height: 0.0,
            align: ALIGN_START,
            wrap: WRAP_WORD,
            overflow: OVERFLOW_VISIBLE,
            max_lines: 0,
            justify_last_line: false,
            first_line_indent: 0.0,
            drop_cap_lines: 0,
            exclusion: None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Model {
    pub text: Vec<u16>,
    pub root: RootStyle,
    pub spans: Vec<Span>,
    pub layout: Layout,
}

/// One UTF-16 replacement: `delete` units at `start` become `insert`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextEdit {
    pub start: u32,
    pub delete: u32,
    pub insert: Vec<u16>,
}

impl TextEdit {
    pub fn apply(&self, text: &mut Vec<u16>) {
        let start = self.start as usize;
        text.splice(
            start..start + self.delete as usize,
            self.insert.iter().copied(),
        );
    }
}

/// Which semantic views one request asks the engine to return with its result.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RequestHeader {
    pub engine_revision: u32,
    pub root_revision: u32,
    pub acknowledged_generation: u32,
    pub view_mask: u32,
    pub geometry_revision: u32,
}

/// The request that takes an engine holding `previous` to `next`. `edits` are applied in order,
/// each against the text the one before it left, and together must be the text difference;
/// with no `previous` the whole text is one insertion.
pub fn request(
    header: RequestHeader,
    previous: Option<&Model>,
    next: &Model,
    edits: &[TextEdit],
) -> Vec<u8> {
    let mut writer = RequestWriter::new(next, header);
    match previous {
        None => writer.text(&[TextEdit {
            start: 0,
            delete: 0,
            insert: next.text.clone(),
        }]),
        Some(_) => writer.text(edits),
    }
    writer.styles(previous, next);
    if previous.is_none_or(|previous| previous.layout != next.layout) {
        writer.geometry(&next.layout, header.geometry_revision);
    }
    writer.finish()
}

struct RequestWriter {
    bytes: Vec<u8>,
}

impl RequestWriter {
    fn new(next: &Model, header: RequestHeader) -> Self {
        let mut bytes = vec![0_u8; abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize];
        let length = u32::try_from(next.text.len()).unwrap_or(u32::MAX);
        let fields = [
            (abi::ENGINE_UPDATE_ABI_VERSION, ABI_VERSION),
            (abi::ENGINE_UPDATE_ROOT_ID, ROOT_ID),
            (
                abi::ENGINE_UPDATE_EXPECTED_ENGINE_REVISION,
                header.engine_revision,
            ),
            (abi::ENGINE_UPDATE_CONSUMED_REVISION, header.root_revision),
            (
                abi::ENGINE_UPDATE_ACKNOWLEDGED_PUBLICATION_GENERATION,
                header.acknowledged_generation,
            ),
            (abi::ENGINE_UPDATE_CODEC_HANDLE, CODEC_HANDLE),
            (abi::ENGINE_UPDATE_CAPABILITY_SET, CAPABILITY_SET),
            (abi::ENGINE_UPDATE_SEMANTIC_VIEW_MASK, header.view_mask),
            (abi::ENGINE_UPDATE_MAX_PARAGRAPHS, 1),
            // The host's limits: twice the text for clusters, the text for lines.
            (
                abi::ENGINE_UPDATE_MAX_CLUSTERS,
                length.saturating_mul(2).max(256),
            ),
            (abi::ENGINE_UPDATE_MAX_LINES, length.max(256)),
            (abi::ENGINE_UPDATE_MAX_REGIONS, 1),
            (abi::ENGINE_UPDATE_MAX_EXCLUSIONS, 1),
            (abi::ENGINE_UPDATE_MAX_INLINE_OBJECTS, 1),
            (abi::ENGINE_UPDATE_MAX_SLOTS_PER_BAND, 8),
            (abi::ENGINE_UPDATE_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES),
        ];
        for (offset, value) in fields {
            write_u32(&mut bytes, offset, value);
        }
        Self { bytes }
    }

    /// Appends `count` zeroed records and returns the offset of the first.
    fn table(&mut self, count: usize, stride: u32, alignment: u32) -> usize {
        let alignment = alignment.max(1) as usize;
        let start = self.bytes.len().next_multiple_of(alignment);
        self.bytes.resize(start + count * stride as usize, 0);
        start
    }

    fn header(&mut self, offset_field: usize, count_field: usize, offset: usize, count: usize) {
        write_u32(&mut self.bytes, offset_field, offset as u32);
        write_u32(&mut self.bytes, count_field, count as u32);
    }

    fn u32(&mut self, at: usize, value: u32) {
        write_u32(&mut self.bytes, at, value);
    }

    fn f32(&mut self, at: usize, value: f32) {
        write_u32(&mut self.bytes, at, value.to_bits());
    }

    fn u16(&mut self, at: usize, value: u16) {
        self.bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn text(&mut self, edits: &[TextEdit]) {
        if edits.is_empty() {
            return;
        }
        let stride = abi::ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
        let table = self.table(
            edits.len(),
            abi::ENGINE_TEXT_MUTATION_RECORD_SIZE,
            abi::ENGINE_TEXT_MUTATION_RECORD_ALIGNMENT,
        );
        self.header(
            abi::ENGINE_UPDATE_TEXT_MUTATIONS_OFFSET,
            abi::ENGINE_UPDATE_TEXT_MUTATION_COUNT,
            table,
            edits.len(),
        );
        for (index, edit) in edits.iter().enumerate() {
            let record = table + index * stride;
            self.bytes[record + abi::ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
            self.bytes[record + abi::ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
            self.u32(
                record + abi::ENGINE_TEXT_MUTATION_PARAGRAPH_ID,
                PARAGRAPH_ID,
            );
            self.u32(record + abi::ENGINE_TEXT_MUTATION_TEXT_START, edit.start);
            self.u32(record + abi::ENGINE_TEXT_MUTATION_DELETE_COUNT, edit.delete);
            if edit.insert.is_empty() {
                continue;
            }
            let payload = self.table(edit.insert.len(), 2, 2);
            self.u32(
                record + abi::ENGINE_TEXT_MUTATION_INSERT_OFFSET,
                payload as u32,
            );
            self.u32(
                record + abi::ENGINE_TEXT_MUTATION_INSERT_COUNT,
                edit.insert.len() as u32,
            );
            for (unit_index, unit) in edit.insert.iter().enumerate() {
                self.u16(payload + unit_index * 2, *unit);
            }
        }
    }

    fn styles(&mut self, previous: Option<&Model>, next: &Model) {
        let length = next.text.len() as u32;
        let root_changed = previous.is_none_or(|previous| {
            previous.root != next.root || previous.text.len() != next.text.len()
        });
        let removed: Vec<u32> = previous.map_or_else(Vec::new, |previous| {
            previous
                .spans
                .iter()
                .filter(|old| !next.spans.iter().any(|span| span.id == old.id))
                .map(|old| old.id)
                .collect()
        });
        let upserted: Vec<Span> = next
            .spans
            .iter()
            .copied()
            .filter(|span| {
                previous.is_none_or(|previous| !previous.spans.iter().any(|old| old == span))
            })
            .collect();
        let count = usize::from(root_changed) + removed.len() + upserted.len();
        if count == 0 {
            return;
        }
        let stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE;
        let table = self.table(count, stride, abi::ENGINE_STYLE_MUTATION_RECORD_ALIGNMENT);
        self.header(
            abi::ENGINE_UPDATE_STYLE_MUTATIONS_OFFSET,
            abi::ENGINE_UPDATE_STYLE_MUTATION_COUNT,
            table,
            count,
        );
        let mut record = table;
        // Removals first: a removed span must not constrain the nesting of what replaces it.
        for id in removed {
            self.bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_REMOVE;
            self.u32(record + abi::ENGINE_STYLE_MUTATION_STYLE_ID, id);
            self.u32(
                record + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
                PARAGRAPH_ID,
            );
            record += stride as usize;
        }
        if root_changed {
            self.root_style(record, next.root, length);
            record += stride as usize;
        }
        for span in upserted {
            // A span's cascade order is its id: stable across the edits that move other spans,
            // so an edit history and a cold layout resolve nested spans the same way.
            self.span_style(record, span, span.id);
            record += stride as usize;
        }
    }

    fn style_record(&mut self, record: usize, id: u32, start: u32, end: u32, mask: u32) {
        self.bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
        self.u32(record + abi::ENGINE_STYLE_MUTATION_STYLE_ID, id);
        self.u32(
            record + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            PARAGRAPH_ID,
        );
        self.u32(record + abi::ENGINE_STYLE_MUTATION_TEXT_START, start);
        self.u32(record + abi::ENGINE_STYLE_MUTATION_TEXT_END, end);
        self.u32(record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK, mask);
    }

    fn root_style(&mut self, record: usize, root: RootStyle, length: u32) {
        let mut mask = STYLE_FIELD_FONT_STACK
            | STYLE_FIELD_FONT_SIZE
            | STYLE_FIELD_LINE_HEIGHT
            | STYLE_FIELD_RASTER_PIXEL_RATIO
            | STYLE_FIELD_LETTER_SPACING
            | STYLE_FIELD_WORD_SPACING;
        if root.direction != DIRECTION_AUTO {
            mask |= STYLE_FIELD_DIRECTION;
            self.bytes[record + abi::ENGINE_STYLE_MUTATION_DIRECTION] = root.direction;
        }
        self.style_record(record, ROOT_STYLE_ID, 0, length, mask);
        self.bytes[record + abi::ENGINE_STYLE_MUTATION_FLAGS] = STYLE_FLAG_ROOT;
        self.u32(
            record + abi::ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE,
            FIRST_STACK_HANDLE + root.font_stack,
        );
        let floats = [
            (abi::ENGINE_STYLE_MUTATION_FONT_SIZE, root.font_size),
            (abi::ENGINE_STYLE_MUTATION_LINE_HEIGHT, root.line_height),
            (abi::ENGINE_STYLE_MUTATION_RASTER_PIXEL_RATIO, 1.0),
            (
                abi::ENGINE_STYLE_MUTATION_LETTER_SPACING,
                root.letter_spacing,
            ),
            (abi::ENGINE_STYLE_MUTATION_WORD_SPACING, root.word_spacing),
        ];
        for (offset, value) in floats {
            self.f32(record + offset, value);
        }
    }

    fn span_style(&mut self, record: usize, span: Span, cascade_order: u32) {
        let style = span.style;
        let mut mask = 0;
        if let Some(stack) = style.font_stack {
            mask |= STYLE_FIELD_FONT_STACK;
            self.u32(
                record + abi::ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE,
                FIRST_STACK_HANDLE + stack,
            );
        }
        let floats = [
            (
                style.font_size,
                STYLE_FIELD_FONT_SIZE,
                abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
            ),
            (
                style.letter_spacing,
                STYLE_FIELD_LETTER_SPACING,
                abi::ENGINE_STYLE_MUTATION_LETTER_SPACING,
            ),
            (
                style.baseline_shift,
                STYLE_FIELD_BASELINE_SHIFT,
                abi::ENGINE_STYLE_MUTATION_BASELINE_SHIFT,
            ),
        ];
        for (value, field, offset) in floats {
            if let Some(value) = value {
                mask |= field;
                self.f32(record + offset, value);
            }
        }
        if let Some(foreground) = style.foreground {
            mask |= STYLE_FIELD_FOREGROUND;
            self.u32(
                record + abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA,
                foreground,
            );
        }
        if style.underline {
            mask |= STYLE_FIELD_DECORATION;
            self.bytes[record + abi::ENGINE_STYLE_MUTATION_DECORATION_STYLE] = DECORATION_SOLID;
            self.u32(
                record + abi::ENGINE_STYLE_MUTATION_DECORATION_FLAGS,
                DECORATION_UNDERLINE,
            );
            self.u32(
                record + abi::ENGINE_STYLE_MUTATION_DECORATION_RGBA,
                u32::MAX,
            );
            self.f32(
                record + abi::ENGINE_STYLE_MUTATION_DECORATION_THICKNESS,
                1.0,
            );
        }
        self.style_record(record, span.id, span.start, span.end, mask);
        self.u32(
            record + abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER,
            cascade_order,
        );
    }

    fn geometry(&mut self, layout: &Layout, revision: u32) {
        let inline_end = bounded(layout.width);
        let block_end = bounded(layout.height);
        let constraint = self.table(
            1,
            abi::ENGINE_CONSTRAINT_RECORD_SIZE,
            abi::ENGINE_CONSTRAINT_RECORD_ALIGNMENT,
        );
        self.header(
            abi::ENGINE_UPDATE_CONSTRAINTS_OFFSET,
            abi::ENGINE_UPDATE_CONSTRAINT_COUNT,
            constraint,
            1,
        );
        self.constraint(constraint, layout, revision, block_end);
        let region = self.table(
            1,
            abi::ENGINE_REGION_RECORD_SIZE,
            abi::ENGINE_REGION_RECORD_ALIGNMENT,
        );
        self.header(
            abi::ENGINE_UPDATE_REGIONS_OFFSET,
            abi::ENGINE_UPDATE_REGION_COUNT,
            region,
            1,
        );
        self.region(region, revision, inline_end, block_end);
        if let Some(exclusion) = layout.exclusion {
            self.u16(region + abi::ENGINE_REGION_EXCLUSION_COUNT, 1);
            let record = self.table(
                1,
                abi::ENGINE_EXCLUSION_RECORD_SIZE,
                abi::ENGINE_EXCLUSION_RECORD_ALIGNMENT,
            );
            self.header(
                abi::ENGINE_UPDATE_EXCLUSIONS_OFFSET,
                abi::ENGINE_UPDATE_EXCLUSION_COUNT,
                record,
                1,
            );
            self.exclusion(record, exclusion, revision);
        }
    }

    fn constraint(&mut self, record: usize, layout: &Layout, revision: u32, block_end: f32) {
        self.u32(record + abi::ENGINE_CONSTRAINT_PARAGRAPH_ID, PARAGRAPH_ID);
        self.u32(record + abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID, 1);
        self.u32(record + abi::ENGINE_CONSTRAINT_GEOMETRY_REVISION, revision);
        self.u32(record + abi::ENGINE_CONSTRAINT_MAX_LINES, layout.max_lines);
        self.u16(record + abi::ENGINE_CONSTRAINT_REGION_COUNT, 1);
        let floats = [
            (abi::ENGINE_CONSTRAINT_WIDTH, layout.width),
            (abi::ENGINE_CONSTRAINT_HEIGHT, layout.height),
            (abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END, block_end),
            (
                abi::ENGINE_CONSTRAINT_FIRST_LINE_INDENT,
                layout.first_line_indent,
            ),
        ];
        for (offset, value) in floats {
            self.f32(record + offset, value);
        }
        let bytes = [
            (abi::ENGINE_CONSTRAINT_WIDTH_MODE, axis_mode(layout.width)),
            (abi::ENGINE_CONSTRAINT_HEIGHT_MODE, axis_mode(layout.height)),
            (abi::ENGINE_CONSTRAINT_WRAP, layout.wrap),
            (abi::ENGINE_CONSTRAINT_ALIGN, layout.align),
            (abi::ENGINE_CONSTRAINT_OVERFLOW, layout.overflow),
            (abi::ENGINE_CONSTRAINT_BLOCK_ALIGN, BLOCK_ALIGN_START),
            (
                abi::ENGINE_CONSTRAINT_LAST_LINE,
                if layout.justify_last_line {
                    LAST_LINE_JUSTIFY
                } else {
                    LAST_LINE_AUTO
                },
            ),
        ];
        for (offset, value) in bytes {
            self.bytes[record + offset] = value;
        }
        if layout.drop_cap_lines != 0 {
            self.bytes[record + abi::ENGINE_CONSTRAINT_DROP_CAP_LINES] = layout.drop_cap_lines;
            self.bytes[record + abi::ENGINE_CONSTRAINT_DROP_CAP_ALIGNMENT] =
                DROP_CAP_ALIGN_BASELINE;
            self.bytes[record + abi::ENGINE_CONSTRAINT_DROP_CAP_SIDE] = DROP_CAP_SIDE_INLINE_START;
        }
    }

    fn region(&mut self, record: usize, revision: u32, inline_end: f32, block_end: f32) {
        self.u32(record + abi::ENGINE_REGION_ID, 1);
        self.u32(record + abi::ENGINE_REGION_GEOMETRY_REVISION, revision);
        self.u32(record + abi::ENGINE_REGION_TRANSFORM_INDEX, 1);
        self.bytes[record + abi::ENGINE_REGION_SHAPE] = SHAPE_RECTANGLE;
        self.bytes[record + abi::ENGINE_REGION_WRITING_MODE] = WRITING_HORIZONTAL_TB;
        self.bytes[record + abi::ENGINE_REGION_TEXT_ORIENTATION] = ORIENTATION_MIXED;
        let floats = [
            (abi::ENGINE_REGION_INLINE_END, inline_end),
            (abi::ENGINE_REGION_BLOCK_END, block_end),
            (abi::ENGINE_REGION_CLIP_INLINE_END, inline_end),
            (abi::ENGINE_REGION_CLIP_BLOCK_END, block_end),
        ];
        for (offset, value) in floats {
            self.f32(record + offset, value);
        }
    }

    fn exclusion(&mut self, record: usize, exclusion: Exclusion, revision: u32) {
        self.u32(record + abi::ENGINE_EXCLUSION_ID, 2);
        self.u32(record + abi::ENGINE_EXCLUSION_REGION_ID, 1);
        self.u32(record + abi::ENGINE_EXCLUSION_GEOMETRY_REVISION, revision);
        self.bytes[record + abi::ENGINE_EXCLUSION_WRAP_SIDE] = EXCLUSION_WRAP_BOTH;
        let floats = [
            (abi::ENGINE_EXCLUSION_INLINE_START, exclusion.inline_start),
            (abi::ENGINE_EXCLUSION_INLINE_END, exclusion.inline_end),
            (abi::ENGINE_EXCLUSION_BLOCK_START, exclusion.block_start),
            (abi::ENGINE_EXCLUSION_BLOCK_END, exclusion.block_end),
        ];
        for (offset, value) in floats {
            self.f32(record + offset, value);
        }
        if !exclusion.polygon {
            self.bytes[record + abi::ENGINE_EXCLUSION_SHAPE] = SHAPE_RECTANGLE;
            return;
        }
        self.bytes[record + abi::ENGINE_EXCLUSION_SHAPE] = SHAPE_POLYGON;
        let inline_middle = (exclusion.inline_start + exclusion.inline_end) / 2.0;
        let block_middle = (exclusion.block_start + exclusion.block_end) / 2.0;
        let diamond = [
            (inline_middle, exclusion.block_start),
            (exclusion.inline_end, block_middle),
            (inline_middle, exclusion.block_end),
            (exclusion.inline_start, block_middle),
        ];
        let stride = abi::ENGINE_FLOW_VERTEX_RECORD_SIZE;
        let vertices = self.table(
            diamond.len(),
            stride,
            abi::ENGINE_FLOW_VERTEX_RECORD_ALIGNMENT,
        );
        self.u32(
            record + abi::ENGINE_EXCLUSION_VERTICES_OFFSET,
            vertices as u32,
        );
        self.u16(
            record + abi::ENGINE_EXCLUSION_VERTEX_COUNT,
            diamond.len() as u16,
        );
        for (index, (inline, block)) in diamond.into_iter().enumerate() {
            let vertex = vertices + index * stride as usize;
            self.f32(vertex + abi::ENGINE_FLOW_VERTEX_INLINE, inline);
            self.f32(vertex + abi::ENGINE_FLOW_VERTEX_BLOCK, block);
        }
    }

    fn finish(mut self) -> Vec<u8> {
        let length = self.bytes.len() as u32;
        write_u32(&mut self.bytes, abi::ENGINE_UPDATE_BYTE_LENGTH, length);
        self.bytes
    }
}

fn axis_mode(extent: f32) -> u8 {
    if extent == 0.0 {
        AXIS_UNCONSTRAINED
    } else {
        AXIS_EXACT
    }
}

fn bounded(extent: f32) -> f32 {
    if extent == 0.0 {
        UNBOUNDED_EXTENT
    } else {
        extent
    }
}
