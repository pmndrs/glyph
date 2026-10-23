export {};

const { playground } = await import('/src/inspect.ts');
const { Text, TextGroup } = await import('@pmndrs/glyph/three');

// The greeting draws ten Latin glyphs plus one icon from a second font, and the label group adds fourteen Slug
// glyphs. TextGroup's default `auto` batching owns a separate draw boundary, including for a Slug greeting.
for (const format of ['msdf', 'bitmap', 'slug'] as const) {
  const button = await waitFor(
    () => document.querySelector<HTMLButtonElement>(`button[data-format="${format}"]`) ?? undefined,
    'the format switcher never rendered',
  );
  button.click();
  const counts = await waitForFormat(format);
  console.log(`${format}: ${String(counts.records)} records in ${String(counts.draws)} draws`);
}

// The backdrop is plain Three geometry without glyph run metadata, so it never counts toward the draws above.
await waitFor(() => playground.scene?.getObjectByName('backdrop'), 'the backdrop group never mounted');

console.log('tres-playground-live-ok');

async function waitForFormat(format: string): Promise<{ readonly draws: number; readonly records: number }> {
  let last = '';
  for (let frame = 0; frame < 900; frame += 1) {
    const scene = playground.scene;
    const hello = playground.hello();
    const labels = scene?.getObjectByName('format-labels');
    const drawRoot = scene?.children.find((child) => child.name.startsWith('@pmndrs/glyph:'));
    const counts = drawCounts(drawRoot);
    const commit = hello?.commitState();
    const labelCommits =
      labels instanceof TextGroup &&
      labels.children.every((child) => child instanceof Text && child.commitState().status === 'committed');
    last =
      `format=${playground.format()} scene=${String(scene !== undefined)} hello=${hello?.name ?? 'none'} ` +
      `commit=${JSON.stringify(commit)} drawRoot=${String(drawRoot !== undefined)} ` +
      `labels=${String(labels instanceof TextGroup)} labelCount=${String(labels instanceof TextGroup ? labels.textCount : 0)} ` +
      `labelCommits=${String(labelCommits)} draws=${String(counts.draws)} records=${String(counts.records)} ` +
      `partitions=${counts.partitions.join(',')}`;
    if (hello?.error !== undefined) throw hello.error;
    if (labels instanceof TextGroup && labels.error !== undefined) throw labels.error;
    if (
      playground.format() === format &&
      hello?.name === `font-${format}` &&
      commit?.status === 'committed' &&
      labels instanceof TextGroup &&
      labels.textCount === 3 &&
      labelCommits &&
      counts.draws === 3 &&
      counts.records === 25 &&
      counts.partitions.join(',') === '1,10,14'
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
  readonly partitions: readonly number[];
} {
  let draws = 0;
  let records = 0;
  const partitions: number[] = [];
  root?.traverse((object) => {
    if (object.userData.pmndrsGlyphRunStart === undefined || !('geometry' in object)) return;
    const geometry = object.geometry;
    if (typeof geometry !== 'object' || geometry === null || !('instanceCount' in geometry)) return;
    const instanceCount = geometry.instanceCount;
    if (typeof instanceCount !== 'number') return;
    draws += 1;
    records += instanceCount;
    partitions.push(instanceCount);
  });
  return { draws, records, partitions: partitions.toSorted((left, right) => left - right) };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
