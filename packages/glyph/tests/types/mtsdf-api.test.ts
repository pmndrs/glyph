import type { RasterDecodeArtifact, RasterDecodeFont, RasterKey } from '@pmndrs/glyph';
import {
  validateMsdfArtifact,
  type MsdfArtifactValidationContext,
  type ValidatedMsdfArtifact,
} from '../../dist/bakers/msdf-validator.js';
import {
  MSDF_KIND,
  msdf,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  msdfRasterKey,
  type MsdfData,
  type MsdfOptions,
} from '@pmndrs/glyph/raster/msdf';

const descriptor = msdfDescriptor();
const configuredDescriptor = msdfDescriptor({ emSize: 32, pixelRange: 6 });
const configuredOptions: MsdfOptions = { emSize: 32, pixelRange: 6 };
const kind: 'msdf' = MSDF_KIND;
declare const font: RasterDecodeFont;
declare const raster: RasterDecodeArtifact<'msdf'>;
const data: Promise<MsdfData> = msdf.decode(font, raster);
declare const artifactBytes: Uint8Array;
declare const validationContext: MsdfArtifactValidationContext;
const validation: Promise<ValidatedMsdfArtifact> = validateMsdfArtifact(artifactBytes, validationContext);

void descriptor;
void configuredDescriptor;
void configuredOptions;
void kind;
void data;
void validation;
const descriptorRasterKey: RasterKey = msdfDescriptorRasterKey();
const configuredRasterKey: RasterKey = msdfRasterKey({ emSize: 32, pixelRange: 4 });
void descriptorRasterKey;
void configuredRasterKey;

// @ts-expect-error MSDF emSize is numeric.
msdfDescriptor({ emSize: '32' });

// @ts-expect-error MSDF options reject unknown fields.
msdfDescriptor({ emSize: 32, quality: 'high' });
