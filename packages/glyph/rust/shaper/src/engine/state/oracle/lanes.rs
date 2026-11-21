//! Named, typed lanes: the oracle's only representation of engine output.
//!
//! A lane is one logical column (`cluster.advance_units`, `flow.line.baseline`) as little-endian
//! rows. Names and row meaning are frozen; the extraction in `capture.rs` is the adapter that a
//! refactor updates when storage changes shape. Goldens hold one digest per lane; full dumps hold
//! the rows so two dumps can be diffed to the first differing row.

use alloc::{
    format,
    string::{String, ToString},
    vec::Vec,
};
use core::fmt::Write;

/// How a lane participates in the two equalities the oracle proves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaneClass {
    /// Semantic output: equal to the frozen reference and equal between incremental and cold.
    Value,
    /// Internal representation (block cuts, chunk summaries): held to the same two equalities
    /// today, and the class a later unit waives when it changes the representation on purpose.
    Repr,
    /// Allocation-order identity (stable ids, revisions, slots): frozen for a fixed script,
    /// never compared between an edit history and a cold layout.
    Identity,
    /// Encoded publication bytes: a patch after an edit and a checkpoint when cold, so frozen
    /// for a fixed script and never compared between incremental and cold.
    Wire,
    /// A lazily filled cache in groups of [`CACHE_GROUP`] rows whose first row is "present".
    /// Which entries exist follows the history; an entry both sides hold must be equal.
    Cache,
}

/// Rows per cache entry: present, then three payload rows.
pub const CACHE_GROUP: usize = 4;

