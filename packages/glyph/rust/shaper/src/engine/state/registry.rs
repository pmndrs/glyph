//! Font bindings, font stacks and codecs registered with the engine, shared by every root.

use super::*;

impl TextEngine {
    pub fn initialize(&mut self) -> Result<(), EngineError> {
        self.gather
            .reserve_records(DEFAULT_GATHER_RECORD_CAPACITY)
            .map_err(gather_error)
    }

    pub fn register_font_binding(
        &mut self,
        handle: u32,
        shaping_handle: u32,
        shaping_glyph_count: u32,
        binding: FontRenderBinding,
    ) -> Result<(), EngineError> {
        if handle == 0 || shaping_handle == 0 || binding.glyph_count() != shaping_glyph_count {
            return Err(EngineError::InvalidRequest);
        }
        if let Some(existing) = self
            .font_bindings
            .iter()
            .find(|registered| registered.handle == handle)
        {
            return if existing.shaping_handle == shaping_handle && existing.binding == binding {
                Ok(())
            } else {
                Err(EngineError::HandleConflict)
            };
        }
        self.font_bindings
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.font_bindings.push(RegisteredFontBinding {
            handle,
            shaping_handle,
            binding,
        });
        self.invalidate_gather_cache();
        Ok(())
    }

    pub fn dispose_font_binding(&mut self, handle: u32) {
        if let Some(index) = self
            .font_bindings
            .iter()
            .position(|binding| binding.handle == handle)
        {
            self.font_bindings.swap_remove(index);
            self.invalidate_gather_cache();
        }
    }

    pub fn font_binding(&self, handle: u32) -> Option<&FontRenderBinding> {
        self.font_bindings
            .iter()
            .find(|binding| binding.handle == handle)
            .map(|binding| &binding.binding)
    }

    pub(super) fn registered_font_binding(&self, handle: u32) -> Option<&RegisteredFontBinding> {
        self.font_bindings
            .iter()
            .find(|binding| binding.handle == handle)
    }

    pub fn shaping_handle_for_binding(&self, handle: u32) -> Option<u32> {
        self.registered_font_binding(handle)
            .map(|binding| binding.shaping_handle)
    }

    pub fn dispose_bindings_for_shaping_font(&mut self, shaping_handle: u32) {
        let previous_len = self.font_bindings.len();
        self.font_bindings
            .retain(|binding| binding.shaping_handle != shaping_handle);
        if self.font_bindings.len() != previous_len {
            self.invalidate_gather_cache();
        }
    }

    pub fn font_binding_count(&self) -> u32 {
        self.font_bindings.len().try_into().unwrap_or(u32::MAX)
    }

    pub fn register_font_stack(&mut self, handle: u32, fonts: &[u32]) -> Result<(), EngineError> {
        if handle == 0
            || fonts.is_empty()
            || fonts.len() > usize::from(u16::MAX)
            || fonts.contains(&0)
            || fonts
                .iter()
                .enumerate()
                .any(|(index, font)| fonts[..index].contains(font))
        {
            return Err(EngineError::InvalidRequest);
        }
        let insertion = match self
            .font_stacks
            .binary_search_by_key(&handle, |stack| stack.handle)
        {
            Ok(index) => {
                return if self.font_stacks[index].fonts == fonts {
                    Ok(())
                } else {
                    Err(EngineError::HandleConflict)
                };
            }
            Err(index) => index,
        };
        let mut retained = Vec::new();
        retained
            .try_reserve_exact(fonts.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        retained.extend_from_slice(fonts);
        self.font_stacks
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.font_stacks.insert(
            insertion,
            RegisteredFontStack {
                handle,
                fonts: retained,
            },
        );
        Ok(())
    }

    pub fn dispose_font_stack(&mut self, handle: u32) -> Result<(), EngineError> {
        let index = self
            .font_stacks
            .binary_search_by_key(&handle, |stack| stack.handle)
            .map_err(|_| EngineError::FontStackMissing)?;
        if self
            .planners
            .values()
            .any(|planner| planner.references_font_stack(handle))
        {
            return Err(EngineError::RegistrationInUse);
        }
        self.font_stacks.remove(index);
        Ok(())
    }

    pub fn font_stack(&self, handle: u32) -> Result<&[u32], EngineError> {
        self.font_stacks
            .binary_search_by_key(&handle, |stack| stack.handle)
            .ok()
            .map(|index| self.font_stacks[index].fonts.as_slice())
            .ok_or(EngineError::FontStackMissing)
    }

    pub fn font_stack_count(&self) -> u32 {
        self.font_stacks.len().try_into().unwrap_or(u32::MAX)
    }

    pub fn references_binding(&self, handle: u32) -> bool {
        self.font_stacks
            .iter()
            .any(|stack| stack.fonts.contains(&handle))
    }

    pub fn references_shaping_font(&self, shaping_handle: u32) -> bool {
        self.font_stacks.iter().any(|stack| {
            stack
                .fonts
                .iter()
                .any(|handle| self.shaping_handle_for_binding(*handle) == Some(shaping_handle))
        })
    }

    pub fn register_codec(
        &mut self,
        handle: u32,
        codec: ValidatedCodec,
    ) -> Result<(), EngineError> {
        if handle == 0 {
            return Err(EngineError::InvalidHandle);
        }
        if let Some(existing) = self.codecs.get(&handle) {
            return if existing == &codec {
                Ok(())
            } else {
                Err(EngineError::HandleConflict)
            };
        }
        self.gather
            .reserve_codec(&codec, DEFAULT_GATHER_RECORD_CAPACITY)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.codecs.insert(handle, codec);
        self.invalidate_gather_cache();
        Ok(())
    }

    pub fn dispose_codec(&mut self, handle: u32) -> Result<(), EngineError> {
        if self.planners.values().any(|planner| {
            planner
                .codec_binding
                .is_some_and(|binding| binding.handle == handle)
        }) {
            return Err(EngineError::RegistrationInUse);
        }
        self.codecs
            .remove(&handle)
            .ok_or(EngineError::CodecMissing)?;
        self.invalidate_gather_cache();
        Ok(())
    }

    pub fn codec(&self, handle: u32) -> Result<&ValidatedCodec, EngineError> {
        self.codecs.get(&handle).ok_or(EngineError::CodecMissing)
    }

    pub fn codec_count(&self) -> u32 {
        self.codecs.len().try_into().unwrap_or(u32::MAX)
    }
}

pub(super) fn find_font_stack(
    font_stacks: &[RegisteredFontStack],
    handle: u32,
) -> Result<&RegisteredFontStack, EngineError> {
    font_stacks
        .binary_search_by_key(&handle, |stack| stack.handle)
        .ok()
        .and_then(|index| font_stacks.get(index))
        .ok_or(EngineError::FontStackMissing)
}

pub(super) fn find_font_binding(
    font_bindings: &[RegisteredFontBinding],
    handle: u32,
) -> Result<&RegisteredFontBinding, EngineError> {
    font_bindings
        .iter()
        .find(|binding| binding.handle == handle)
        .ok_or(EngineError::FontStackMissing)
}
