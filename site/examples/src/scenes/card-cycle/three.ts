import { glyph, type FontFaceSelection } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AmbientLight, DirectionalLight, Group, Mesh, PointLight, type Scene } from 'three/webgpu';

import { ICONS_MSDF, ICONS_MSDF_OPTIONS, INTER } from '../../fonts';
import {
  AUTO_CYCLE_SECONDS,
  BOTTOM_Z,
  CARD_DEPTH,
  CARD_FACES,
  CARD_HEIGHT,
  CARD_RADIUS,
  CARD_SEGMENTS,
  CARD_TEXT_Z,
  CARD_WIDTH,
  CORNER_X,
  CORNER_Y,
  TOP_Z,
  type CardFace,
  type CardTransform,
  createCycleState,
  queueFlip,
  stepCycle,
  writeCardTransform,
} from './config';
import { createCardSurfaceMaterial, foilInk } from './materials';

const CARD_SLOTS = [0, 1] as const;

/**
 * Imperative twin: the same two retained cards and Glyph paragraphs. It
 * cycles on its own because this standalone mount surface has no proxy input
 * mailbox; the R3F scene consumes that mailbox for click and pointer control.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:card-cycle', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  const icons = glyph.fontFace(ICONS_MSDF, { format: msdf(ICONS_MSDF_OPTIONS) });
  await Promise.all([inter.load(), icons.load()]);

  const geometry = new RoundedBoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_DEPTH, CARD_SEGMENTS, CARD_RADIUS);
  const surface = createCardSurfaceMaterial();
  // The teardown path only owns `dispose`; retaining a broader raster generic here would lose the
  // concrete MSDF association that `createText` correctly preserves.
  const texts: { dispose(): void }[] = [];
  const rig = new Group();
  const fronts: Group[] = [];
  const backs: Group[] = [];
  const cards = CARD_SLOTS.map((slot) => {
    const face = CARD_FACES[slot];
    if (face === undefined) throw new Error(`Missing card face ${slot}`);
    const card = new Group();
    card.add(new Mesh(geometry, surface));
    fronts[slot] = createFace(face, false, card);
    backs[slot] = createFace(face, true, card);
    fronts[slot].visible = slot === 0;
    backs[slot].visible = false;
    card.position.z = slot === 0 ? TOP_Z : BOTTOM_Z;
    rig.add(card);
    return card;
  });
  const lights = [
    new AmbientLight('#8c7c62', 0.3),
    new DirectionalLight('#fff0bd', 4.8),
    new DirectionalLight('#6f8fc9', 2.1),
    new PointLight('#ffc857', 18, 8, 2),
    new PointLight('#fff4d2', 12, 7, 2),
  ];
  lights[1]?.position.set(4.5, 5.5, 6);
  lights[2]?.position.set(-4, 1.5, 4);
  lights[3]?.position.set(-1.8, -2.2, 3.2);
  lights[4]?.position.set(2.4, 1.8, 2.5);
  scene.add(rig, ...lights);
  glyph.shape();

  const cycle = createCycleState();
  const transforms: CardTransform[] = CARD_SLOTS.map(() => ({
    x: 0,
    y: 0,
    z: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
  }));
  let frame = 0;
  let last = performance.now();
  let nextCycle = AUTO_CYCLE_SECONDS;
  let elapsed = 0;
  const tick = (now: number): void => {
    const delta = (now - last) / 1_000;
    last = now;
    elapsed += delta;
    if (elapsed >= nextCycle) {
      queueFlip(cycle);
      nextCycle = elapsed + AUTO_CYCLE_SECONDS;
    }
    stepCycle(cycle, delta);
    const progress = cycle.flipping ? cycle.progress : undefined;
    for (const slot of CARD_SLOTS) {
      const transform = transforms[slot];
      const card = cards[slot];
      if (transform === undefined || card === undefined) continue;
      writeCardTransform(transform, slot, cycle.top, progress);
      card.position.set(transform.x, transform.y, transform.z);
      card.rotation.set(transform.rotationX, transform.rotationY, transform.rotationZ);
      const front = fronts[slot];
      const back = backs[slot];
      const movingTop = cycle.flipping && slot === cycle.top;
      const frontFacing = Math.cos(transform.rotationY) >= 0;
      if (front !== undefined) front.visible = slot === cycle.top ? !movingTop || frontFacing : cycle.flipping;
      if (back !== undefined) back.visible = movingTop && !frontFacing;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    scene.remove(rig, ...lights);
    for (const text of texts) text.dispose();
    geometry.dispose();
    surface.dispose();
    icons.dispose();
    inter.dispose();
    three.dispose();
  };

  function createFace(face: CardFace, back: boolean, owner: Group): Group {
    const facing = new Group();
    facing.rotation.y = back ? Math.PI : 0;
    const printed = new Group();
    printed.position.z = CARD_TEXT_Z;
    facing.add(printed);
    owner.add(facing);
    if (back) {
      addText(printed, 'GLYPH', face.ink, 0.16, -1.35, 1.5, 2.7, 0.18, inter.msdf);
      addText(printed, face.icon, face.ink, 1.08, -1.4, 0.28, 2.8, 0, icons.msdf);
      addText(printed, 'BLACK EDITION', '#d0a94f', 0.15, -1.35, -1.35, 2.7, 0.11, inter.msdf);
      return facing;
    }

    addCorner(printed, face, false);
    addCorner(printed, face, true);
    addText(printed, face.label, face.ink, 0.18, -1.2, 1.22, 2.4, 0.12, inter.msdf);
    face.pips.forEach((pip, index) => {
      const pipGroup = new Group();
      pipGroup.position.set(pip.x, pip.y, 0);
      pipGroup.rotation.z = pip.inverted ? Math.PI : 0;
      printed.add(pipGroup);
      addText(pipGroup, face.icon, face.ink, index === 2 ? 1.04 : 0.76, -0.55, 0.28, 1.1, 0, icons.msdf);
    });
    return facing;
  }

  function addCorner(owner: Group, face: CardFace, inverted: boolean): void {
    const corner = new Group();
    corner.position.set(inverted ? CORNER_X : -CORNER_X, inverted ? -CORNER_Y : CORNER_Y, 0);
    corner.rotation.z = inverted ? Math.PI : 0;
    owner.add(corner);
    addText(corner, face.rank, face.ink, 0.48, 0, 0.18, undefined, 0, inter.msdf);
    addText(corner, face.icon, face.ink, 0.22, 0, -0.25, 0.76, 0, icons.msdf);
  }

  function addText<const Selection extends FontFaceSelection>(
    owner: Group,
    text: string,
    color: string,
    fontSize: number,
    x: number,
    y: number,
    width: number | undefined,
    letterSpacing: number,
    font: Selection,
  ): void {
    const paragraph = three.createText({
      font,
      material: foilInk,
      text,
      style: { color, fontSize, letterSpacing },
      layout: { align: width === undefined ? 'start' : 'center', wrap: 'none' },
      ...(width === undefined ? {} : { constraints: { width: { mode: 'exact' as const, size: width } } }),
    });
    paragraph.position.set(x, y, 0);
    owner.add(paragraph);
    texts.push(paragraph);
  }
}
