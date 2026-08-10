export {};

const { _roots } = await import('@react-three/fiber/webgpu');

const canvas = await waitForCanvas();
for (const [technique, centerOffset] of [
  ['msdf', 0],
  ['bitmap', -128],
  ['slug', 128],
] as const) {
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
      if (object.userData.pmndrsTextRunStart === undefined || !('geometry' in object)) return;
      const geometry = object.geometry;
      if (typeof geometry !== 'object' || geometry === null || !('instanceCount' in geometry)) return;
      const instanceCount = geometry.instanceCount;
      if (typeof instanceCount !== 'number') return;
      draws += 1;
      records += instanceCount;
    });
    const selected = worldLayer?.getObjectByName(`world-${technique}`);
    if (selected?.visible === true && draws === 6 && records === 33) return { draws: draws / 3, records: records / 3 };
    await nextFrame();
  }
  throw new Error(`R3F hello-world did not settle the ${technique} technique`);
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
    new MouseEvent('click', { bubbles: true, button: 0, clientX, clientY }),
  ]) {
    targetCanvas.dispatchEvent(event);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
