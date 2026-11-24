/**
 * Typed surroundings shared by focused documentation snippets. These names
 * model values established earlier on a page; they do not mask API mistakes.
 */
import type { Font, FontFace } from '@pmndrs/glyph';
import type { bitmap, msdf, slug } from '@pmndrs/glyph';
import type { Text, TextGroup, ThreeHandle, ThreeRoot } from '@pmndrs/glyph/three';
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu';

declare global {
  const handle: ThreeHandle;
  const three: ThreeRoot;
  const root: ThreeRoot;

  const Inter: FontFace<typeof bitmap | typeof msdf | typeof slug>;
  const inter: Font<typeof msdf>;
  const interSlug: Font<typeof slug>;
  const interBitmap: Font<typeof bitmap>;

  const text: Text<typeof msdf>;
  const group: TextGroup;

  const scene: Scene;
  const camera: Camera;
  const renderer: WebGPURenderer;
  const url: string;
}

export {};
