// What the PixiJS 3D parity page (`pixi3d-parity-proof.ts`) reports to its driver script.
export type Pixi3DBackend = 'webgpu' | 'webgl';

export interface Pixi3DParityCapture {
  readonly width: number;
  readonly height: number;
  /** Base64 RGBA rows, top first, drawn by `@pmndrs/glyph-pixi3d`. */
  readonly pixi: string;
  /** The same scene drawn by Glyph's Three renderer on WebGPU at the same camera. */
  readonly three: string;
  /** Mesh3D children the Pixi renderer published for the scene. */
  readonly meshes: number;
}

export interface Pixi3DParityProof {
  readonly backend: Pixi3DBackend;
  readonly scenes: readonly string[];
  capture(scene: string): Promise<Pixi3DParityCapture>;
  /** RGBA rows to a PNG file, both base64; the pixels are opaque, so the encoding is exact. */
  toPng(rgba: string, width: number, height: number): Promise<string>;
}

declare global {
  interface Window {
    pixi3dParity: Promise<Pixi3DParityProof>;
  }
}
