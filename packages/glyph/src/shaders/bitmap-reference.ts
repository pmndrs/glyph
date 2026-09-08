/**
 * CPU reference math for the Bitmap technique, independent of TypeGPU and GPU texture
 * behavior. Every function mirrors one exported shader function of
 * `bitmap-shader.js` operation for operation, so a simulation of the shipped TypeGPU
 * functions can be pinned to these values exactly.
 */

export type BitmapVec2 = readonly [number, number];
export type BitmapVec3 = readonly [number, number, number];
export type BitmapVec4 = readonly [number, number, number, number];

/** CPU mirror of `bitmapAtlasUv`. */
export function referenceBitmapAtlasUv(uvOrigin: BitmapVec2, uvSize: BitmapVec2, quadUv: BitmapVec2): BitmapVec2 {
  return [uvOrigin[0] + quadUv[0] * uvSize[0], uvOrigin[1] + quadUv[1] * uvSize[1]];
}

/** CPU mirror of `bitmapQuadPosition`. */
export function referenceBitmapQuadPosition(
  origin: BitmapVec2,
  size: BitmapVec2,
  quadPosition: BitmapVec2,
): BitmapVec3 {
  return [origin[0] + quadPosition[0] * size[0], -(origin[1] + quadPosition[1] * size[1]), 0];
}

/**
 * CPU mirror of the projection step behind `projectClipPosition`, over an explicit
 * column-major matrix: `clip = mvp * vec4(position, 1)` with WGSL's column-times-
 * vector contraction.
 */
export function referenceProjectClipPosition(mvp: readonly number[], position: BitmapVec3): BitmapVec4 {
  const x = position[0];
  const y = position[1];
  const z = position[2];
  const w = 1;
  return [
    mvp[0]! * x + mvp[4]! * y + mvp[8]! * z + mvp[12]! * w,
    mvp[1]! * x + mvp[5]! * y + mvp[9]! * z + mvp[13]! * w,
    mvp[2]! * x + mvp[6]! * y + mvp[10]! * z + mvp[14]! * w,
    mvp[3]! * x + mvp[7]! * y + mvp[11]! * z + mvp[15]! * w,
  ];
}

/**
 * CPU mirror of `snapClipAxis`, including the final multiplication by clip w and the
 * reciprocal-multiply order of the emitted shader.
 */
export function referenceSnapClipAxis(clipAxis: number, clipW: number, physicalSize: number): number {
  const normalizedDevicePosition = clipAxis * (1 / clipW);
  const physicalPosition = (normalizedDevicePosition + 1) * (physicalSize * 0.5);
  return (Math.round(physicalPosition) * (1 / physicalSize) * 2 - 1) * clipW;
}

/** CPU mirror of the snapped vertex variant's clip placement. */
export function referenceSnappedClipPosition(clip: BitmapVec4, screenSize: BitmapVec2): BitmapVec4 {
  return [
    referenceSnapClipAxis(clip[0], clip[3], screenSize[0]),
    referenceSnapClipAxis(clip[1], clip[3], screenSize[1]),
    clip[2],
    clip[3],
  ];
}

/**
 * CPU mirror of `bitmapPageCoverage`: clamp-to-edge, texel-grid scaling, floor, bound
 * clamping, exact texel fetch. Returns the linear texel index the fetch lands on.
 */
export function referenceBitmapPageCoverage(dimensions: BitmapVec2, atlasUv: BitmapVec2): number {
  const clampedUv = [clamp(atlasUv[0], 0, 1), clamp(atlasUv[1], 0, 1)] as const;
  const texelCoord = [Math.floor(clampedUv[0] * dimensions[0]), Math.floor(clampedUv[1] * dimensions[1])] as const;
  const boundedCoord = [
    clamp(texelCoord[0], 0, dimensions[0] - 1),
    clamp(texelCoord[1], 0, dimensions[1] - 1),
  ] as const;
  return boundedCoord[0] + boundedCoord[1] * dimensions[0];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** CPU mirror of `bitmapPaint`. */
export function referenceBitmapPaint(
  coverage: number,
  color: BitmapVec4,
): {
  coverage: number;
  color: BitmapVec3;
  opacity: number;
} {
  return { coverage, color: [color[0], color[1], color[2]], opacity: color[3] * coverage };
}
