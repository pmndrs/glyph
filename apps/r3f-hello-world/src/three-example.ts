import { glyph, type AnyRasterFormat } from '@pmndrs/glyph';
import { ThreeConfig, type Text } from '@pmndrs/glyph/three';
import { Color, NoToneMapping, OrthographicCamera, Scene, WebGPURenderer } from 'three/webgpu';

import latinFontUrl from '../assets/inter-latin.font.glb?url';

interface ThreeExampleState {
  readonly renderer: WebGPURenderer;
  readonly scene: Scene;
  readonly text: Text<AnyRasterFormat>;
}

let mountedState: ThreeExampleState | undefined;

/** Imperative twin of the R3F example, using only the public Glyph and Three APIs. */
export async function mountThreeExample(root: HTMLElement): Promise<() => void> {
  await glyph.init();

  const handle = glyph.handle('examples:three', ThreeConfig);
  const inter = glyph.fontFace({ baked: latinFontUrl });
  const renderer = new WebGPURenderer({ antialias: true });
  const scene = new Scene();
  const camera = new OrthographicCamera();
  let text: Text<AnyRasterFormat> | undefined;
  let disposed = false;

  renderer.domElement.dataset.example = 'three';
  renderer.toneMapping = NoToneMapping;
  scene.background = new Color('#07090f');
  camera.near = -1_000;
  camera.far = 1_000;
  camera.position.z = 10;
  root.append(renderer.domElement);

  try {
    // The FontFace owns renderer-neutral loading; the handle binds its selected format when Text uses it.
    await inter.load();
    text = handle.createText({
      constraints: { width: { mode: 'exact', size: root.clientWidth } },
      font: inter,
      layout: { align: 'center', wrap: 'none' },
      style: { color: '#f4f7ff', fontSize: 64, lineHeight: 1 },
      text: 'Hello world',
    });
    text.name = 'three-hello-world';
    scene.add(text);

    resizeThreeExample(root, renderer, camera, text);

    // shape() publishes semantic state and attaches planned Mesh batches to the handle root's
    // scene-level draw object. Text remains the semantic/transform node rather than owning draws.
    // No scene, canvas, or host renderer was needed before this point.
    glyph.shape();

    // WebGPURenderer owns the canvas/backend and performs the actual host draw later.
    await renderer.init();
    renderer.render(scene, camera);
    mountedState = Object.freeze({ renderer, scene, text });
  } catch (error) {
    text?.dispose();
    inter.dispose();
    handle.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }

  const onResize = (): void => {
    if (disposed || text === undefined) return;
    resizeThreeExample(root, renderer, camera, text);
    glyph.shape();
    renderer.render(scene, camera);
  };
  window.addEventListener('resize', onResize);

  return () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', onResize);
    mountedState = undefined;
    text?.dispose();
    inter.dispose();
    handle.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

/** Package-private browser probe surface; application code does not need renderer introspection. */
export function inspectThreeExample(): ThreeExampleState | undefined {
  return mountedState;
}

function resizeThreeExample(
  root: HTMLElement,
  renderer: WebGPURenderer,
  camera: OrthographicCamera,
  text: Text<AnyRasterFormat>,
): void {
  const width = root.clientWidth;
  const height = root.clientHeight;
  const pixelRatio = Math.min(window.devicePixelRatio, 2);

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();

  text.position.set(-width / 2, 32, 0);
  text.constraints = { width: { mode: 'exact', size: width } };
}
