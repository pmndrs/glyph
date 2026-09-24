import { trait } from 'koota';
import type { Camera, Mesh, Object3D, Scene, WebGPURenderer } from 'three/webgpu';
import type { Projection } from './renderer';

/** A stained-glass draw's clone in a capture, and what it last drew. */
export interface CapturedPane {
  original: Mesh;
  capture: Mesh;
  /** The height above which the pane casts nothing. */
  ceiling: number;
  /** The world matrix last drawn. */
  drawn: Float32Array;
  /** Whether the pane showed when last drawn, undefined until its first drawing. */
  shown: boolean | undefined;
}

/** Clones of every stained-glass draw, in a scene of their own, and what they last drew, to tell moved glass from still. */
export interface GlassCapture {
  readonly sourceScene: Scene;
  captures: CapturedPane[];
  /** The draw groups the captures were taken from. A new group, as after a remount, is captured afresh. */
  capturedFrom: Object3D[];
  /** The title's letter transforms as last drawn: they live in one instanced draw whose own matrix never moves. */
  letters: Float64Array;
}

/** The glass as the scene camera sees it, captured before the frame for the lens to read. */
export interface Lens extends GlassCapture {
  readonly renderer: WebGPURenderer;
  readonly camera: Camera;
}

/** The mounted shadow projection under its lamp, and the lens capture taken from the scene camera. */
export const ShadowView = trait((): Projection | undefined => undefined);
export const LensView = trait((): Lens | undefined => undefined);
