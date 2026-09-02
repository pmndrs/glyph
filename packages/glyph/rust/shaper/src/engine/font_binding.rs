//! Normalized renderer data owned by one shaping font.

use alloc::vec::Vec;

use super::codec::TechniqueId;

pub const MAX_BINDING_FIELDS: u8 = 32;
pub const MISSING_RESOURCE_INDEX: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FontResource {
    pub id: u32,
    pub generation: u32,
    pub kind: u16,
    pub reference: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FontStrike {
    /// Pixels per em. Zero identifies the sole scalable strike used by MSDF and Slug.
    pub ppem: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FieldTable<T> {
    row_count: u32,
    field_count: u8,
    /// Field-major values: every field is one contiguous `row_count` lane.
    values: Vec<T>,
}

impl<T> FieldTable<T> {
    pub fn new(row_count: u32, field_count: u8, values: Vec<T>) -> Result<Self, FontBindingError> {
        let expected = usize::try_from(row_count)
            .ok()
            .and_then(|rows| rows.checked_mul(usize::from(field_count)))
            .ok_or(FontBindingError::ArithmeticOverflow)?;
        if field_count > MAX_BINDING_FIELDS || values.len() != expected {
            return Err(FontBindingError::InvalidFieldTable);
        }
        Ok(Self {
            row_count,
            field_count,
            values,
        })
    }

    pub fn row_count(&self) -> u32 {
        self.row_count
    }

    pub fn field_count(&self) -> u8 {
        self.field_count
    }

    pub fn field(&self, field: u8) -> Option<&[T]> {
        if field >= self.field_count {
            return None;
        }
        let rows = usize::try_from(self.row_count).ok()?;
        let start = usize::from(field).checked_mul(rows)?;
        self.values.get(start..start.checked_add(rows)?)
    }

    pub fn values(&self) -> &[T] {
        &self.values
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FontRenderBinding {
    technique: TechniqueId,
    program_variant: u16,
    glyph_count: u32,
    strikes: Vec<FontStrike>,
    resources: Vec<FontResource>,
    resource_indices: Vec<u32>,
    glyph_f32: FieldTable<f32>,
    glyph_u32: FieldTable<u32>,
    strike_f32: FieldTable<f32>,
    strike_u32: FieldTable<u32>,
    resource_f32: FieldTable<f32>,
    resource_u32: FieldTable<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SelectedGlyphBinding {
    pub strike: u32,
    pub strike_row: u32,
    pub resource: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FontBindingError {
    InvalidTechnique,
    InvalidGlyphCount,
    InvalidStrikes,
    InvalidResources,
    InvalidResourceIndex,
    InvalidFieldTable,
    ArithmeticOverflow,
}

#[allow(clippy::too_many_arguments)]
impl FontRenderBinding {
    pub fn new(
        technique: TechniqueId,
        program_variant: u16,
        glyph_count: u32,
        strikes: Vec<FontStrike>,
        resources: Vec<FontResource>,
        resource_indices: Vec<u32>,
        glyph_f32: FieldTable<f32>,
        glyph_u32: FieldTable<u32>,
        strike_f32: FieldTable<f32>,
        strike_u32: FieldTable<u32>,
        resource_f32: FieldTable<f32>,
        resource_u32: FieldTable<u32>,
    ) -> Result<Self, FontBindingError> {
        if technique.0 == 0 {
            return Err(FontBindingError::InvalidTechnique);
        }
        if glyph_count == 0 {
            return Err(FontBindingError::InvalidGlyphCount);
        }
        validate_strikes(&strikes)?;
        validate_resources(&resources)?;
        let strike_rows = glyph_count
            .checked_mul(
                u32::try_from(strikes.len()).map_err(|_| FontBindingError::ArithmeticOverflow)?,
            )
            .ok_or(FontBindingError::ArithmeticOverflow)?;
        if resource_indices.len() != usize::try_from(strike_rows).unwrap_or(usize::MAX)
            || resource_indices.iter().any(|&resource| {
                resource != MISSING_RESOURCE_INDEX
                    && usize::try_from(resource).map_or(true, |index| index >= resources.len())
            })
        {
            return Err(FontBindingError::InvalidResourceIndex);
        }
        let resource_count =
            u32::try_from(resources.len()).map_err(|_| FontBindingError::ArithmeticOverflow)?;
        if glyph_f32.row_count() != glyph_count
            || glyph_u32.row_count() != glyph_count
            || strike_f32.row_count() != strike_rows
            || strike_u32.row_count() != strike_rows
            || resource_f32.row_count() != resource_count
            || resource_u32.row_count() != resource_count
        {
            return Err(FontBindingError::InvalidFieldTable);
        }
        Ok(Self {
            technique,
            program_variant,
            glyph_count,
            strikes,
            resources,
            resource_indices,
            glyph_f32,
            glyph_u32,
            strike_f32,
            strike_u32,
            resource_f32,
            resource_u32,
        })
    }

    pub fn technique(&self) -> TechniqueId {
        self.technique
    }

    pub fn program_variant(&self) -> u16 {
        self.program_variant
    }

    pub fn glyph_count(&self) -> u32 {
        self.glyph_count
    }

    pub fn strikes(&self) -> &[FontStrike] {
        &self.strikes
    }

    pub fn resources(&self) -> &[FontResource] {
        &self.resources
    }

    pub fn glyph_f32(&self) -> &FieldTable<f32> {
        &self.glyph_f32
    }

    pub fn glyph_u32(&self) -> &FieldTable<u32> {
        &self.glyph_u32
    }

    pub fn strike_f32(&self) -> &FieldTable<f32> {
        &self.strike_f32
    }

    pub fn strike_u32(&self) -> &FieldTable<u32> {
        &self.strike_u32
    }

    pub fn resource_f32(&self) -> &FieldTable<f32> {
        &self.resource_f32
    }

    pub fn resource_u32(&self) -> &FieldTable<u32> {
        &self.resource_u32
    }

    pub fn select(
        &self,
        glyph: u32,
        font_size: f32,
        raster_pixel_ratio: f32,
    ) -> Option<SelectedGlyphBinding> {
        if glyph >= self.glyph_count
            || !font_size.is_finite()
            || font_size <= 0.0
            || !raster_pixel_ratio.is_finite()
            || raster_pixel_ratio <= 0.0
        {
            return None;
        }
        let target = font_size * raster_pixel_ratio;
        if !target.is_finite() {
            return None;
        }
        let strike = if self.strikes.len() == 1 && self.strikes[0].ppem == 0 {
            0
        } else {
            nearest_strike(&self.strikes, target)
        };
        let strike = u32::try_from(strike).ok()?;
        let strike_row = strike.checked_mul(self.glyph_count)?.checked_add(glyph)?;
        let resource = *self
            .resource_indices
            .get(usize::try_from(strike_row).ok()?)?;
        (resource != MISSING_RESOURCE_INDEX).then_some(SelectedGlyphBinding {
            strike,
            strike_row,
            resource,
        })
    }
}

fn validate_strikes(strikes: &[FontStrike]) -> Result<(), FontBindingError> {
    if strikes.is_empty() || strikes.len() > usize::from(u16::MAX) {
        return Err(FontBindingError::InvalidStrikes);
    }
    if strikes[0].ppem == 0 {
        return if strikes.len() == 1 {
            Ok(())
        } else {
            Err(FontBindingError::InvalidStrikes)
        };
    }
    if strikes.windows(2).any(|pair| pair[0].ppem >= pair[1].ppem) {
        return Err(FontBindingError::InvalidStrikes);
    }
    Ok(())
}

fn validate_resources(resources: &[FontResource]) -> Result<(), FontBindingError> {
    if resources.is_empty()
        || resources.len() > usize::from(u16::MAX)
        || resources.iter().any(|resource| {
            resource.id == 0 || resource.generation == 0 || !(1..=32).contains(&resource.kind)
        })
        || resources.windows(2).any(|pair| pair[0].id >= pair[1].id)
    {
        return Err(FontBindingError::InvalidResources);
    }
    Ok(())
}

fn nearest_strike(strikes: &[FontStrike], target: f32) -> usize {
    let mut selected = 0;
    let mut distance = ((strikes[0].ppem as f64) - f64::from(target)).abs();
    for (index, strike) in strikes.iter().enumerate().skip(1) {
        let candidate = ((strike.ppem as f64) - f64::from(target)).abs();
        if candidate < distance {
            selected = index;
            distance = candidate;
        }
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn table<T>(rows: u32, fields: u8, values: Vec<T>) -> FieldTable<T> {
        FieldTable::new(rows, fields, values).unwrap()
    }

    fn binding(strikes: Vec<FontStrike>, indices: Vec<u32>) -> FontRenderBinding {
        let glyph_count = 3;
        let strike_rows = glyph_count * strikes.len() as u32;
        FontRenderBinding::new(
            TechniqueId(7),
            2,
            glyph_count,
            strikes,
            vec![
                FontResource {
                    id: 11,
                    generation: 1,
                    kind: 2,
                    reference: 91,
                },
                FontResource {
                    id: 12,
                    generation: 1,
                    kind: 2,
                    reference: 92,
                },
            ],
            indices,
            table(glyph_count, 1, vec![1.0, 2.0, 3.0]),
            table(glyph_count, 0, vec![]),
            table(strike_rows, 0, vec![]),
            table(strike_rows, 1, (0..strike_rows).collect()),
            table(2, 0, vec![]),
            table(2, 1, vec![100, 200]),
        )
        .unwrap()
    }

    #[test]
    fn scalable_and_bitmap_selection_share_one_dense_address_model() {
        let scalable = binding(vec![FontStrike { ppem: 0 }], vec![0, 0, 1]);
        assert_eq!(
            scalable.select(2, 300.0, 2.0),
            Some(SelectedGlyphBinding {
                strike: 0,
                strike_row: 2,
                resource: 1,
            })
        );

        let bitmap = binding(
            vec![FontStrike { ppem: 16 }, FontStrike { ppem: 32 }],
            vec![0, 0, MISSING_RESOURCE_INDEX, 1, 1, 0],
        );
        assert_eq!(bitmap.select(1, 12.0, 2.0).unwrap().strike, 0);
        assert_eq!(bitmap.select(1, 12.1, 2.0).unwrap().strike, 1);
        assert_eq!(bitmap.select(2, 8.0, 2.0), None);
        assert_eq!(bitmap.select(2, 16.0, 2.0).unwrap().resource, 0);
    }

    #[test]
    fn rejects_noncanonical_strikes_resources_and_field_shapes() {
        let glyph = table(1, 0, Vec::<f32>::new());
        let empty_u32 = table(1, 0, Vec::<u32>::new());
        assert_eq!(
            FontRenderBinding::new(
                TechniqueId(1),
                0,
                1,
                vec![FontStrike { ppem: 0 }, FontStrike { ppem: 16 }],
                vec![FontResource {
                    id: 1,
                    generation: 1,
                    kind: 1,
                    reference: 0,
                }],
                vec![0, 0],
                glyph.clone(),
                empty_u32.clone(),
                table(2, 0, vec![]),
                table(2, 0, vec![]),
                table(1, 0, vec![]),
                table(1, 0, vec![]),
            ),
            Err(FontBindingError::InvalidStrikes)
        );
        assert_eq!(
            FieldTable::new(2, 1, vec![0_u32]),
            Err(FontBindingError::InvalidFieldTable)
        );
        assert_eq!(
            FieldTable::new(1, MAX_BINDING_FIELDS + 1, vec![0_u32; 33]),
            Err(FontBindingError::InvalidFieldTable)
        );

        let mut unsorted = binding(vec![FontStrike { ppem: 0 }], vec![0, 0, 1]);
        unsorted.resources.swap(0, 1);
        assert_eq!(
            validate_resources(&unsorted.resources),
            Err(FontBindingError::InvalidResources)
        );
    }
}
