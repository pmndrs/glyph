//! Reusable exact-identity lookup scratch with epoch-based clearing.

use alloc::vec::Vec;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IdentityIndexError {
    AllocationFailed,
    ArithmeticOverflow,
    DuplicateIdentity,
}

#[derive(Default)]
pub(crate) struct IdentityIndex {
    keys: Vec<u32>,
    values: Vec<u32>,
    epochs: Vec<u32>,
    epoch: u32,
}

impl IdentityIndex {
    pub(crate) fn prepare(&mut self, entry_count: usize) -> Result<(), IdentityIndexError> {
        let required = entry_count
            .checked_mul(2)
            .and_then(usize::checked_next_power_of_two)
            .ok_or(IdentityIndexError::ArithmeticOverflow)?
            .max(8);
        if self.keys.len() < required {
            let additional_keys = required - self.keys.len();
            let additional_values = required - self.values.len();
            let additional_epochs = required - self.epochs.len();
            reserve(&mut self.keys, additional_keys)?;
            reserve(&mut self.values, additional_values)?;
            reserve(&mut self.epochs, additional_epochs)?;
            self.keys.resize(required, 0);
            self.values.resize(required, 0);
            self.epochs.resize(required, 0);
        }
        self.epoch = next_epoch(&mut self.epochs, self.epoch);
        Ok(())
    }

    pub(crate) fn insert(&mut self, identity: u32, value: u32) -> Result<(), IdentityIndexError> {
        let index = self.insert_position(identity)?;
        if self.epochs[index] == self.epoch {
            return Err(IdentityIndexError::DuplicateIdentity);
        }
        self.epochs[index] = self.epoch;
        self.keys[index] = identity;
        self.values[index] = value;
        Ok(())
    }

    pub(crate) fn get(&self, identity: u32) -> Option<u32> {
        let mask = self.keys.len().checked_sub(1)?;
        let mut index = hash(identity) & mask;
        loop {
            if self.epochs[index] != self.epoch {
                return None;
            }
            if self.keys[index] == identity {
                return Some(self.values[index]);
            }
            index = (index + 1) & mask;
        }
    }

    #[cfg(test)]
    pub(crate) fn capacities(&self) -> [usize; 3] {
        [
            self.keys.capacity(),
            self.values.capacity(),
            self.epochs.capacity(),
        ]
    }

    fn insert_position(&self, identity: u32) -> Result<usize, IdentityIndexError> {
        let mask = self
            .keys
            .len()
            .checked_sub(1)
            .ok_or(IdentityIndexError::ArithmeticOverflow)?;
        let mut index = hash(identity) & mask;
        loop {
            if self.epochs[index] != self.epoch || self.keys[index] == identity {
                return Ok(index);
            }
            index = (index + 1) & mask;
        }
    }
}

fn next_epoch(values: &mut [u32], current: u32) -> u32 {
    match current.checked_add(1) {
        Some(epoch) => epoch,
        None => {
            values.fill(0);
            1
        }
    }
}

fn hash(identity: u32) -> usize {
    identity.wrapping_mul(0x9e37_79b1) as usize
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), IdentityIndexError> {
    values
        .try_reserve(additional)
        .map_err(|_| IdentityIndexError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collisions_remain_exact_and_prepare_reuses_storage() {
        let mut index = IdentityIndex::default();
        index.prepare(3).unwrap();
        let capacities = index.capacities();
        index.insert(1, 10).unwrap();
        index.insert(9, 90).unwrap();
        assert_eq!(index.get(1), Some(10));
        assert_eq!(index.get(9), Some(90));
        assert_eq!(index.get(17), None);
        assert_eq!(
            index.insert(1, 11),
            Err(IdentityIndexError::DuplicateIdentity)
        );

        index.prepare(3).unwrap();
        assert_eq!(index.capacities(), capacities);
        assert_eq!(index.get(1), None);
    }
}
