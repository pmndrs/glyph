#![cfg_attr(not(any(feature = "std", test)), no_std)]

extern crate alloc;

#[cfg(feature = "std")]
mod abi_contract;
mod abi_layout;

#[cfg(feature = "artifact-baker")]
mod artifact;
#[cfg(feature = "artifact-baker")]
mod error;
#[cfg(feature = "artifact-baker")]
mod glb;
#[cfg(feature = "artifact-baker")]
mod model;
#[cfg(feature = "artifact-baker")]
mod progress;

#[cfg(all(target_arch = "wasm32", not(feature = "std")))]
mod wasm;

#[cfg(feature = "std")]
pub fn mtsdf_abi_json() -> alloc::string::String {
    abi_contract::json(cfg!(feature = "artifact-baker"))
}

#[cfg(feature = "artifact-baker")]
pub use artifact::{bake_mtsdf, descriptor_raster_key};
#[cfg(feature = "artifact-baker")]
pub use error::{MtsdfBakeError, MtsdfBakeErrorCode};
#[cfg(feature = "artifact-baker")]
pub use model::{
    ArtifactPackaging, MSDF_EXTENSION, MSDF_FORMAT_VERSION, MSDF_GENERATOR_VERSION, MSDF_KIND,
    MTSDF_EM_SIZE, MTSDF_PIXEL_RANGE, MTSDF_PLANE_UNITS_PER_EM, MtsdfBakeArtifactV0,
    MtsdfBakeRequestV0, MtsdfBakeResultV0, MtsdfDescriptorV0, MtsdfPackagingV0, MtsdfPageReportV0,
    MtsdfPayloadReportV0, PagePackaging,
};
