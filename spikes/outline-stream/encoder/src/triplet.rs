//! WOFF2-style triplet planes (`hdr`, `cn`, `flags`, `data`) for the CPU bench, composites expanded.
//! Same size classes as `research/encoding/scripts/enc.py` and the research decoder.

use crate::outline::StreamPoint;

#[derive(Default)]
pub struct Triplets {
    pub hdr: Vec<u8>,
    pub cn: Vec<u8>,
    pub flags: Vec<u8>,
    pub data: Vec<u8>,
    pub glyphs: usize,
    pub contours: usize,
    pub points: usize,
    pub sum_x: i64,
    pub sum_y: i64,
    pub on_curve: usize,
}

impl Triplets {
    pub fn push_glyph(&mut self, contours: &[Vec<StreamPoint>]) {
        self.glyphs += 1;
        varint(&mut self.hdr, 2 * contours.len() as u32);
        let (mut px, mut py) = (0i32, 0i32);
        for contour in contours {
            self.contours += 1;
            varint(&mut self.cn, contour.len() as u32);
            for p in contour {
                let (x, y) = (i32::from(p.x), i32::from(p.y));
                self.point(x - px, y - py, p.off);
                (px, py) = (x, y);
                self.points += 1;
                self.sum_x += i64::from(p.x);
                self.sum_y += i64::from(p.y);
                self.on_curve += usize::from(!p.off);
            }
        }
    }

    fn point(&mut self, x: i32, y: i32, off: bool) {
        let on = if off { 128u8 } else { 0 };
        let (ax, ay) = (x.unsigned_abs(), y.unsigned_abs());
        let (sx, sy) = (u8::from(x < 0), u8::from(y < 0));
        let (fl, data) = (&mut self.flags, &mut self.data);
        if x == 0 && ay < 1280 {
            fl.push(on | (((ay >> 8) as u8) << 1) | sy);
            data.push(ay as u8);
        } else if y == 0 && ax < 1280 {
            fl.push(on | (10 + ((((ax >> 8) as u8) << 1) | sx)));
            data.push(ax as u8);
        } else if (1..=64).contains(&ax) && (1..=64).contains(&ay) {
            let (a, b) = (ax - 1, ay - 1);
            fl.push(on | ((20 + ((a >> 4) << 4) + ((b >> 4) << 2)) as u8 + (sx << 1 | sy)));
            data.push((((a & 15) << 4) | (b & 15)) as u8);
        } else if (1..=768).contains(&ax) && (1..=768).contains(&ay) {
            let (a, b) = (ax - 1, ay - 1);
            fl.push(on | ((84 + 12 * (a >> 8) + ((b >> 8) << 2)) as u8 + (sx << 1 | sy)));
            data.extend_from_slice(&[a as u8, b as u8]);
        } else if ax < 4096 && ay < 4096 {
            fl.push(on | (120 + (sx << 1 | sy)));
            data.extend_from_slice(&[
                (ax >> 4) as u8,
                (((ax & 15) << 4) | (ay >> 8)) as u8,
                ay as u8,
            ]);
        } else {
            fl.push(on | (124 + (sx << 1 | sy)));
            data.extend_from_slice(&(ax as u16).to_be_bytes());
            data.extend_from_slice(&(ay as u16).to_be_bytes());
        }
    }
}

fn varint(out: &mut Vec<u8>, mut v: u32) {
    while v >= 128 {
        out.push((v as u8 & 127) | 128);
        v >>= 7;
    }
    out.push(v as u8);
}
