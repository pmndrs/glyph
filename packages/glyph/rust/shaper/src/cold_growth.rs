//! Fallible `Vec` growth with the capacity check at the call site and the growth out of line.
//!
//! `Vec::try_reserve` and `try_reserve_exact` inline their whole growth path, so every one of the
//! engine's fallible reservations carried a copy of it. These keep the check that decides whether
//! anything has to happen inline and send growth to one `#[cold]` function per element type. The
//! result is the standard library's in every case: growth calls the same method with the same
//! argument.

use alloc::collections::TryReserveError;
use alloc::vec::Vec;

pub(crate) trait ColdGrowth {
    /// `Vec::try_reserve`, with the growth out of line.
    fn try_reserve_cold(&mut self, additional: usize) -> Result<(), TryReserveError>;
    /// `Vec::try_reserve_exact`, with the growth out of line.
    fn try_reserve_exact_cold(&mut self, additional: usize) -> Result<(), TryReserveError>;
}

impl<T> ColdGrowth for Vec<T> {
    #[inline(always)]
    fn try_reserve_cold(&mut self, additional: usize) -> Result<(), TryReserveError> {
        if self.capacity() - self.len() >= additional {
            Ok(())
        } else {
            grow(self, additional)
        }
    }

    #[inline(always)]
    fn try_reserve_exact_cold(&mut self, additional: usize) -> Result<(), TryReserveError> {
        if self.capacity() - self.len() >= additional {
            Ok(())
        } else {
            grow_exact(self, additional)
        }
    }
}

#[cold]
#[inline(never)]
fn grow<T>(values: &mut Vec<T>, additional: usize) -> Result<(), TryReserveError> {
    values.try_reserve(additional)
}

#[cold]
#[inline(never)]
fn grow_exact<T>(values: &mut Vec<T>, additional: usize) -> Result<(), TryReserveError> {
    values.try_reserve_exact(additional)
}

#[cfg(test)]
mod tests {
    use super::ColdGrowth;
    use alloc::vec::Vec;

    #[test]
    fn grows_exactly_as_the_standard_library_does() {
        let cases = [
            (0, 0, 0),
            (0, 0, 1),
            (3, 4, 1),
            (3, 4, 2),
            (4, 4, 9),
            (2, 16, 14),
            (0, 0, usize::MAX),
        ];
        for (len, capacity, additional) in cases {
            for exact in [false, true] {
                let mut cold: Vec<u64> = Vec::with_capacity(capacity);
                cold.resize(len, 0);
                let mut standard: Vec<u64> = Vec::with_capacity(capacity);
                standard.resize(len, 0);
                let (cold_result, standard_result) = if exact {
                    (
                        cold.try_reserve_exact_cold(additional),
                        standard.try_reserve_exact(additional),
                    )
                } else {
                    (
                        cold.try_reserve_cold(additional),
                        standard.try_reserve(additional),
                    )
                };
                assert_eq!(
                    cold_result, standard_result,
                    "{len} {capacity} {additional} {exact}"
                );
                assert_eq!(
                    cold.capacity(),
                    standard.capacity(),
                    "{len} {capacity} {additional} {exact}"
                );
            }
        }
    }
}
