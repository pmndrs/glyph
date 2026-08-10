use pmndrs_text_font_baker::{BakeDescriptorV0, bake_font};

const SEED: u32 = 0x504d_4e44;

#[test]
fn arbitrary_font_bytes_fail_safely_and_deterministically() {
    let mut random = XorShift32(SEED);

    for case in 0..256 {
        let length = (random.next() as usize) % 2049;
        let mut source = vec![0; length];
        for byte in &mut source {
            *byte = random.next() as u8;
        }
        let descriptor = BakeDescriptorV0 {
            format_version: if case % 4 == 0 { 1 } else { 0 },
            font_face_index: random.next(),
        };

        let first = bake_font(&source, descriptor);
        let second = bake_font(&source, descriptor);
        match (first, second) {
            (Err(first), Err(second)) => {
                assert_eq!(first.code, second.code, "case {case}, seed {SEED}");
                assert_eq!(first.message, second.message, "case {case}, seed {SEED}");
                assert_eq!(first.path, second.path, "case {case}, seed {SEED}");
            }
            (Ok(first), Ok(second)) => {
                assert_eq!(first.artifacts.len(), second.artifacts.len());
                for (first, second) in first.artifacts.iter().zip(second.artifacts.iter()) {
                    assert_eq!(first.id, second.id, "case {case}, seed {SEED}");
                    assert_eq!(first.sha256, second.sha256, "case {case}, seed {SEED}");
                    assert_eq!(first.bytes, second.bytes, "case {case}, seed {SEED}");
                }
            }
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
