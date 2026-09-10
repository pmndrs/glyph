export {};

const { playground } = await import('/src/inspect.ts');

// The greeting draws ten Latin glyphs plus one icon from a second font, and the label group adds fourteen Slug
// glyphs. Bitmap and MSDF greetings sit in their own technique, so the scene needs three draws; a Slug greeting
// shares the labels' technique and Latin font and batches with them, leaving the icon font as the second draw.
for (const [format, draws] of [
  ['msdf', 3],
  ['bitmap', 3],
  ['slug', 2],
] as const) {
  const button = await waitFor(
    () => document.querySelector<HTMLButtonElement>(`button[data-format="${format}"]`) ?? undefined,
    'the format switcher never rendered',
  );
  button.click();
  const counts = await waitForFormat(format, { draws, records: 25 });
  console.log(`${format}: ${String(counts.records)} records in ${String(counts.draws)} draws`);
}

console.log('tres-playground-live-ok');

async function waitForFormat(
  format: string,
  expected: { readonly draws: number; readonly records: number },
): Promise<{ readonly draws: number; readonly records: number }> {
  let last = '';
  for (let frame = 0; frame < 900; frame += 1) {
    const scene = playground.scene;
    const hello = playground.hello();
    const drawRoot = scene?.children.find((child) => child.name.startsWith('@pmndrs/glyph:'));
    const counts = drawCounts(drawRoot);
    const commit = hello?.commitState();
    last =
      `format=${playground.format()} scene=${String(scene !== undefined)} hello=${hello?.name ?? 'none'} ` +
      `commit=${JSON.stringify(commit)} drawRoot=${String(drawRoot !== undefined)} ` +
      `draws=${String(counts.draws)} records=${String(counts.records)}`;
    if (hello?.error !== undefined) throw hello.error;
    if (
      playground.format() === format &&
      hello?.name === `font-${format}` &&
      commit?.status === 'committed' &&
      counts.draws === expected.draws &&
      counts.records === expected.records
    ) {
      return counts;
    }
    await nextFrame();
  }
  throw new Error(`Tres playground did not settle the ${format} raster format (${last})`);
}

async function waitFor<Value>(read: () => Value | undefined, message: string): Promise<Value> {
  for (let frame = 0; frame < 600; frame += 1) {
    const value = read();
    if (value !== undefined) return value;
    await nextFrame();
  }
  throw new Error(message);
}

function drawCounts(root: import('three/webgpu').Object3D | undefined): {
  readonly draws: number;
  readonly records: number;
} {
  let draws = 0;
  let records = 0;
  root?.traverse((object) => {
    if (object.userData.pmndrsGlyphRunStart === undefined || !('geometry' in object)) return;
    const geometry = object.geometry;
    if (typeof geometry !== 'object' || geometry === null || !('instanceCount' in geometry)) return;
    const instanceCount = geometry.instanceCount;
    if (typeof instanceCount !== 'number') return;
    draws += 1;
    records += instanceCount;
  });
  return { draws, records };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
