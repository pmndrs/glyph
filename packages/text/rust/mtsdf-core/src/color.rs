use alloc::vec::Vec;
use core::ops::Range;

use crate::outline::{BLUE, BuildFailure, Edge, GREEN, RED, WHITE};

const CORNER_CROSS_THRESHOLD: f32 = 0.141_12; // sin(3 radians), msdfgen default.
const CYAN: u8 = GREEN | BLUE;
const MAGENTA: u8 = RED | BLUE;
const YELLOW: u8 = RED | GREEN;

pub(crate) fn color_edges(
    source: &[Edge],
    contours: &[Range<usize>],
    output: &mut Vec<Edge>,
    output_contours: &mut Vec<Range<usize>>,
    corners: &mut Vec<usize>,
) -> Result<(), BuildFailure> {
    output.clear();
    output_contours.clear();
    output
        .try_reserve(source.len().saturating_mul(3))
        .map_err(|_| BuildFailure::Allocation)?;
    output_contours
        .try_reserve(contours.len())
        .map_err(|_| BuildFailure::Allocation)?;

    let mut seed = 0_u64;
    let mut color = initial_color(&mut seed);
    for range in contours {
        let Some(edges) = source.get(range.clone()) else {
            return Err(BuildFailure::EdgeLimit);
        };
        if edges.is_empty() {
            continue;
        }
        corners.clear();
        corners
            .try_reserve(edges.len())
            .map_err(|_| BuildFailure::Allocation)?;
        find_corners(edges, corners);
        let start = output.len();
        match corners.len() {
            0 => {
                switch_color(&mut color, &mut seed, 0);
                for edge in edges {
                    let mut edge = *edge;
                    edge.set_color(color);
                    output.push(edge);
                }
            }
            1 => color_teardrop(edges, corners[0], &mut color, &mut seed, output),
            _ => color_cornered(edges, corners, &mut color, &mut seed, output),
        }
        output_contours.push(start..output.len());
    }
    Ok(())
}

fn find_corners(edges: &[Edge], corners: &mut Vec<usize>) {
    let Some(last) = edges.last().copied() else {
        return;
    };
    let mut previous = last.direction_at_end().normalized();
    for (index, edge) in edges.iter().copied().enumerate() {
        let next = edge.direction_at_start().normalized();
        if is_corner(previous, next) {
            corners.push(index);
        }
        previous = edge.direction_at_end().normalized();
    }
}

fn is_corner(previous: crate::math::Point, next: crate::math::Point) -> bool {
    previous.dot(next) <= 0.0 || previous.cross(next).abs() > CORNER_CROSS_THRESHOLD
}

fn color_teardrop(
    edges: &[Edge],
    corner: usize,
    color: &mut u8,
    seed: &mut u64,
    output: &mut Vec<Edge>,
) {
    switch_color(color, seed, 0);
    let first_color = *color;
    switch_color(color, seed, 0);
    let colors = [first_color, WHITE, *color];
    let count = edges.len();
    if count >= 3 {
        for offset in 0..count {
            let index = (corner + offset) % count;
            let mut edge = edges[index];
            edge.set_color(colors[(1 + symmetrical_trichotomy(offset, count)) as usize]);
            output.push(edge);
        }
        rotate_new_edges(output, count, corner);
        return;
    }

    // One-corner contours with fewer than three edges cannot carry all three
    // color transitions. Splitting at exact thirds preserves the curve.
    let start = output.len();
    if count == 1 {
        let mut parts = edges[0].split_in_thirds();
        for (part, part_color) in parts.iter_mut().zip(colors) {
            part.set_color(part_color);
            output.push(*part);
        }
    } else {
        let first_index = corner;
        let second_index = (corner + 1) % 2;
        let first_parts = edges[first_index].split_in_thirds();
        let second_parts = edges[second_index].split_in_thirds();
        let mut parts = [
            first_parts[0],
            first_parts[1],
            first_parts[2],
            second_parts[0],
            second_parts[1],
            second_parts[2],
        ];
        for (index, part) in parts.iter_mut().enumerate() {
            part.set_color(colors[index / 2]);
            output.push(*part);
        }
        if corner != 0 {
            output[start..].rotate_right(3);
        }
    }
}

fn rotate_new_edges(output: &mut [Edge], count: usize, corner: usize) {
    if corner == 0 || count == 0 {
        return;
    }
    let start = output.len() - count;
    output[start..].rotate_right(corner);
}

fn color_cornered(
    edges: &[Edge],
    corners: &[usize],
    color: &mut u8,
    seed: &mut u64,
    output: &mut Vec<Edge>,
) {
    let initial_start = corners[0];
    switch_color(color, seed, 0);
    let initial_color = *color;
    let mut spline = 0;
    let output_start = output.len();
    output.extend_from_slice(edges);
    for offset in 0..edges.len() {
        let index = (initial_start + offset) % edges.len();
        if spline + 1 < corners.len() && corners[spline + 1] == index {
            spline += 1;
            let banned = if spline == corners.len() - 1 {
                initial_color
            } else {
                0
            };
            switch_color(color, seed, banned);
        }
        output[output_start + index].set_color(*color);
    }
}

fn symmetrical_trichotomy(position: usize, count: usize) -> isize {
    if count <= 1 {
        return 0;
    }
    ((3.0 + 2.875 * position as f32 / (count - 1) as f32 - 1.4375 + 0.5) as isize) - 3
}

fn initial_color(seed: &mut u64) -> u8 {
    let colors = [CYAN, MAGENTA, YELLOW];
    let index = (*seed % 3) as usize;
    *seed /= 3;
    colors[index]
}

fn switch_color(color: &mut u8, seed: &mut u64, banned: u8) {
    let combined = *color & banned;
    if combined == RED || combined == GREEN || combined == BLUE {
        *color = combined ^ WHITE;
        return;
    }
    let shift = 1 + (*seed & 1) as u32;
    *seed >>= 1;
    let shifted = *color << shift;
    *color = (shifted | shifted >> 3) & WHITE;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::Point;

    #[test]
    fn one_edge_teardrop_is_split_without_flattening() {
        let edge = Edge::Cubic {
            points: [
                Point::new(0.0, 0.0),
                Point::new(1.0, 2.0),
                Point::new(-1.0, 2.0),
                Point::new(0.0, 0.0),
            ],
            color: WHITE,
        };
        let mut output = Vec::new();
        let mut contours = Vec::new();
        let mut corners = Vec::new();
        color_edges(
            &[edge],
            &alloc::vec![0..1],
            &mut output,
            &mut contours,
            &mut corners,
        )
        .expect("coloring");
        assert_eq!(output.len(), 3);
        assert!(output.iter().all(|edge| matches!(edge, Edge::Cubic { .. })));
        assert_eq!(output[0].start(), output[2].end());
    }
}
