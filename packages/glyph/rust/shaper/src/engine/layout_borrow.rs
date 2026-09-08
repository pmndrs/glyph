#[repr(C)]
#[derive(Clone, Copy, Default)]
pub(crate) struct BorrowedLayoutDescriptor {
    pub generation: u32,
    pub root_id: u32,
    pub paragraph_id: u32,
    pub glyph_count: u32,
}

impl BorrowedLayoutDescriptor {
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub fn matches(self, root_id: u32, paragraph_id: u32, generation: u32) -> bool {
        generation != 0
            && self.generation == generation
            && self.root_id == root_id
            && self.paragraph_id == paragraph_id
    }
}

const _: () = assert!(core::mem::size_of::<BorrowedLayoutDescriptor>() == 16);
