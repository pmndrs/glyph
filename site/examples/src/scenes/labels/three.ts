import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { Fog, Group, Mesh, MeshStandardNodeMaterial, SphereGeometry, type Camera, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: a label is a `Text` under the body it names, inside a
 * group whose quaternion copies the camera's each frame. The scene's fog
 * reaches it because the text material is a node material like any other.
 */
const inScene = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  material.depthTest = true;
  return material;
});

const BODIES = [
  { name: 'Io', period: '1.77 d', color: '#f4d68a', radius: 0.3, orbit: 1.6, speed: 0.9, phase: 0 },
  { name: 'Europa', period: '3.55 d', color: '#9fc4ff', radius: 0.26, orbit: 2.5, speed: 0.55, phase: 2.1 },
  { name: 'Ganymede', period: '7.15 d', color: '#c9b8a8', radius: 0.42, orbit: 3.6, speed: 0.34, phase: 4.2 },
] as const;

const TILT = 0.5;

export async function mount(scene: Scene, camera: Camera): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:labels', ThreeConfig);
  const inter = glyph.fontFace({ baked: INTER });
  await inter.load();

  scene.fog = new Fog('#07080b', 10, 20);

  const billboards: Group[] = [];
  const label = (text: string, fontSize: number, offset: number): Group => {
    const board = new Group();
    board.position.y = offset;
    const name = three.createText({
      font: inter,
      material: inScene,
      text,
      style: { fontSize, color: '#e7ecf6', lineHeight: 1.15 },
      layout: { align: 'center', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 3 } },
    });
    name.position.set(-1.5, fontSize * 2.2, 0);
    board.add(name);
    billboards.push(board);
    return board;
  };

  const jupiter = new Mesh(
    new SphereGeometry(0.8, 48, 32),
    new MeshStandardNodeMaterial({ color: '#7a5a1e', emissive: '#ffd166', emissiveIntensity: 0.6, roughness: 0.6 }),
  );
  jupiter.add(label('Jupiter', 0.3, 1.05));

  const system = new Group();
  const bodies = BODIES.map((body) => {
    const node = new Group();
    node.add(
      new Mesh(
        new SphereGeometry(body.radius, 32, 24),
        new MeshStandardNodeMaterial({ color: body.color, roughness: 0.7 }),
      ),
      label(`${body.name}\n${body.period}`, 0.24, body.radius + 0.12),
    );
    system.add(node);
    return node;
  });
  scene.add(jupiter, system);
  glyph.shape();

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    for (const [index, body] of BODIES.entries()) {
      const angle = body.phase + elapsed * body.speed;
      bodies[index]?.position.set(
        Math.cos(angle) * body.orbit,
        Math.sin(angle) * body.orbit * Math.sin(TILT),
        Math.sin(angle) * body.orbit * Math.cos(TILT),
      );
    }
    for (const board of billboards) board.quaternion.copy(camera.quaternion);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    scene.traverse((object) => {
      if ('dispose' in object && typeof object.dispose === 'function') object.dispose();
    });
    inter.dispose();
    three.dispose();
  };
}
