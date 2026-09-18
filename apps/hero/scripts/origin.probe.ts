/* @workflow {
  "name": "hero:origin-check",
  "summary": "Verify the origin scene's playing video, masked word, and story column on WebGPU.",
  "requirements": "Workspace dependencies, baked hero assets, and GPU-enabled Chromium through Vitexec.",
  "writes": "Pixel comparison results to stdout",
  "args": ["--gpu", "--timeout", "120", "--path", "/?scene=origin"]
} */
import { _roots } from '@react-three/fiber/webgpu';
import { Text } from '@pmndrs/glyph/three';
import { RenderTarget, VideoTexture, WebGPUBackend, WebGPURenderer } from 'three/webgpu';

while (_roots.values().next().value?.store.getState().scene == null)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const state = _roots.values().next().value!.store.getState();
const handles = globalThis as { heroVideo?: VideoTexture };

function visibleWord() {
  let word: { visible: boolean; text: string } | undefined;

  state.scene.traverse((object) => {
    if (
      object instanceof Text &&
      object.castShadow &&
      object.text.length > 0 &&
      object.commitState().status === 'committed'
    )
      word = object;
  });

  return word;
}

let word = visibleWord();

while (word === undefined || handles.heroVideo === undefined || state.scene.environment === null) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  word = visibleWord();
}

const video = handles.heroVideo.image as HTMLVideoElement;

const mediaTime = await new Promise<number>((resolve) => {
  video.requestVideoFrameCallback((_, frame) => resolve(frame.mediaTime));
});

const nextMediaTime = await new Promise<number>((resolve) => {
  video.requestVideoFrameCallback((_, frame) => resolve(frame.mediaTime));
});

if (nextMediaTime === mediaTime) throw new Error('Origin video did not advance');

state.setFrameloop('never');
video.pause();
const { renderer, scene, camera } = state;

if (!(renderer instanceof WebGPURenderer) || !(renderer.backend instanceof WebGPUBackend))
  throw new Error('Origin check requires WebGPU');

const story = scene.getObjectByName('origin-story');

if (story === undefined) throw new Error('Origin story did not mount');

const target = new RenderTarget(960, 540, { samples: 4 });
const previous = renderer.getRenderTarget();

const capture = async () => {
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);

  return renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
};

try {
  await renderer.compileAsync(scene, camera);
  const shown = await capture();
  const changes: number[] = [];

  for (const object of [word, story]) {
    object.visible = false;
    const hidden = await capture();
    object.visible = true;
    let changed = 0;

    for (let offset = 0; offset < shown.length; offset += 4) {
      if ([0, 1, 2].some((channel) => Math.abs(shown[offset + channel]! - hidden[offset + channel]!) > 4)) changed++;
    }

    changes.push(changed);

    if (changed < 40) throw new Error(`Origin text was not visible: ${JSON.stringify(changes)}`);
  }

  console.log('hero-origin-ready', JSON.stringify({ backend: 'webgpu', word: word.text, changes }));
} finally {
  word.visible = true;
  story.visible = true;
  renderer.setRenderTarget(previous);
  target.dispose();
  await video.play();
}
