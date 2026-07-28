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
pub fn slug_abi_json() -> alloc::string::String {
    abi_contract::json()
}

#[cfg(feature = "artifact-baker")]
pub use artifact::{bake_slug, descriptor_raster_key};
#[cfg(feature = "artifact-baker")]
pub use error::{SlugBakeError, SlugBakeErrorCode};
#[cfg(feature = "artifact-baker")]
pub use model::{
    ArtifactPackaging, PagePackaging, SLUG_EXTENSION, SLUG_FORMAT_VERSION, SLUG_GENERATOR_VERSION,
    SLUG_KIND, SLUG_PLANE_UNITS_PER_EM, SlugBakeArtifactV0, SlugBakeRequestV0, SlugBakeResultV0,
    SlugDescriptorV0, SlugPackagingV0, SlugPageReportV0, SlugPayloadReportV0,
};
