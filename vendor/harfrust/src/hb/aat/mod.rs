#[cfg(feature = "aat")]
pub mod layout;
pub mod layout_common;
#[cfg(feature = "aat")]
pub mod layout_kerx_table;
#[cfg(feature = "aat")]
pub mod layout_morx_table;
#[cfg(feature = "aat")]
pub mod layout_trak_table;
#[cfg(feature = "aat")]
pub mod map;

#[cfg(feature = "aat")]
use crate::hb::aat::layout_kerx_table::KerxSubtableCache;
#[cfg(feature = "aat")]
use crate::hb::aat::layout_morx_table::MorxSubtableCache;
use crate::hb::kerning::KernSubtableCache;
#[cfg(feature = "experimental_font_api")]
use crate::hb::ot::OtTables;
use crate::hb::tables::TableRanges;
use alloc::vec::Vec;
use read_fonts::tables::kern::Kern;
#[cfg(feature = "aat")]
use read_fonts::tables::{ankr::Ankr, feat::Feat, kerx::Kerx, morx::Morx, trak::Trak};
use read_fonts::{FontRef, TableProvider};

// The legacy OpenType `kern` table is shaped through this cache and
// `AatTables`, so both exist without the `aat` feature; only their
// `morx`/`kerx`/`ankr`/`trak`/`feat` members are gated.
#[derive(Default)]
pub struct AatCache {
    #[cfg(feature = "aat")]
    pub morx: Vec<MorxSubtableCache>,
    pub kern: Vec<KernSubtableCache>,
    #[cfg(feature = "aat")]
    pub kerx: Vec<KerxSubtableCache>,
}

impl AatCache {
    #[allow(unused)]
    pub fn new<'a>(font: &impl TableProvider<'a>) -> Self {
        let mut cache = Self::default();
        let num_glyphs = font
            .maxp()
            .map(|maxp| maxp.num_glyphs() as u32)
            .unwrap_or_default();
        #[cfg(feature = "aat")]
        if let Ok(morx) = font.morx() {
            let chains = morx.chains();
            for chain in morx.chains().iter() {
                let Ok(chain) = chain else {
                    continue;
                };
                for subtable in chain.subtables().iter() {
                    let Ok(subtable) = subtable else {
                        continue;
                    };
                    cache
                        .morx
                        .push(MorxSubtableCache::new(&subtable, num_glyphs));
                }
            }
        }
        if let Ok(kern) = font.kern() {
            for subtable in kern.subtables() {
                let Ok(subtable) = subtable else {
                    continue;
                };
                cache
                    .kern
                    .push(KernSubtableCache::new(&subtable, num_glyphs));
            }
        }
        #[cfg(feature = "aat")]
        if let Ok(kerx) = font.kerx() {
            for subtable in kerx.subtables().iter() {
                let Ok(subtable) = subtable else {
                    continue;
                };
                cache
                    .kerx
                    .push(KerxSubtableCache::new(&subtable, num_glyphs));
            }
        }
        cache
    }
}

#[derive(Clone, Default)]
pub struct AatTables<'a> {
    #[cfg(feature = "aat")]
    pub morx: Option<(Morx<'a>, &'a [MorxSubtableCache])>,
    #[cfg(feature = "aat")]
    pub ankr: Option<Ankr<'a>>,
    pub kern: Option<(Kern<'a>, &'a [KernSubtableCache])>,
    #[cfg(feature = "aat")]
    pub kerx: Option<(Kerx<'a>, &'a [KerxSubtableCache])>,
    #[cfg(feature = "aat")]
    pub trak: Option<Trak<'a>>,
    #[cfg(feature = "aat")]
    pub feat: Option<Feat<'a>>,
}

#[cfg(feature = "aat")]
use crate::hb::algs::HB_CODEPOINT_ENCODE3 as encode3;

/// Blocklist specific broken morx tables identified by the combination of
/// morx, GSUB, and GDEF table lengths.
#[cfg(feature = "aat")]
fn is_morx_blocklisted(morx_len: u32, gsub_len: u32, gdef_len: u32) -> bool {
    const BLOCKLIST: &[u64] = &[
        // AALMAGHRIBI.ttf — https://github.com/harfbuzz/harfbuzz/issues/4108
        encode3(19892, 2794, 340),
    ];
    let key = encode3(morx_len, gsub_len, gdef_len);
    BLOCKLIST.contains(&key)
}

impl<'a> AatTables<'a> {
    pub fn new(font: &FontRef<'a>, cache: &'a AatCache, table_ranges: &TableRanges) -> Self {
        #[cfg(feature = "aat")]
        let morx = if is_morx_blocklisted(
            table_ranges.morx.len(),
            table_ranges.gsub.len(),
            table_ranges.gdef.len(),
        ) {
            None
        } else {
            table_ranges
                .morx
                .resolve_table(font)
                .map(|table| (table, cache.morx.as_slice()))
        };
        #[cfg(feature = "aat")]
        let ankr = table_ranges.ankr.resolve_table(font);
        let kern = table_ranges
            .kern
            .resolve_table(font)
            .map(|table| (table, cache.kern.as_slice()));
        #[cfg(feature = "aat")]
        let kerx = table_ranges
            .kerx
            .resolve_table(font)
            .map(|table| (table, cache.kerx.as_slice()));
        #[cfg(feature = "aat")]
        let trak = table_ranges.trak.resolve_table(font);
        #[cfg(feature = "aat")]
        let feat = table_ranges.feat.resolve_table(font);
        Self {
            #[cfg(feature = "aat")]
            morx,
            #[cfg(feature = "aat")]
            ankr,
            kern,
            #[cfg(feature = "aat")]
            kerx,
            #[cfg(feature = "aat")]
            trak,
            #[cfg(feature = "aat")]
            feat,
        }
    }

    #[cfg(feature = "experimental_font_api")]
    pub fn from_tables(
        font: &impl TableProvider<'a>,
        ot_tables: &OtTables,
        cache: &'a AatCache,
    ) -> Self {
        #[cfg(not(feature = "aat"))]
        let _ = ot_tables;
        #[cfg(feature = "aat")]
        let morx = if let Ok(morx) = font.morx() {
            let gsub_len = ot_tables
                .gsub
                .as_ref()
                .map_or(0, |table| table.table.offset_data().len() as u32);
            let gdef_len = ot_tables
                .gdef
                .table
                .as_ref()
                .map_or(0, |table| table.offset_data().len() as u32);
            if is_morx_blocklisted(morx.offset_data().len() as u32, gsub_len, gdef_len) {
                None
            } else {
                Some((morx, cache.morx.as_slice()))
            }
        } else {
            None
        };
        #[cfg(feature = "aat")]
        let ankr = font.ankr().ok();
        let kern = font.kern().ok().map(|table| (table, cache.kern.as_slice()));
        #[cfg(feature = "aat")]
        let kerx = font.kerx().ok().map(|table| (table, cache.kerx.as_slice()));
        #[cfg(feature = "aat")]
        let trak = font.trak().ok();
        #[cfg(feature = "aat")]
        let feat = font.feat().ok();
        Self {
            #[cfg(feature = "aat")]
            morx,
            #[cfg(feature = "aat")]
            ankr,
            kern,
            #[cfg(feature = "aat")]
            kerx,
            #[cfg(feature = "aat")]
            trak,
            #[cfg(feature = "aat")]
            feat,
        }
    }
}
