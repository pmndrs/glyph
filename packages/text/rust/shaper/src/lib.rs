#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

mod abi_contract;

#[cfg(target_arch = "wasm32")]
mod wasm;

use alloc::{collections::BTreeMap, vec::Vec};
use harfrust::{FontRef, ShaperData};
use read_fonts::TableProvider;

const STATUS_OK: u32 = 0;
const STATUS_INVALID_HANDLE: u32 = 1;
const STATUS_INVALID_FONT: u32 = 2;
const STATUS_INVALID_EXTENTS: u32 = 3;
const STATUS_HANDLE_CONFLICT: u32 = 4;
const STATUS_FONT_MISSING: u32 = 5;

pub struct ShaperRegistry {
    fonts: BTreeMap<u32, RegisteredFont>,
}

struct RegisteredFont {
    sfnt: Vec<u8>,
    extents: Vec<u8>,
    availability: Vec<u8>,
    #[allow(dead_code)]
    data: ShaperData,
    #[allow(dead_code)]
    plan_count: u32,
}

impl Default for ShaperRegistry {
    fn default() -> Self {
        Self {
            fonts: BTreeMap::new(),
        }
    }
}

impl ShaperRegistry {
    pub fn register_font(
        &mut self,
        handle: u32,
        sfnt: &[u8],
        extents: &[u8],
        availability: &[u8],
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
        if let Some(existing) = self.fonts.get(&handle) {
            return if existing.sfnt == sfnt
                && existing.extents == extents
                && existing.availability == availability
            {
                STATUS_OK
            } else {
                STATUS_HANDLE_CONFLICT
            };
        }
        let data = ShaperData::new(&font);
        self.fonts.insert(
            handle,
            RegisteredFont {
                sfnt: sfnt.to_vec(),
                extents: extents.to_vec(),
                availability: availability.to_vec(),
                data,
                plan_count: 0,
            },
        );
        STATUS_OK
    }

    pub fn dispose_font(&mut self, handle: u32) -> u32 {
        if self.fonts.remove(&handle).is_some() {
            STATUS_OK
        } else {
            STATUS_FONT_MISSING
        }
    }

    pub fn font_count(&self) -> u32 {
        self.fonts.len().try_into().unwrap_or(u32::MAX)
    }

    pub fn retained_font_bytes(&self) -> u32 {
        self.fonts
            .values()
            .map(|font| font.sfnt.len() + font.extents.len() + font.availability.len())
            .try_fold(0_u32, |total, bytes| {
                total.checked_add(bytes.try_into().unwrap_or(u32::MAX))
            })
            .unwrap_or(u32::MAX)
    }

    pub fn plan_count(&self) -> u32 {
        self.fonts
            .values()
            .map(|font| font.plan_count)
            .fold(0_u32, u32::saturating_add)
    }
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
    fn registration_rejects_invalid_payloads_and_disposes_owned_state() {
        let mut registry = ShaperRegistry::default();
        assert_eq!(
            registry.register_font(0, &[], &[], &[]),
            STATUS_INVALID_HANDLE
        );
        assert_eq!(
            registry.register_font(1, &[], &[], &[]),
            STATUS_INVALID_FONT
        );
        assert_eq!(registry.font_count(), 0);
        assert_eq!(registry.dispose_font(1), STATUS_FONT_MISSING);
    }
}
