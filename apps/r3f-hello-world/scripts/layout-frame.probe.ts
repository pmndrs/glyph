export {};

// A real canvas, not the test renderer: the scheduler job registered before `render` must run layout
// callbacks before the renderer traverses the scene, a callback that positions its own Text must be
// drawn at that position by the first frame, and an imperative setter must draw on `frameloop="demand"`.
const { Canvas } = await import('@react-three/fiber/webgpu');
const { createElement, Suspense } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Text, useMsdf } = await import('@pmndrs/glyph/react');
const { default: latinFont } = await import('/assets/inter-latin.font.glb?url');

const TRANSFORM_TABLE = ['', 'pmndrsGlyphTransforms'].join('_');
const events: string[] = [];
const probe: { label: any } = { label: undefined };
let scene: any;

function captureLabel(value: unknown): void {
  if (value !== null) probe.label = value;
}

function centreOnLayout(text: any, layout: { width: number }): void {
  events.push('layout');
  text.position.x = -layout.width / 2;
}

function Label(): unknown {
  const font = useMsdf(latinFont);
  return createElement(
    Text,
    {
      font,
      ref: captureLabel,
      onLayout: centreOnLayout,
    },
    'centred on its own width',
  );
}

const container = document.createElement('div');
container.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:200px';
document.body.append(container);
const reactRoot = createRoot(container);
reactRoot.render(
  createElement(
    Canvas,
    {
      frameloop: 'demand',
      orthographic: true,
      camera: { far: 1_000, near: -1_000, position: [0, 0, 10] },
      onCreated: (state: any) => {
        scene = state.scene;
        const update = scene.updateMatrixWorld.bind(scene);
        scene.updateMatrixWorld = (force?: boolean) => {
          events.push('traverse');
          update(force);
        };
      },
    },
    createElement(Suspense, { fallback: null }, createElement(Label)),
  ),
);

await until('the first frame', () => probe.label?.commitState().status === 'committed');
const label = probe.label;
const width = label.measure().width;
if (!(width > 0)) throw new Error('the probe label has no width');
const firstLayout = events.indexOf('layout');
const traversalsBefore = events.slice(0, firstLayout).filter((event) => event === 'traverse').length;
const firstDrawn = events.indexOf('traverse', firstLayout);
if (firstLayout === -1 || firstDrawn === -1) throw new Error(`no layout before a traversal: ${events.join(',')}`);
// Traversals before the font resolved carry no text; the one that draws it must follow its callback.
if (events.slice(firstLayout + 1, firstDrawn).length !== 0) {
  throw new Error(`the layout callback did not run immediately before the traversal: ${events.join(',')}`);
}
if (label.matrixWorld.elements[12] !== -width / 2) {
  throw new Error(`frame 1 drew the label at ${String(label.matrixWorld.elements[12])}, not ${String(-width / 2)}`);
}
if (!publishedTransforms().includes(-width / 2)) throw new Error('frame 1 did not publish the callback position');
if (scene.children[0]?.name !== '@pmndrs/glyph-prepare') throw new Error('the root was not attached to the Scene');

// On demand, a settled canvas renders nothing; an imperative setter must ask for the frame that draws it.
await frames(10);
const settled = events.length;
await frames(10);
if (events.length !== settled) throw new Error('the on-demand canvas kept rendering while nothing changed');
label.text = 'set through the ref, and wider';
await until('the frame after an imperative setter', () => label.commitState().status === 'committed');
const sequence = events.slice(settled);
if (sequence[0] !== 'layout' || sequence[1] !== 'traverse') {
  throw new Error(`the setter's frame ran ${sequence.join(',')}; expected layout then traverse`);
}
const widened = label.measure().width;
if (!(widened > width) || !publishedTransforms().includes(-widened / 2)) {
  throw new Error('the frame after the setter did not draw the new layout at its callback position');
}

reactRoot.unmount();
container.remove();
console.log(
  `r3f-layout-frame-live-ok traversals-before-text=${String(traversalsBefore)} first=${events.slice(firstLayout, firstLayout + 2).join('>')} setter=${sequence.join('>')}`,
);

function publishedTransforms(): number[] {
  const values: number[] = [];
  scene.traverse((object: any) => {
    const transforms = object.geometry?.attributes?.[TRANSFORM_TABLE];
    if (transforms !== undefined) values.push(...transforms.array);
  });
  return values;
}

async function until(what: string, done: () => boolean): Promise<void> {
  for (let frame = 0; frame < 600; frame += 1) {
    if (done()) return;
    await frames(1);
  }
  throw new Error(`${what} did not arrive; events: ${events.join(',')}`);
}

async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}