impl LaneClass {
    const fn tag(self) -> &'static str {
        match self {
            Self::Value => "value",
            Self::Repr => "repr",
            Self::Identity => "identity",
            Self::Wire => "wire",
            Self::Cache => "cache",
        }
    }

    fn from_tag(tag: &str) -> Option<Self> {
        [
            Self::Value,
            Self::Repr,
            Self::Identity,
            Self::Wire,
            Self::Cache,
        ]
        .into_iter()
        .find(|class| class.tag() == tag)
    }

    /// Whether an edit history and a cold layout of the same input must agree on this lane.
    pub const fn history_independent(self) -> bool {
        matches!(self, Self::Value | Self::Repr)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaneKind {
    U8,
    U16,
    U32,
    I32,
    I64,
    F32,
    F64,
}

impl LaneKind {
    const ALL: [Self; 7] = [
        Self::U8,
        Self::U16,
        Self::U32,
        Self::I32,
        Self::I64,
        Self::F32,
        Self::F64,
    ];

    pub const fn width(self) -> usize {
        match self {
            Self::U8 => 1,
            Self::U16 => 2,
            Self::U32 | Self::I32 | Self::F32 => 4,
            Self::I64 | Self::F64 => 8,
        }
    }

    const fn tag(self) -> &'static str {
        match self {
            Self::U8 => "u8",
            Self::U16 => "u16",
            Self::U32 => "u32",
            Self::I32 => "i32",
            Self::I64 => "i64",
            Self::F32 => "f32",
            Self::F64 => "f64",
        }
    }

    fn from_tag(tag: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.tag() == tag)
    }

    /// One row as text. Floats print their value and their bits: the oracle's equality is on bits.
    fn render(self, row: &[u8]) -> String {
        let mut wide = [0_u8; 8];
        wide[..row.len()].copy_from_slice(row);
        let bits = u64::from_le_bytes(wide);
        match self {
            Self::U8 | Self::U16 | Self::U32 => bits.to_string(),
            Self::I32 => (bits as u32 as i32).to_string(),
            Self::I64 => (bits as i64).to_string(),
            Self::F32 => format!("{:?} (0x{:08x})", f32::from_bits(bits as u32), bits),
            Self::F64 => format!("{:?} (0x{:016x})", f64::from_bits(bits), bits),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lane {
    pub name: String,
    pub class: LaneClass,
    pub kind: LaneKind,
    pub bytes: Vec<u8>,
}

impl Lane {
    pub fn rows(&self) -> usize {
        self.bytes.len() / self.kind.width()
    }

    pub fn digest(&self) -> u64 {
        digest(&self.bytes)
    }

    fn row(&self, index: usize) -> Option<&[u8]> {
        let width = self.kind.width();
        self.bytes.get(index * width..(index + 1) * width)
    }

    fn render_row(&self, index: usize) -> String {
        self.row(index)
            .map_or_else(|| "<absent>".to_string(), |row| self.kind.render(row))
    }
}

/// Every lane of one engine state, in capture order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Capture {
    pub lanes: Vec<Lane>,
    /// Prepended to the name of every lane pushed while it is set: the paragraph a lane
    /// belongs to, for every paragraph but the first.
    pub prefix: String,
}

macro_rules! lane_writer {
    ($name:ident, $type:ty, $kind:expr) => {
        pub fn $name(
            &mut self,
            name: &str,
            class: LaneClass,
            rows: impl IntoIterator<Item = $type>,
        ) {
            let mut bytes = Vec::new();
            for row in rows {
                bytes.extend_from_slice(&row.to_le_bytes());
            }
            self.push(name, class, $kind, bytes);
        }
    };
}

impl Capture {
    fn push(&mut self, name: &str, class: LaneClass, kind: LaneKind, bytes: Vec<u8>) {
        self.lanes.push(Lane {
            name: format!("{}{name}", self.prefix),
            class,
            kind,
            bytes,
        });
    }

    lane_writer!(u8s, u8, LaneKind::U8);
    lane_writer!(u16s, u16, LaneKind::U16);
    lane_writer!(u32s, u32, LaneKind::U32);
    lane_writer!(i32s, i32, LaneKind::I32);
    lane_writer!(i64s, i64, LaneKind::I64);

    pub fn f32s(&mut self, name: &str, class: LaneClass, rows: impl IntoIterator<Item = f32>) {
        self.u32s(name, class, rows.into_iter().map(f32::to_bits));
        self.retype(LaneKind::F32);
    }

    pub fn f64s(&mut self, name: &str, class: LaneClass, rows: impl IntoIterator<Item = f64>) {
        let mut bytes = Vec::new();
        for row in rows {
            bytes.extend_from_slice(&row.to_bits().to_le_bytes());
        }
        self.push(name, class, LaneKind::F64, bytes);
    }

    pub fn bools(&mut self, name: &str, class: LaneClass, rows: impl IntoIterator<Item = bool>) {
        self.u8s(name, class, rows.into_iter().map(u8::from));
    }

    pub fn usizes(&mut self, name: &str, class: LaneClass, rows: impl IntoIterator<Item = usize>) {
        self.u32s(
            name,
            class,
            rows.into_iter()
                .map(|row| u32::try_from(row).unwrap_or(u32::MAX)),
        );
    }

    fn retype(&mut self, kind: LaneKind) {
        if let Some(lane) = self.lanes.last_mut() {
            lane.kind = kind;
        }
    }

    /// A `u32` lane's rows, empty when the lane is absent: how the driver reads line edges and
    /// cluster starts back out of a capture.
    pub fn u32_rows(&self, name: &str) -> Vec<u32> {
        self.lane(name).map_or_else(Vec::new, |lane| {
            lane.bytes
                .chunks_exact(4)
                .map(|row| u32::from_le_bytes([row[0], row[1], row[2], row[3]]))
                .collect()
        })
    }

    pub fn lane(&self, name: &str) -> Option<&Lane> {
        self.lanes.iter().find(|lane| lane.name == name)
    }

    /// The golden form: one line per lane, digests only.
    pub fn golden(&self, step: &str) -> String {
        let mut text = format!("step {step}\n");
        for lane in &self.lanes {
            let _ = writeln!(
                text,
                "lane {} {} {} {} {:016x}",
                lane.name,
                lane.class.tag(),
                lane.kind.tag(),
                lane.rows(),
                lane.digest()
            );
        }
        text
    }

    /// The dump form: every row, for diffing two builds to the first differing row.
    pub fn dump(&self) -> Vec<u8> {
        let mut bytes = DUMP_MAGIC.to_vec();
        push_u32(&mut bytes, self.lanes.len());
        for lane in &self.lanes {
            push_u32(&mut bytes, lane.name.len());
            bytes.extend_from_slice(lane.name.as_bytes());
            push_u32(&mut bytes, lane.class.tag().len());
            bytes.extend_from_slice(lane.class.tag().as_bytes());
            push_u32(&mut bytes, lane.kind.tag().len());
            bytes.extend_from_slice(lane.kind.tag().as_bytes());
            push_u32(&mut bytes, lane.bytes.len());
            bytes.extend_from_slice(&lane.bytes);
        }
        bytes
    }

    pub fn from_dump(bytes: &[u8]) -> Result<Self, String> {
        let mut reader = DumpReader { bytes, at: 0 };
        if reader.take(DUMP_MAGIC.len())? != DUMP_MAGIC {
            return Err("not a layout-oracle dump".to_string());
        }
        let count = reader.length()?;
        let mut capture = Self::default();
        for _ in 0..count {
            let name = reader.text()?;
            let class = LaneClass::from_tag(&reader.text()?).ok_or("unknown lane class")?;
            let kind = LaneKind::from_tag(&reader.text()?).ok_or("unknown lane kind")?;
            let length = reader.length()?;
            let rows = reader.take(length)?.to_vec();
            if !rows.len().is_multiple_of(kind.width()) {
                return Err(format!("lane {name} is not whole rows"));
            }
            capture.push(&name, class, kind, rows);
        }
        Ok(capture)
    }
}

const DUMP_MAGIC: &[u8] = b"glyph-layout-oracle-dump-1\n";

fn push_u32(bytes: &mut Vec<u8>, value: usize) {
    bytes.extend_from_slice(&u32::try_from(value).unwrap_or(u32::MAX).to_le_bytes());
}

struct DumpReader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> DumpReader<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(length).ok_or("dump length overflow")?;
        let slice = self.bytes.get(self.at..end).ok_or("truncated dump")?;
        self.at = end;
        Ok(slice)
    }

    fn length(&mut self) -> Result<usize, String> {
        let raw = self.take(4)?;
        Ok(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as usize)
    }

    fn text(&mut self) -> Result<String, String> {
        let length = self.length()?;
        String::from_utf8(self.take(length)?.to_vec()).map_err(|_| "dump text is not UTF-8".into())
    }
}

