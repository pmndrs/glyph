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
        OVERFLOW_VISIBLE, PARAGRAPH_MUTATION_REMOVE, PARAGRAPH_MUTATION_UPSERT, SHAPE_POLYGON,
        SHAPE_RECTANGLE, STYLE_FIELD_BASELINE_SHIFT, STYLE_FIELD_DECORATION, STYLE_FIELD_DIRECTION,
        STYLE_FIELD_FONT_SIZE, STYLE_FIELD_FONT_STACK, STYLE_FIELD_FOREGROUND,
        STYLE_FIELD_LETTER_SPACING, STYLE_FIELD_LINE_HEIGHT, STYLE_FIELD_MATERIAL,
        STYLE_FIELD_OPACITY, STYLE_FIELD_OUTLINE, STYLE_FIELD_RASTER_PIXEL_RATIO,
        STYLE_FIELD_SHADOW, STYLE_FIELD_WORD_SPACING, STYLE_FLAG_ROOT, STYLE_MUTATION_REMOVE,
        STYLE_MUTATION_UPSERT, TEXT_ENCODING_UTF16_LE, TEXT_MUTATION_REPLACE_UTF16, WRAP_WORD,
        WRITING_HORIZONTAL_TB,
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

/// One decoration group: which lines, how they are drawn, and their colour.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Decoration {
    /// `DECORATION_UNDERLINE | DECORATION_OVERLINE | DECORATION_LINE_THROUGH | DECORATION_SKIP_INK`.
    pub flags: u32,
    /// `DECORATION_SOLID` and friends.
    pub style: u8,
    pub rgba: u32,
    pub thickness: f32,
    pub offset: f32,
}

/// What a style declares about how its text is painted, as opposed to laid out. Every field
/// is optional and an unset field writes nothing, so a style without paint encodes exactly as
/// it did before paint existed.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Paint {
    pub material: Option<u32>,
    pub foreground: Option<u32>,
    pub opacity: Option<f32>,
    pub decoration: Option<Decoration>,
    /// Colour and width.
    pub outline: Option<(u32, f32)>,
    /// Colour and inline, block offset.
    pub shadow: Option<(u32, f32, f32)>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RootStyle {
    pub font_stack: u32,
    pub font_size: f32,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub word_spacing: f32,
    pub direction: u8,
    pub paint: Paint,
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
            paint: Paint::default(),
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
    /// Paint beyond the two legacy fields above; a decoration here replaces `underline`.
    pub paint: Paint,
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
    /// The regions the paragraph flows through, in order.
    pub regions: Regions,
}

/// One region box in the paragraph's own coordinates.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RegionBox {
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_end: f32,
    pub block_end: f32,
}

/// Where a paragraph's lines may go. Flow leaves a region for the next only when the region
/// is full, so anything but `Single` needs a bounded height.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Regions {
    /// One region the size of the constraint: what every case frozen before regions has.
    #[default]
    Single,
    /// Equal columns across the width, as the host derives them from `columns` and `gap`.
    Columns { count: u8, gap: f32 },
    /// Explicit boxes, the first `count` of them.
    Boxes { boxes: [RegionBox; 3], count: u8 },
}

impl Layout {
    /// The region boxes this layout flows through.
    pub fn region_boxes(&self) -> Vec<RegionBox> {
        let inline_end = bounded(self.width);
        let block_end = bounded(self.height);
        match self.regions {
            Regions::Single => vec![RegionBox {
                inline_start: 0.0,
                block_start: 0.0,
                inline_end,
                block_end,
            }],
            Regions::Columns { count, gap } => {
                let count = count.max(1);
                let width = (inline_end - gap * f32::from(count - 1)) / f32::from(count);
                (0..count)
                    .map(|column| {
                        let inline_start = f32::from(column) * (width + gap);
                        RegionBox {
                            inline_start,
                            block_start: 0.0,
                            // The last column ends exactly at the measure, as the host's does.
                            inline_end: if column == count - 1 {
                                inline_end
                            } else {
                                inline_start + width
                            },
                            block_end,
                        }
                    })
                    .collect()
            }
            Regions::Boxes { boxes, count } => boxes[..usize::from(count.clamp(1, 3))].to_vec(),
        }
    }
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
            regions: Regions::Single,
        }
    }
}

