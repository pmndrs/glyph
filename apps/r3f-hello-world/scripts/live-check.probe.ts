export {};

const canvas = await waitForCanvas();
for (const [technique, clientX] of [
  ['msdf', 224],
  ['bitmap', 96],
  ['slug', 352],
] as const) {
  if (canvas.dataset.exampleTechnique !== technique) clickCanvas(canvas, clientX, 200);
  await waitForTechnique(canvas, technique);
  if (canvas.dataset.exampleDraws !== '2' || canvas.dataset.exampleRecords !== '11') {
    throw new Error(
      `${technique} rendered ${String(canvas.dataset.exampleRecords)} records in ` +
        `${String(canvas.dataset.exampleDraws)} draws; expected 11 records in two Rust-planned draws`,
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

async function waitForTechnique(targetCanvas: HTMLCanvasElement, technique: string): Promise<void> {
  for (let frame = 0; frame < 600; frame += 1) {
    if (targetCanvas.dataset.exampleTechnique === technique && targetCanvas.dataset.exampleReady === 'true') return;
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