/// 64-bit multiply-rotate digest over whole 8-byte words, then the tail. Not cryptographic:
/// it separates accidental differences, which is all a regression reference needs.
pub fn digest(bytes: &[u8]) -> u64 {
    const SEED: u64 = 0x9e37_79b9_7f4a_7c15;
    const MULTIPLIER: u64 = 0xff51_afd7_ed55_8ccd;
    let mut state = SEED ^ (bytes.len() as u64).wrapping_mul(MULTIPLIER);
    let mut words = bytes.chunks_exact(8);
    for word in &mut words {
        let mut raw = [0_u8; 8];
        raw.copy_from_slice(word);
        state = mix(state ^ u64::from_le_bytes(raw));
    }
    let mut tail = [0_u8; 8];
    let rest = words.remainder();
    tail[..rest.len()].copy_from_slice(rest);
    mix(state ^ u64::from_le_bytes(tail))
}

const fn mix(value: u64) -> u64 {
    let value = (value ^ (value >> 33)).wrapping_mul(0xff51_afd7_ed55_8ccd);
    let value = (value ^ (value >> 33)).wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    (value ^ (value >> 33)).rotate_left(27)
}

/// One lane that differs between two captures, located to its first differing row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaneDifference {
    pub lane: String,
    pub class: LaneClass,
    pub detail: String,
}

impl LaneDifference {
    pub fn render(&self) -> String {
        format!("{} [{}]: {}", self.lane, self.class.tag(), self.detail)
    }
}

/// Lanes of `left` and `right` that differ, in capture order. `include` selects the classes the
/// caller's equality covers.
pub fn differences(
    left: &Capture,
    right: &Capture,
    include: impl Fn(LaneClass) -> bool,
) -> Vec<LaneDifference> {
    let mut found = Vec::new();
    for lane in left.lanes.iter().filter(|lane| include(lane.class)) {
        let detail = match right.lane(&lane.name) {
            None => Some("lane absent on the right".to_string()),
            Some(other) => first_row_difference(lane, other),
        };
        if let Some(detail) = detail {
            found.push(LaneDifference {
                lane: lane.name.clone(),
                class: lane.class,
                detail,
            });
        }
    }
    for lane in right.lanes.iter().filter(|lane| include(lane.class)) {
        if left.lane(&lane.name).is_none() {
            found.push(LaneDifference {
                lane: lane.name.clone(),
                class: lane.class,
                detail: "lane absent on the left".to_string(),
            });
        }
    }
    found
}

/// Cache lanes of `left` holding an entry that `right` also holds with different content.
pub fn cache_differences(left: &Capture, right: &Capture) -> Vec<LaneDifference> {
    let mut found = Vec::new();
    for lane in left
        .lanes
        .iter()
        .filter(|lane| lane.class == LaneClass::Cache)
    {
        let Some(other) = right.lane(&lane.name) else {
            continue;
        };
        let group = CACHE_GROUP * lane.kind.width();
        let conflict = lane
            .bytes
            .chunks_exact(group)
            .zip(other.bytes.chunks_exact(group))
            .position(|(a, b)| {
                let present = |entry: &[u8]| entry[..lane.kind.width()].iter().any(|b| *b != 0);
                present(a) && present(b) && a != b
            });
        // The two sides size a cache as they fill it, so only shared entries are compared.
        if let Some(entry) = conflict {
            found.push(LaneDifference {
                lane: lane.name.clone(),
                class: lane.class,
                detail: format!(
                    "rows {} against {}; entry {entry} is cached on both sides as [{}, {}, {}] against [{}, {}, {}]",
                    lane.rows(),
                    other.rows(),
                    lane.render_row(entry * CACHE_GROUP + 1),
                    lane.render_row(entry * CACHE_GROUP + 2),
                    lane.render_row(entry * CACHE_GROUP + 3),
                    other.render_row(entry * CACHE_GROUP + 1),
                    other.render_row(entry * CACHE_GROUP + 2),
                    other.render_row(entry * CACHE_GROUP + 3),
                ),
            });
        }
    }
    found
}