/// A box the host reserves in the line at a text offset. The engine at this commit validates
/// and routes these records and no layout stage reads them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InlineObject {
    pub text_offset: u32,
    pub inline_extent: f32,
    pub block_extent: f32,
    pub baseline_offset: f32,
    /// `BASELINE_ALPHABETIC` and friends.
    pub baseline_alignment: u8,
    pub margin_inline: f32,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Model {
    pub text: Vec<u16>,
    pub root: RootStyle,
    pub spans: Vec<Span>,
    pub layout: Layout,
    pub inline_objects: Vec<InlineObject>,
}

impl Model {
    /// Whether the geometry a host sends for `self` differs from what it sent for `previous`:
    /// the constraint, its regions and exclusions, and the inline objects that ride with them.
    pub fn geometry_differs(&self, previous: &Self) -> bool {
        self.layout != previous.layout || self.inline_objects != previous.inline_objects
    }
}

/// One paragraph of a root: its identity, where it sorts among its siblings, and its input.
#[derive(Clone, Debug, PartialEq)]
pub struct Paragraph {
    pub id: u32,
    /// Unique among live paragraphs; lower draws first.
    pub order: u32,
    /// The scoped order a host sets with `updateOrder`: a scope and a rank within it.
    pub scope: u32,
    pub rank: f64,
    pub model: Model,
}

/// Every paragraph of one root.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Document {
    pub paragraphs: Vec<Paragraph>,
    /// Whether paragraphs are created, ordered and removed by lifecycle records. A document
    /// that is not is the single implicit paragraph every case frozen before documents has.
    pub explicit: bool,
    /// The highest paragraph id the document has ever held: a host never reuses an identity.
    pub minted: u32,
}

impl Document {
    /// The one implicit paragraph.
    pub fn single(model: Model) -> Self {
        Self {
            paragraphs: vec![Paragraph {
                id: PARAGRAPH_ID,
                order: 0,
                scope: 0,
                rank: 0.0,
                model,
            }],
            explicit: false,
            minted: PARAGRAPH_ID,
        }
    }

    pub fn paragraph(&self, id: u32) -> Option<&Paragraph> {
        self.paragraphs.iter().find(|paragraph| paragraph.id == id)
    }

    pub fn paragraph_mut(&mut self, id: u32) -> Option<&mut Paragraph> {
        self.paragraphs
            .iter_mut()
            .find(|paragraph| paragraph.id == id)
    }

    /// Paragraph ids in ascending order: the order the engine routes records in.
    pub fn ids(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self
            .paragraphs
            .iter()
            .map(|paragraph| paragraph.id)
            .collect();
        ids.sort_unstable();
        ids
    }
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

/// The revisions and views one request states.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RequestHeader {
    pub engine_revision: u32,
    pub root_revision: u32,
    pub acknowledged_generation: u32,
    pub view_mask: u32,
}

/// The bounds a request declares, derived from the whole document the way the host derives
/// them from its live texts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub paragraphs: u32,
    /// UTF-16 units over every paragraph.
    pub text: u32,
    /// UTF-16 units of the longest paragraph.
    pub longest: u32,
    pub regions: u32,
    pub exclusions: u32,
    pub inline_objects: u32,
}

impl Limits {
    pub fn of(document: &Document) -> Self {
        let models = || document.paragraphs.iter().map(|paragraph| &paragraph.model);
        let count = |length: usize| u32::try_from(length).unwrap_or(u32::MAX);
        Self {
            paragraphs: count(document.paragraphs.len()),
            text: count(models().map(|model| model.text.len()).sum()),
            longest: count(models().map(|model| model.text.len()).max().unwrap_or(0)),
            regions: count(
                models()
                    .map(|model| model.layout.region_boxes().len())
                    .sum(),
            ),
            exclusions: count(
                models()
                    .filter(|model| model.layout.exclusion.is_some())
                    .count(),
            ),
            inline_objects: count(models().map(|model| model.inline_objects.len()).sum()),
        }
    }

    /// Bounds that hold for both documents of a step: the host's limits cover the texts that
    /// are live while the request is written, the ones it is about to remove included.
    pub fn covering(self, other: Self) -> Self {
        Self {
            paragraphs: self.paragraphs.max(other.paragraphs),
            text: self.text.max(other.text),
            longest: self.longest.max(other.longest),
            regions: self.regions.max(other.regions),
            exclusions: self.exclusions.max(other.exclusions),
            inline_objects: self.inline_objects.max(other.inline_objects),
        }
    }
}

