import type { RegisteredFont, RegisteredRaster } from '@pmndrs/text';
import {
  validateMtsdfArtifact,
  type MtsdfArtifactValidationContext,
  type ValidatedMtsdfArtifactV0,
} from '@pmndrs/text/bakers/msdf/validate';
import {
  MTSDF_KIND,
  mtsdf,
  mtsdfDescriptor,
  mtsdfDescriptorRasterKey,
  mtsdfRasterKey,
  type MtsdfData,
  type MtsdfOptions,
} from '@pmndrs/text/raster/mtsdf';

const descriptor = mtsdfDescriptor();
const configuredDescriptor = mtsdfDescriptor({ emSize: 32, pixelRange: 6 });
const configuredOptions: MtsdfOptions = { emSize: 32, pixelRange: 6 };
const kind: 'msdf' = MTSDF_KIND;
declare const font: RegisteredFont;
declare const raster: RegisteredRaster<'msdf'>;
const data: Promise<MtsdfData> = mtsdf.decode(font, raster);
declare const artifactBytes: Uint8Array;
declare const validationContext: MtsdfArtifactValidationContext;
const validation: Promise<ValidatedMtsdfArtifactV0> = validateMtsdfArtifact(artifactBytes, validationContext);

void descriptor;
void configuredDescriptor;
void configuredOptions;
void kind;
void data;
void validation;
void mtsdfDescriptorRasterKey();
void mtsdfRasterKey({ emSize: 32, pixelRange: 4 });

// @ts-expect-error MTSDF emSize is numeric.
mtsdfDescriptor({ emSize: '32' });

// @ts-expect-error MTSDF options reject unknown fields.
mtsdfDescriptor({ emSize: 32, quality: 'high' });
