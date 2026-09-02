export {};

const { inspectThreeExample } = await import('/src/three-example.ts');

for (let frame = 0; frame < 600; frame += 1) {
  const state = inspectThreeExample();
  if (state === undefined) {
    await nextFrame();
    continue;
  }

  let draws = 0;
  let records = 0;
  state.text.traverse((object) => {
    if (object.userData.pmndrsGlyphRunStart === undefined || !('geometry' in object)) return;
    const geometry = object.geometry;
    if (typeof geometry !== 'object' || geometry === null || !('instanceCount' in geometry)) return;
    const instanceCount = geometry.instanceCount;
    if (typeof instanceCount !== 'number') return;
    draws += 1;
    records += instanceCount;
  });
  if (!state.renderer.domElement.isConnected) throw new Error('imperative Three canvas is detached');
  if (state.scene.getObjectByName('three-hello-world') !== state.text) {
    throw new Error('imperative Three Text is not attached to its scene');
  }
  if (state.text.error !== undefined) throw state.text.error;
  if (draws !== 1 || records !== 10) {
    throw new Error(
      `imperative Three rendered ${String(records)} records in ${String(draws)} draws; expected 10 visible glyphs in one draw`,
    );
  }
  console.log('three-hello-world-live-ok');
  break;
}

if (inspectThreeExample() === undefined) {
  throw new Error('imperative Three example did not finish rendering');
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
