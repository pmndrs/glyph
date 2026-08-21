export {};

const { _roots } = await import('@react-three/fiber/webgpu');

for (const [technique, centerOffset] of [
  ['msdf', 0],
  ['bitmap', -128],
  ['slug', 128],
] as const) {
  // Re-query rather than caching one element. A cached reference survives the canvas being
  // replaced, and every `_roots` lookup against the stale node then misses, which reports as
  // the technique never settling rather than as the lookup failing.
  const canvas = await waitForCanvas();
  clickCanvas(canvas, canvas.getBoundingClientRect().width / 2 + centerOffset, 48);
  const counts = await waitForTechnique(canvas, technique);
  if (counts.draws !== 2 || counts.records !== 11) {
    throw new Error(
      `${technique} rendered ${String(counts.records)} records in ` +
        `${String(counts.draws)} draws; expected 11 records in two Rust-planned draws`,
    );
  }
}

console.log('r3f-hello-world-live-ok');

async function waitForCanvas(): Promise<HTMLCanvasElement> {
  for (let frame = 0; frame < 600; frame += 1) {
    const value = document.querySelector('canvas');
    if (value instanceof HTMLCanvasElement) return value;
    await nextFrame();
  }
  throw new Error('R3F hello-world did not create a canvas');
}

async function waitForTechnique(
  targetCanvas: HTMLCanvasElement,
  technique: string,
): Promise<{ readonly draws: number; readonly records: number }> {
  for (let frame = 0; frame < 600; frame += 1) {
    const root = _roots.get(targetCanvas);
    const scene = root?.store.getState().scene;
    const worldLayer = scene?.getObjectByName('world-text');
    let draws = 0;
    let records = 0;
    worldLayer?.traverse((object) => {
      if (object.userData.pmndrsGlyphRunStart === undefined || !('geometry' in object)) return;
      const geometry = object.geometry;
      if (typeof geometry !== 'object' || geometry === null || !('instanceCount' in geometry)) return;
      const instanceCount = geometry.instanceCount;
      if (typeof instanceCount !== 'number') return;
      draws += 1;
      records += instanceCount;
    });
    const selected = worldLayer?.getObjectByName(`font-${technique}`);
    if (selected?.visible === true && draws === 6 && records === 33) return { draws: draws / 3, records: records / 3 };
    await nextFrame();
  }
  // Report what the scene actually looked like. A bare "did not settle" says only that a
  // deadline passed, which is the same message whether the click missed, the technique never
  // became visible, or the draw counts differ -- and those need different fixes.
  const root = _roots.get(targetCanvas);
  const scene = root?.store.getState().scene;
  const worldLayer = scene?.getObjectByName('world-text');
  const selected = worldLayer?.getObjectByName(`font-${technique}`);
  let draws = 0;
  let records = 0;
  worldLayer?.traverse((object) => {
    if (object.userData.pmndrsGlyphRunStart === undefined || !('geometry' in object)) return;
    const geometry = object.geometry;
    if (typeof geometry !== 'object' || geometry === null || !('instanceCount' in geometry)) return;
    const instanceCount = geometry.instanceCount;
    if (typeof instanceCount !== 'number') return;
    draws += 1;
    records += instanceCount;
  });
  const names: string[] = [];
  worldLayer?.children.forEach((child) => names.push(`${child.name}:${String(child.visible)}`));
  throw new Error(
    `R3F hello-world did not settle the ${technique} technique ` +
      `(root=${String(root !== undefined)} world=${String(worldLayer !== undefined)} ` +
      `connected=${String(targetCanvas.isConnected)} canvases=${String(document.querySelectorAll('canvas').length)} ` +
      `sameNode=${String(document.querySelector('canvas') === targetCanvas)} roots=${String(_roots.size)} ` +
      `selected=${String(selected !== undefined)} visible=${String(selected?.visible)} ` +
      `draws=${String(draws)} records=${String(records)} children=[${names.join(',')}])`,
  );
}

function clickCanvas(targetCanvas: HTMLCanvasElement, clientX: number, clientY: number): void {
  for (const event of [
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
    }),
    new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
    }),
    // R3F v10 keys pointer state by `pointerId`, so the click must carry the same id as the
    // preceding down/up. A MouseEvent has none and resolves to a different pointer with no
    // recorded initial click, which suppresses the synthetic click entirely.
    new PointerEvent('click', {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
    }),
  ]) {
    // A synthetic event carries `clientX`/`clientY` from its init dictionary but leaves
    // `offsetX`/`offsetY` at zero, and R3F measures the pointer against the canvas with the
    // offset pair. Defining them is what R3F's own event tests do, and without it the hit
    // test lands at the canvas origin -- which happens to sit on the default technique, so
    // the probe passes where a real click would have selected a different one.
    const bounds = targetCanvas.getBoundingClientRect();
    Object.defineProperty(event, 'offsetX', { value: clientX - bounds.left });
    Object.defineProperty(event, 'offsetY', { value: clientY - bounds.top });
    targetCanvas.dispatchEvent(event);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
