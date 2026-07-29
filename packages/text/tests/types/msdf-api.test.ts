import { defineFont, type RegisteredFont, type RegisteredRaster } from '@pmndrs/text'
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
  msdfRasterKey,
  type MsdfDrawBatch,
  type MsdfOptions,
  type MsdfResource,
} from '@pmndrs/text/raster/msdf'

const descriptor = msdfDescriptor()
const configuredDescriptor = msdfDescriptor({ emSize: 32, pixelRange: 6 })
const configuredOptions: MsdfOptions = { emSize: 32, pixelRange: 6 }
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
void configuredDescriptor
void configuredOptions
void kind
void resource
void batch
void validation
void msdfDescriptorRasterKey()
void msdfRasterKey({ emSize: 32, pixelRange: 4 })
void defineFont('/fonts/Inter-Regular.ttf', msdf)
void defineFont('/fonts/Inter-Regular.ttf', {
  module: msdf,
  options: { emSize: 32, pixelRange: 6 },
})

// @ts-expect-error MTSDF emSize is numeric.
msdfDescriptor({ emSize: '32' })

// @ts-expect-error MTSDF options reject unknown fields.
msdfDescriptor({ emSize: 32, quality: 'high' })
