import * as THREE from 'three/webgpu';

import { decodeEmbeddedLosslessAtlasPage, type LosslessAtlasFormat, type RasterAtlasPage } from './raster-atlas.js';
import type { JsonValue, RegisteredRaster } from '../raster.js';

export interface ThreeRasterAtlasPage {
  readonly width: number;
  readonly height: number;
  readonly texture: THREE.DataTexture;
}

export interface ThreeLosslessAtlasFormat extends LosslessAtlasFormat {
  readonly textureFormat: THREE.PixelFormat;
  readonly generateMipmaps: boolean;
  readonly minFilter: THREE.MinificationTextureFilter;
}

/** Adapt one validated renderer-neutral atlas page into a Three.js texture. */
export function decodeEmbeddedLosslessThreeAtlasPage(
  raster: RegisteredRaster,
  value: JsonValue,
  path: string,
  format: ThreeLosslessAtlasFormat,
): ThreeRasterAtlasPage {
  return createThreeRasterAtlasPage(decodeEmbeddedLosslessAtlasPage(raster, value, path, format), format);
}

function createThreeRasterAtlasPage(page: RasterAtlasPage, format: ThreeLosslessAtlasFormat): ThreeRasterAtlasPage {
  const texture = new THREE.DataTexture(
    page.bytes,
    page.width,
    page.height,
    format.textureFormat,
    THREE.UnsignedByteType,
  );
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = true;
  texture.generateMipmaps = format.generateMipmaps;
  texture.minFilter = format.minFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { width: page.width, height: page.height, texture };
}
