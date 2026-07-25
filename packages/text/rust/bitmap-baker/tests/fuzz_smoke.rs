use pmndrs_text_bitmap_baker::{
    ArtifactPackaging, BitmapBakeRequestV0, BitmapDescriptorV0, BitmapPackagingV0, PagePackaging,
    bake_bitmap, descriptor_raster_key,
};

const SEED: u32 = 0x504d_4e44;

#[test]
fn arbitrary_font_bytes_fail_safely_and_deterministically() {
    let mut random = XorShift32(SEED);
    let descriptor = BitmapDescriptorV0 {
        generator_version: "0.0.0".into(),
        strikes: vec![16],
    };
    let raster_key = descriptor_raster_key(&descriptor);

    for case in 0..256 {
        let length = (random.next() as usize) % 2049;
        let mut source = vec![0; length];
        for byte in &mut source {
            *byte = random.next() as u8;
        }
        let request = BitmapBakeRequestV0 {
            font_face_index: random.next(),
            glyph_count: 1,
            shaping_hash: "0".repeat(64),
            raster_key: raster_key.clone(),
            packaging: BitmapPackagingV0 {
                artifact: ArtifactPackaging::External,
                pages: PagePackaging::Embedded,
            },
            descriptor: descriptor.clone(),
        };

        let first = bake_bitmap(&source, request.clone());
        let second = bake_bitmap(&source, request);
        match (first, second) {
            (Err(first), Err(second)) => {
                assert_eq!(first.code, second.code, "case {case}, seed {SEED}");
                assert_eq!(first.message, second.message, "case {case}, seed {SEED}");
                assert_eq!(first.path, second.path, "case {case}, seed {SEED}");
            }
            (Ok(first), Ok(second)) => assert_eq!(first, second, "case {case}, seed {SEED}"),
            _ => panic!("case {case} from seed {SEED} was nondeterministic"),
        }
    }
}

struct XorShift32(u32);

impl XorShift32 {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }
}