fn first_row_difference(left: &Lane, right: &Lane) -> Option<String> {
    if left.kind != right.kind {
        return Some(format!(
            "kind {} against {}",
            left.kind.tag(),
            right.kind.tag()
        ));
    }
    if left.bytes == right.bytes {
        return None;
    }
    let width = left.kind.width();
    let row = left
        .bytes
        .chunks(width)
        .zip(right.bytes.chunks(width))
        .position(|(a, b)| a != b)
        .unwrap_or_else(|| left.rows().min(right.rows()));
    Some(format!(
        "rows {} against {}; first difference at row {row}: {} against {}",
        left.rows(),
        right.rows(),
        left.render_row(row),
        right.render_row(row)
    ))
}

/// A golden line that no longer matches, with the lane named so a dump diff can locate the row.
pub fn golden_differences(expected: &str, actual: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut actual_lines = actual.lines();
    for (index, want) in expected.lines().enumerate() {
        match actual_lines.next() {
            Some(got) if got == want => {}
            Some(got) => found.push(format!(
                "line {}: expected `{want}`, got `{got}`",
                index + 1
            )),
            None => found.push(format!(
                "line {}: expected `{want}`, got end of output",
                index + 1
            )),
        }
    }
    for extra in actual_lines {
        found.push(format!("unexpected extra line `{extra}`"));
    }
    found
}

/// The group a differing reference line names: the second word of the expected line.
pub fn golden_line_lane(line: &str) -> Option<&str> {
    let start = line.find('`')? + 1;
    line[start..].split(' ').nth(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Capture {
        let mut capture = Capture::default();
        capture.u32s("a.ids", LaneClass::Identity, [1, 2, 3]);
        capture.f32s("a.x", LaneClass::Value, [0.0, -0.0, 1.5]);
        capture.f64s("a.wide", LaneClass::Repr, [f64::NAN, 2.0]);
        capture.bools("a.flag", LaneClass::Value, [true, false]);
        capture
    }

    #[test]
    fn dump_round_trips_every_lane_bit_exactly() {
        let capture = sample();
        assert_eq!(Capture::from_dump(&capture.dump()).unwrap(), capture);
        assert!(Capture::from_dump(&capture.dump()[..40]).is_err());
    }

    #[test]
    fn negative_zero_and_row_count_are_differences() {
        let left = sample();
        let mut right = Capture::default();
        right.u32s("a.ids", LaneClass::Identity, [9, 9, 9]);
        right.f32s("a.x", LaneClass::Value, [0.0, 0.0, 1.5]);
        right.f64s("a.wide", LaneClass::Repr, [f64::NAN, 2.0]);
        right.bools("a.flag", LaneClass::Value, [true]);

        let found = differences(&left, &right, LaneClass::history_independent);
        let lanes: Vec<_> = found.iter().map(|d| d.lane.as_str()).collect();
        assert_eq!(lanes, ["a.x", "a.flag"], "identity lanes are excluded");
        assert!(found[0].detail.contains("row 1"), "{}", found[0].detail);
        assert!(found[1].detail.contains("rows 2 against 1"));
    }

    #[test]
    fn cache_entries_conflict_only_where_both_sides_hold_one() {
        let lane = |rows: [i32; 8]| {
            let mut capture = Capture::default();
            capture.i32s("c", LaneClass::Cache, rows);
            capture
        };
        let warm = lane([1, 5, 6, 7, 1, 8, 9, 10]);
        assert!(cache_differences(&warm, &lane([0, 0, 0, 0, 1, 8, 9, 10])).is_empty());
        let stale = cache_differences(&warm, &lane([1, 5, 6, 7, 1, 8, 9, 11]));
        assert_eq!(stale.len(), 1);
        assert!(stale[0].detail.contains("entry 1"), "{}", stale[0].detail);
    }

    #[test]
    fn golden_text_changes_with_one_bit_and_names_the_lane() {
        let left = sample();
        let mut right = sample();
        right.lanes[1].bytes[0] ^= 1;
        let found = golden_differences(&left.golden("cold"), &right.golden("cold"));
        assert_eq!(found.len(), 1);
        assert_eq!(golden_line_lane(&found[0]), Some("a.x"));
        assert_ne!(digest(b"abcdefgh"), digest(b"abcdefgh\0"));
    }
}
