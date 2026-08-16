use core::convert::Infallible;

use pmndrs_glyph_mtsdf_core::{AtlasRegion, Bounds, MtsdfGenerator, OutlineSink, OutlineSource};

const COMMAND_BYTES: usize = 13;
const MAX_COMMANDS: usize = 128;

pub fn exercise_outline_bytes(input: &[u8]) {
    let Some(provider) = MutatedOutline::new(input) else {
        return;
    };
    let mut generator = MtsdfGenerator::default();
    let Ok(mut outline) = generator.read_outline(&provider) else {
        return;
    };
    let width = usize::from(input.first().copied().unwrap_or(0) % 16 + 1);
    let height = usize::from(input.get(1).copied().unwrap_or(0) % 16 + 1);
    let _ = outline.generate_mtsdf(AtlasRegion {
        inner_width: width,
        inner_height: height,
        padding_x: 1,
        padding_y: 1,
    });
}

struct MutatedOutline<'a> {
    commands: &'a [u8],
    bounds: Bounds,
}

impl<'a> MutatedOutline<'a> {
    fn new(input: &'a [u8]) -> Option<Self> {
        let commands = input.get(2..)?;
        if commands.len() < COMMAND_BYTES {
            return None;
        }
        let commands = &commands[..commands.len().min(COMMAND_BYTES * MAX_COMMANDS)];
        let mut min_x = f32::INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut max_y = f32::NEG_INFINITY;
        for command in commands.chunks_exact(COMMAND_BYTES) {
            for (coordinate_index, pair) in command[1..].chunks_exact(2).enumerate() {
                let value = decode_coordinate(pair[0], pair[1]);
                if coordinate_index % 2 == 0 {
                    min_x = min_x.min(value);
                    max_x = max_x.max(value);
                } else {
                    min_y = min_y.min(value);
                    max_y = max_y.max(value);
                }
            }
        }
        if !min_x.is_finite() || !min_y.is_finite() {
            return None;
        }
        if min_x == max_x {
            max_x += 1.0;
        }
        if min_y == max_y {
            max_y += 1.0;
        }
        Some(Self {
            commands,
            bounds: Bounds::new(min_x, min_y, max_x, max_y),
        })
    }
}

impl OutlineSource for MutatedOutline<'_> {
    type Error = Infallible;

    fn units_per_em(&self) -> f32 {
        1_000.0
    }

    fn bounds(&self) -> Bounds {
        self.bounds
    }

    fn emit(&self, collector: &mut OutlineSink<'_>) -> Result<(), Self::Error> {
        let mut contour_open = false;
        for command in self.commands.chunks_exact(COMMAND_BYTES) {
            let coordinate = |index: usize| decode_coordinate(command[index], command[index + 1]);
            match command[0] % 5 {
                0 => {
                    if contour_open {
                        collector.close();
                    }
                    collector.move_to(coordinate(1), coordinate(3));
                    contour_open = true;
                }
                1 if contour_open => collector.line_to(coordinate(1), coordinate(3)),
                2 if contour_open => {
                    collector.quad_to(coordinate(1), coordinate(3), coordinate(5), coordinate(7))
                }
                3 if contour_open => collector.cubic_to(
                    coordinate(1),
                    coordinate(3),
                    coordinate(5),
                    coordinate(7),
                    coordinate(9),
                    coordinate(11),
                ),
                4 if contour_open => {
                    collector.close();
                    contour_open = false;
                }
                _ => {}
            }
        }
        if contour_open {
            collector.close();
        }
        Ok(())
    }
}

fn decode_coordinate(low: u8, high: u8) -> f32 {
    f32::from(i16::from_le_bytes([low, high]).rem_euclid(2_049) - 1_024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn degenerate_cubic_regression_terminates() {
        const INPUT: &[u8] = &[
            0x40, 0x10, 0x2c, 0x10, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x44, 0x35, 0x82, 0x3e,
            0x00, 0x00, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e,
            0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x4e, 0x0f,
            0x64, 0x00, 0x00, 0x00, 0x66,
        ];
        exercise_outline_bytes(INPUT);
    }
}
