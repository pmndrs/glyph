use core::ops::{Add, AddAssign, Div, Mul, Neg, Sub};

#[cfg(not(feature = "std"))]
use core_maths::CoreFloat as _;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Point {
    pub(crate) x: f32,
    pub(crate) y: f32,
}

impl Point {
    pub(crate) const ZERO: Self = Self { x: 0.0, y: 0.0 };

    pub(crate) const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    pub(crate) fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }

    pub(crate) fn dot(self, other: Self) -> f32 {
        self.x * other.x + self.y * other.y
    }

    pub(crate) fn cross(self, other: Self) -> f32 {
        self.x * other.y - self.y * other.x
    }

    pub(crate) fn length_squared(self) -> f32 {
        self.dot(self)
    }

    pub(crate) fn length(self) -> f32 {
        self.length_squared().sqrt()
    }

    pub(crate) fn normalized(self) -> Self {
        let length = self.length();
        if length > f32::EPSILON {
            self / length
        } else {
            Self::ZERO
        }
    }

    pub(crate) fn lerp(self, other: Self, t: f32) -> Self {
        self + (other - self) * t
    }
}

impl Add for Point {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        Self::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl AddAssign for Point {
    fn add_assign(&mut self, rhs: Self) {
        self.x += rhs.x;
        self.y += rhs.y;
    }
}

impl Sub for Point {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self::Output {
        Self::new(self.x - rhs.x, self.y - rhs.y)
    }
}

impl Mul<f32> for Point {
    type Output = Self;

    fn mul(self, rhs: f32) -> Self::Output {
        Self::new(self.x * rhs, self.y * rhs)
    }
}

impl Div<f32> for Point {
    type Output = Self;

    fn div(self, rhs: f32) -> Self::Output {
        Self::new(self.x / rhs, self.y / rhs)
    }
}

impl Neg for Point {
    type Output = Self;

    fn neg(self) -> Self::Output {
        Self::new(-self.x, -self.y)
    }
}

pub(crate) fn clamp_unit(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

pub(crate) fn quantize_unorm(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0) as u8
}

pub(crate) fn squared_distance(a: Point, b: Point) -> f32 {
    (a - b).length_squared()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_handles_degenerate_vectors() {
        assert_eq!(Point::ZERO.normalized(), Point::ZERO);
        let unit = Point::new(3.0, 4.0).normalized();
        assert!((unit.length() - 1.0).abs() < 1.0e-6);
    }

    #[test]
    fn quantization_saturates() {
        assert_eq!(quantize_unorm(-1.0), 0);
        assert_eq!(quantize_unorm(0.5), 127);
        assert_eq!(quantize_unorm(2.0), 255);
    }
}
