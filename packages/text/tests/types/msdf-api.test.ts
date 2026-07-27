import type { RegisteredFont, RegisteredRaster } from '@pmndrs/text'
import {
  validateMtsdfArtifact,
  type MtsdfArtifactValidationContext,
  type ValidatedMtsdfArtifactV0,
} from '@pmndrs/text/bakers/msdf/validate'
import {
  MSDF_KIND,
  msdf,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  type MsdfDrawBatch,
  type MsdfResource,
} from '@pmndrs/text/raster/msdf'

const descriptor = msdfDescriptor()
const kind: 'msdf' = MSDF_KIND
const requestModule = msdf
declare const font: RegisteredFont
declare const raster: RegisteredRaster<'msdf'>
const resource: Promise<MsdfResource> = requestModule.decode(font, raster)
declare const batch: MsdfDrawBatch
declare const artifactBytes: Uint8Array
declare const validationContext: MtsdfArtifactValidationContext
const validation: Promise<ValidatedMtsdfArtifactV0> = validateMtsdfArtifact(
  artifactBytes,
  validationContext,
)

void descriptor
void kind
void resource
void batch
void validation
void msdfDescriptorRasterKey()