/// What one request changes about one paragraph. `edits` are applied in order, each against
/// the text the one before it left, and together are the text difference from `previous`;
/// with no `previous` the whole text is one insertion.
#[derive(Clone, Copy, Debug)]
pub struct Change<'a> {
    pub id: u32,
    pub previous: Option<&'a Model>,
    pub next: &'a Model,
    pub edits: &'a [TextEdit],
    pub geometry_revision: u32,
}

/// Paragraph lifecycle records, in the order the host writes them: removals, then upserts.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Lifecycle {
    pub removes: Vec<u32>,
    /// `(paragraph, order)`.
    pub upserts: Vec<(u32, u32)>,
    /// `(paragraph, scope, rank)`.
    pub orders: Vec<(u32, u32, f64)>,
}

/// One request: lifecycle records, then every change's text, styles and geometry. `changes`
/// must be in ascending paragraph order, which is how the engine routes records.
pub fn request(
    header: RequestHeader,
    limits: Limits,
    lifecycle: &Lifecycle,
    changes: &[Change<'_>],
) -> Vec<u8> {
    let mut writer = RequestWriter::new(header, limits);
    writer.lifecycle(lifecycle);
    writer.text(changes);
    writer.styles(changes);
    let geometry: Vec<Change<'_>> = changes
        .iter()
        .copied()
        .filter(|change| {
            change
                .previous
                .is_none_or(|previous| change.next.geometry_differs(previous))
        })
        .collect();
    writer.geometry(&geometry);
    writer.inline_objects(&geometry);
    writer.finish()
}

struct RequestWriter {
    bytes: Vec<u8>,
}

impl RequestWriter {
    fn new(header: RequestHeader, limits: Limits) -> Self {
        let mut bytes = vec![0_u8; abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize];
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
            (abi::ENGINE_UPDATE_MAX_PARAGRAPHS, limits.paragraphs.max(1)),
            // The host's limits: twice the text for clusters, the longest text for lines.
            (
                abi::ENGINE_UPDATE_MAX_CLUSTERS,
                limits.text.saturating_mul(2).max(256),
            ),
            (abi::ENGINE_UPDATE_MAX_LINES, limits.longest.max(256)),
            (abi::ENGINE_UPDATE_MAX_REGIONS, limits.regions.max(1)),
            (abi::ENGINE_UPDATE_MAX_EXCLUSIONS, limits.exclusions.max(1)),
            (
                abi::ENGINE_UPDATE_MAX_INLINE_OBJECTS,
                limits.inline_objects.max(1),
            ),
            (abi::ENGINE_UPDATE_MAX_SLOTS_PER_BAND, 8),
            (abi::ENGINE_UPDATE_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES),
        ];
        for (offset, value) in fields {
            write_u32(&mut bytes, offset, value);
        }
        Self { bytes }
    }

    fn lifecycle(&mut self, lifecycle: &Lifecycle) {
        let count = lifecycle.removes.len() + lifecycle.upserts.len();
        if count != 0 {
            let stride = abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE;
            let table = self.table(
                count,
                stride,
                abi::ENGINE_PARAGRAPH_MUTATION_RECORD_ALIGNMENT,
            );
            self.header(
                abi::ENGINE_UPDATE_PARAGRAPH_MUTATIONS_OFFSET,
                abi::ENGINE_UPDATE_PARAGRAPH_MUTATION_COUNT,
                table,
                count,
            );
            let removes = lifecycle
                .removes
                .iter()
                .map(|id| (PARAGRAPH_MUTATION_REMOVE, *id, 0));
            let upserts = lifecycle
                .upserts
                .iter()
                .map(|(id, order)| (PARAGRAPH_MUTATION_UPSERT, *id, *order));
            for (index, (opcode, id, order)) in removes.chain(upserts).enumerate() {
                let record = table + index * stride as usize;
                self.bytes[record + abi::ENGINE_PARAGRAPH_MUTATION_OPCODE] = opcode;
                self.u32(record + abi::ENGINE_PARAGRAPH_MUTATION_PARAGRAPH_ID, id);
                self.u32(record + abi::ENGINE_PARAGRAPH_MUTATION_ORDER, order);
            }
        }
        if !lifecycle.orders.is_empty() {
            let stride = abi::ENGINE_PARAGRAPH_ORDER_MUTATION_RECORD_SIZE;
            let table = self.table(
                lifecycle.orders.len(),
                stride,
                abi::ENGINE_PARAGRAPH_ORDER_MUTATION_RECORD_ALIGNMENT,
            );
            self.header(
                abi::ENGINE_UPDATE_PARAGRAPH_ORDER_MUTATIONS_OFFSET,
                abi::ENGINE_UPDATE_PARAGRAPH_ORDER_MUTATION_COUNT,
                table,
                lifecycle.orders.len(),
            );
            for (index, (id, scope, rank)) in lifecycle.orders.iter().enumerate() {
                let record = table + index * stride as usize;
                self.u32(
                    record + abi::ENGINE_PARAGRAPH_ORDER_MUTATION_PARAGRAPH_ID,
                    *id,
                );
                self.u32(
                    record + abi::ENGINE_PARAGRAPH_ORDER_MUTATION_ORDER_SCOPE,
                    *scope,
                );
                let at = record + abi::ENGINE_PARAGRAPH_ORDER_MUTATION_ORDER_RANK;
                self.bytes[at..at + 8].copy_from_slice(&rank.to_bits().to_le_bytes());
            }
        }
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

    fn text(&mut self, changes: &[Change<'_>]) {
        // A paragraph new to the engine inserts its whole text as one edit.
        let whole: Vec<TextEdit> = changes
            .iter()
            .map(|change| TextEdit {
                start: 0,
                delete: 0,
                insert: change.next.text.clone(),
            })
            .collect();
        let edits: Vec<(u32, &TextEdit)> = changes
            .iter()
            .zip(&whole)
            .flat_map(|(change, whole)| {
                let edits = match change.previous {
                    None => core::slice::from_ref(whole),
                    Some(_) => change.edits,
                };
                edits.iter().map(|edit| (change.id, edit))
            })
            .collect();
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
        for (index, (paragraph, edit)) in edits.into_iter().enumerate() {
            let record = table + index * stride;
            self.bytes[record + abi::ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
            self.bytes[record + abi::ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
            self.u32(record + abi::ENGINE_TEXT_MUTATION_PARAGRAPH_ID, paragraph);
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

    fn styles(&mut self, changes: &[Change<'_>]) {
        let plans: Vec<StylePlan> = changes.iter().map(StylePlan::new).collect();
        let count: usize = plans.iter().map(StylePlan::records).sum();
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
        for (change, plan) in changes.iter().zip(plans) {
            // Removals first: a removed span must not constrain the nesting of what replaces it.
            for id in plan.removed {
                self.bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_REMOVE;
                self.u32(record + abi::ENGINE_STYLE_MUTATION_STYLE_ID, id);
                self.u32(record + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID, change.id);
                record += stride as usize;
            }
            if plan.root {
                let length = change.next.text.len() as u32;
                self.root_style(record, change.id, change.next.root, length);
                record += stride as usize;
            }
            for span in plan.upserted {
                // A span's cascade order is its id: stable across the edits that move other
                // spans, so an edit history and a cold layout resolve nested spans the same way.
                self.span_style(record, change.id, span, span.id);
                record += stride as usize;
            }
        }
    }

    fn style_record(
        &mut self,
        record: usize,
        (paragraph, id): (u32, u32),
        (start, end): (u32, u32),
        mask: u32,
    ) {
        self.bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
        self.u32(record + abi::ENGINE_STYLE_MUTATION_STYLE_ID, id);
        self.u32(record + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID, paragraph);
        self.u32(record + abi::ENGINE_STYLE_MUTATION_TEXT_START, start);
        self.u32(record + abi::ENGINE_STYLE_MUTATION_TEXT_END, end);
        self.u32(record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK, mask);
    }

    fn root_style(&mut self, record: usize, paragraph: u32, root: RootStyle, length: u32) {
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
        mask |= self.paint(record, root.paint);
        self.style_record(record, (paragraph, ROOT_STYLE_ID), (0, length), mask);
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

    fn span_style(&mut self, record: usize, paragraph: u32, span: Span, cascade_order: u32) {
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
        mask |= self.paint(record, style.paint);
        self.style_record(record, (paragraph, span.id), (span.start, span.end), mask);
        self.u32(
            record + abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER,
            cascade_order,
        );
    }

    /// Writes the paint fields that are set and returns their field mask.
    fn paint(&mut self, record: usize, paint: Paint) -> u32 {
        let mut mask = 0;
        let words = [
            (
                paint.material,
                STYLE_FIELD_MATERIAL,
                abi::ENGINE_STYLE_MUTATION_MATERIAL_ID,
            ),
            (
                paint.foreground,
                STYLE_FIELD_FOREGROUND,
                abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA,
            ),
            (
                paint.opacity.map(f32::to_bits),
                STYLE_FIELD_OPACITY,
                abi::ENGINE_STYLE_MUTATION_OPACITY,
            ),
        ];
        for (value, field, offset) in words {
            if let Some(value) = value {
                mask |= field;
                self.u32(record + offset, value);
            }
        }
        if let Some(decoration) = paint.decoration {
            mask |= STYLE_FIELD_DECORATION;
            self.bytes[record + abi::ENGINE_STYLE_MUTATION_DECORATION_STYLE] = decoration.style;
            self.u32(
                record + abi::ENGINE_STYLE_MUTATION_DECORATION_FLAGS,
                decoration.flags,
            );
            self.u32(
                record + abi::ENGINE_STYLE_MUTATION_DECORATION_RGBA,
                decoration.rgba,
            );
            self.f32(
                record + abi::ENGINE_STYLE_MUTATION_DECORATION_THICKNESS,
                decoration.thickness,
            );
            self.f32(
                record + abi::ENGINE_STYLE_MUTATION_DECORATION_OFFSET,
                decoration.offset,
            );
        }
        if let Some((rgba, width)) = paint.outline {
            mask |= STYLE_FIELD_OUTLINE;
            self.u32(record + abi::ENGINE_STYLE_MUTATION_OUTLINE_RGBA, rgba);
            self.f32(record + abi::ENGINE_STYLE_MUTATION_OUTLINE_WIDTH, width);
        }
        if let Some((rgba, inline, block)) = paint.shadow {
            mask |= STYLE_FIELD_SHADOW;
            self.u32(record + abi::ENGINE_STYLE_MUTATION_SHADOW_RGBA, rgba);
            self.f32(record + abi::ENGINE_STYLE_MUTATION_SHADOW_OFFSET_X, inline);
            self.f32(record + abi::ENGINE_STYLE_MUTATION_SHADOW_OFFSET_Y, block);
        }
        mask
    }

    /// Constraints, then every region, then every exclusion: three tables, each paragraph's
    /// constraint naming its run of the region table.
    fn geometry(&mut self, changes: &[Change<'_>]) {
        if changes.is_empty() {
            return;
        }
        let boxes: Vec<Vec<RegionBox>> = changes
            .iter()
            .map(|change| change.next.layout.region_boxes())
            .collect();
        let constraints = self.table(
            changes.len(),
            abi::ENGINE_CONSTRAINT_RECORD_SIZE,
            abi::ENGINE_CONSTRAINT_RECORD_ALIGNMENT,
        );
        self.header(
            abi::ENGINE_UPDATE_CONSTRAINTS_OFFSET,
            abi::ENGINE_UPDATE_CONSTRAINT_COUNT,
            constraints,
            changes.len(),
        );
        let region_count: usize = boxes.iter().map(Vec::len).sum();
        let regions = self.table(
            region_count,
            abi::ENGINE_REGION_RECORD_SIZE,
            abi::ENGINE_REGION_RECORD_ALIGNMENT,
        );
        self.header(
            abi::ENGINE_UPDATE_REGIONS_OFFSET,
            abi::ENGINE_UPDATE_REGION_COUNT,
            regions,
            region_count,
        );
        let mut region_index = 0;
        // `(exclusion, its region record, its region id, its paragraph, revision)`.
        let mut exclusions = Vec::new();
        for (index, (change, boxes)) in changes.iter().zip(&boxes).enumerate() {
            let layout = &change.next.layout;
            let record = constraints + index * abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
            self.constraint(record, change, (region_index, boxes.len()));
            for (column, region_box) in boxes.iter().enumerate() {
                let region = regions + region_index * abi::ENGINE_REGION_RECORD_SIZE as usize;
                let id = region_id(change.id, layout, column);
                self.region(
                    region,
                    (change.id, id),
                    change.geometry_revision,
                    *region_box,
                );
                // An exclusion belongs to the first region.
                if let (0, Some(exclusion)) = (column, layout.exclusion) {
                    self.u16(region + abi::ENGINE_REGION_EXCLUSION_COUNT, 1);
                    self.u16(
                        region + abi::ENGINE_REGION_EXCLUSION_START,
                        exclusions.len() as u16,
                    );
                    exclusions.push((exclusion, id, change.id, change.geometry_revision));
                }
                region_index += 1;
            }
        }
        if exclusions.is_empty() {
            return;
        }
        let stride = abi::ENGINE_EXCLUSION_RECORD_SIZE;
        let table = self.table(
            exclusions.len(),
            stride,
            abi::ENGINE_EXCLUSION_RECORD_ALIGNMENT,
        );
        self.header(
            abi::ENGINE_UPDATE_EXCLUSIONS_OFFSET,
            abi::ENGINE_UPDATE_EXCLUSION_COUNT,
            table,
            exclusions.len(),
        );
        for (index, (exclusion, region, paragraph, revision)) in exclusions.into_iter().enumerate()
        {
            let record = table + index * stride as usize;
            self.exclusion(
                record,
                exclusion,
                (exclusion_id(paragraph), region),
                revision,
            );
        }
    }

    fn constraint(
        &mut self,
        record: usize,
        change: &Change<'_>,
        (region_start, regions): (usize, usize),
    ) {
        let layout = &change.next.layout;
        self.u32(record + abi::ENGINE_CONSTRAINT_PARAGRAPH_ID, change.id);
        self.u32(record + abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID, change.id);
        self.u32(
            record + abi::ENGINE_CONSTRAINT_GEOMETRY_REVISION,
            change.geometry_revision,
        );
        self.u32(record + abi::ENGINE_CONSTRAINT_MAX_LINES, layout.max_lines);
        self.u32(
            record + abi::ENGINE_CONSTRAINT_REGION_START,
            region_start as u32,
        );
        self.u16(record + abi::ENGINE_CONSTRAINT_REGION_COUNT, regions as u16);
        let floats = [
            (abi::ENGINE_CONSTRAINT_WIDTH, layout.width),
            (abi::ENGINE_CONSTRAINT_HEIGHT, layout.height),
            (
                abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
                bounded(layout.height),
            ),
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

    fn region(
        &mut self,
        record: usize,
        (paragraph, id): (u32, u32),
        revision: u32,
        region: RegionBox,
    ) {
        self.u32(record + abi::ENGINE_REGION_ID, id);
        self.u32(record + abi::ENGINE_REGION_GEOMETRY_REVISION, revision);
        // Each paragraph has its own transform, as each host text does.
        self.u32(record + abi::ENGINE_REGION_TRANSFORM_INDEX, paragraph);
        self.bytes[record + abi::ENGINE_REGION_SHAPE] = SHAPE_RECTANGLE;
        self.bytes[record + abi::ENGINE_REGION_WRITING_MODE] = WRITING_HORIZONTAL_TB;
        self.bytes[record + abi::ENGINE_REGION_TEXT_ORIENTATION] = ORIENTATION_MIXED;
        let floats = [
            (abi::ENGINE_REGION_INLINE_START, region.inline_start),
            (abi::ENGINE_REGION_BLOCK_START, region.block_start),
            (abi::ENGINE_REGION_INLINE_END, region.inline_end),
            (abi::ENGINE_REGION_BLOCK_END, region.block_end),
            (abi::ENGINE_REGION_CLIP_INLINE_START, region.inline_start),
            (abi::ENGINE_REGION_CLIP_BLOCK_START, region.block_start),
            (abi::ENGINE_REGION_CLIP_INLINE_END, region.inline_end),
            (abi::ENGINE_REGION_CLIP_BLOCK_END, region.block_end),
        ];
        for (offset, value) in floats {
            self.f32(record + offset, value);
        }
    }

    fn exclusion(
        &mut self,
        record: usize,
        exclusion: Exclusion,
        (id, region): (u32, u32),
        revision: u32,
    ) {
        self.u32(record + abi::ENGINE_EXCLUSION_ID, id);
        self.u32(record + abi::ENGINE_EXCLUSION_REGION_ID, region);
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

    /// Inline objects ride with their paragraph's geometry, as the host sends them.
    fn inline_objects(&mut self, changes: &[Change<'_>]) {
        let objects: Vec<(u32, u32, usize, InlineObject)> = changes
            .iter()
            .flat_map(|change| {
                change
                    .next
                    .inline_objects
                    .iter()
                    .enumerate()
                    .map(|(index, object)| (change.id, change.geometry_revision, index, *object))
            })
            .collect();
        if objects.is_empty() {
            return;
        }
        let stride = abi::ENGINE_INLINE_OBJECT_RECORD_SIZE;
        let table = self.table(
            objects.len(),
            stride,
            abi::ENGINE_INLINE_OBJECT_RECORD_ALIGNMENT,
        );
        self.header(
            abi::ENGINE_UPDATE_INLINE_OBJECTS_OFFSET,
            abi::ENGINE_UPDATE_INLINE_OBJECT_COUNT,
            table,
            objects.len(),
        );
        for (row, (paragraph, revision, index, object)) in objects.into_iter().enumerate() {
            let record = table + row * stride as usize;
            let words = [
                (
                    abi::ENGINE_INLINE_OBJECT_ID,
                    paragraph * 64 + index as u32 + 1,
                ),
                (abi::ENGINE_INLINE_OBJECT_CONTENT_REVISION, revision),
                (abi::ENGINE_INLINE_OBJECT_TEXT_OFFSET, object.text_offset),
                (abi::ENGINE_INLINE_OBJECT_RESOURCE_ID, 1),
                (abi::ENGINE_INLINE_OBJECT_RESOURCE_GENERATION, 1),
                (abi::ENGINE_INLINE_OBJECT_PARAGRAPH_ID, paragraph),
            ];
            for (offset, value) in words {
                self.u32(record + offset, value);
            }
            let floats = [
                (
                    abi::ENGINE_INLINE_OBJECT_INLINE_EXTENT,
                    object.inline_extent,
                ),
                (abi::ENGINE_INLINE_OBJECT_BLOCK_EXTENT, object.block_extent),
                (
                    abi::ENGINE_INLINE_OBJECT_BASELINE_OFFSET,
                    object.baseline_offset,
                ),
                (
                    abi::ENGINE_INLINE_OBJECT_MARGIN_INLINE_START,
                    object.margin_inline,
                ),
                (
                    abi::ENGINE_INLINE_OBJECT_MARGIN_INLINE_END,
                    object.margin_inline,
                ),
            ];
            for (offset, value) in floats {
                self.f32(record + offset, value);
            }
            self.bytes[record + abi::ENGINE_INLINE_OBJECT_BASELINE_ALIGNMENT] =
                object.baseline_alignment;
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

/// Which style records one change writes.
struct StylePlan {
    removed: Vec<u32>,
    root: bool,
    upserted: Vec<Span>,
}

impl StylePlan {
    fn new(change: &Change<'_>) -> Self {
        let (previous, next) = (change.previous, change.next);
        Self {
            // The root style spans the whole text, so a length change restates it.
            root: previous.is_none_or(|previous| {
                previous.root != next.root || previous.text.len() != next.text.len()
            }),
            removed: previous.map_or_else(Vec::new, |previous| {
                previous
                    .spans
                    .iter()
                    .filter(|old| !next.spans.iter().any(|span| span.id == old.id))
                    .map(|old| old.id)
                    .collect()
            }),
            upserted: next
                .spans
                .iter()
                .copied()
                .filter(|span| {
                    previous.is_none_or(|previous| !previous.spans.iter().any(|old| old == span))
                })
                .collect(),
        }
    }

    fn records(&self) -> usize {
        usize::from(self.root) + self.removed.len() + self.upserted.len()
    }
}

/// Region ids are unique across the root. The first paragraph's single region keeps the id it
/// had before paragraphs and regions were modelled.
fn region_id(paragraph: u32, layout: &Layout, column: usize) -> u32 {
    let base = (paragraph - 1) * 64;
    match layout.regions {
        Regions::Single => base + 1,
        _ => base + 10 + column as u32,
    }
}

/// Exclusion ids, likewise unique, with the first paragraph's unchanged.
fn exclusion_id(paragraph: u32) -> u32 {
    (paragraph - 1) * 64 + 2
}
