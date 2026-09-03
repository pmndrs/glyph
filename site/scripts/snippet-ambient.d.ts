/**
 * Names a docs snippet may use without declaring them. A snippet shows one
 * idea; the handle, the scene, and a loaded face are the surroundings every
 * page has already established. Keep this list short and typed from the
 * package itself, so a snippet that uses a name wrongly still fails.
 */
import type { Font, FontFace } from '@pmndrs/glyph';
import type { Text, TextGroup, ThreeHandle, ThreeRoot } from '@pmndrs/glyph/three';
import type { bitmap } from '@pmndrs/glyph/three/bitmap';
import type { msdf } from '@pmndrs/glyph/three/msdf';
import type { slug } from '@pmndrs/glyph/three/slug';
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu';

declare global {
  /** The page's Three handle and its anonymous root. */
  const handle: ThreeHandle;
  const three: ThreeRoot;
  const root: ThreeRoot;
  /** A face declared with every shipped format, already loaded. */
  const Inter: FontFace<typeof msdf | typeof slug | ReturnType<typeof bitmap>>;
  /** Loaded fonts by format, as a hook or `Inter.<format>` would give them. */
  const inter: Font<typeof msdf>;
  const interSlug: Font<typeof slug>;
  const interBitmap: Font<typeof bitmap>;
  /** A text already created on the root. */
  const text: Text<typeof msdf>;
  const group: TextGroup;
  /** The host's scene graph. */
  const scene: Scene;
  const camera: Camera;
  const renderer: WebGPURenderer;
  const url: string;
}
export {};
