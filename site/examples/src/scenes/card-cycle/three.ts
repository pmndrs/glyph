import { glyph } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AmbientLight, DirectionalLight, Group, Mesh, PointLight, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
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
import { createPaperMaterial, foilInk } from './materials';

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
  await inter.load();

  const geometry = new RoundedBoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_DEPTH, CARD_SEGMENTS, CARD_RADIUS);
  const paper = createPaperMaterial();
  // The teardown path only owns `dispose`; retaining a broader raster generic here would lose the
  // concrete MSDF association that `createText` correctly preserves.
  const texts: { dispose(): void }[] = [];
  const rig = new Group();
  const cards = CARD_SLOTS.map((slot) => {
    const face = CARD_FACES[slot];
    if (face === undefined) throw new Error(`Missing card face ${slot}`);
    const card = new Group();
    card.add(new Mesh(geometry, paper));
    createFace(face, false, card);
    createFace(face, true, card);
    card.position.z = slot === 0 ? TOP_Z : BOTTOM_Z;
    rig.add(card);
    return card;
  });
  const lights = [
    new AmbientLight('#f5f0e8', 0.72),
    new DirectionalLight('#fff8ec', 3.2),
    new DirectionalLight('#9eb8e9', 1.2),
    new PointLight('#d9a7b5', 7, 7, 2),
  ];
  lights[1]?.position.set(3.5, 4.5, 5);
  lights[2]?.position.set(-4, 1, 3);
  lights[3]?.position.set(0, -2.6, 2.6);
  scene.add(rig, ...lights);
  glyph.shape();

  const cycle = createCycleState();
  const transforms: CardTransform[] = CARD_SLOTS.map(() => ({ x: 0, y: 0, z: 0, rotationY: 0 }));
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
      card.rotation.set(0, transform.rotationY, 0);
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    scene.remove(rig, ...lights);
    for (const text of texts) text.dispose();
    geometry.dispose();
    paper.dispose();
    inter.dispose();
    three.dispose();
  };

  function createFace(face: CardFace, back: boolean, owner: Group): void {
    const facing = new Group();
    facing.rotation.y = back ? Math.PI : 0;
    const printed = new Group();
    printed.position.z = CARD_TEXT_Z;
    facing.add(printed);
    owner.add(facing);
    if (back) {
      addText(printed, 'GLYPH', face.ink, 0.16, -1.35, 1.5, 2.7, 0.18);
      addText(printed, '* * *', face.ink, 0.88, -1.4, 0.28, 2.8, 0.03);
      addText(printed, 'CARD CYCLE', '#6a5c4b', 0.15, -1.35, -1.35, 2.7, 0.11);
      return;
    }

    addCorner(printed, face, false);
    addCorner(printed, face, true);
    addText(printed, face.suit, face.ink, 0.18, -1.2, 1.22, 2.4, 0.12);
    face.pips.forEach((pip, index) => {
      const pipGroup = new Group();
      pipGroup.position.set(pip.x, pip.y, 0);
      pipGroup.rotation.z = pip.inverted ? Math.PI : 0;
      printed.add(pipGroup);
      addText(pipGroup, '*', face.ink, index === 2 ? 1.04 : 0.76, -0.55, 0.28, 1.1, 0);
    });
  }

  function addCorner(owner: Group, face: CardFace, inverted: boolean): void {
    const corner = new Group();
    corner.position.set(inverted ? CORNER_X : -CORNER_X, inverted ? -CORNER_Y : CORNER_Y, 0);
    corner.rotation.z = inverted ? Math.PI : 0;
    owner.add(corner);
    addText(corner, face.rank, face.ink, 0.48, 0, 0.18, undefined, 0);
    addText(corner, face.suit, face.ink, 0.14, 0, -0.25, 0.76, 0.07);
  }

  function addText(
    owner: Group,
    text: string,
    color: string,
    fontSize: number,
    x: number,
    y: number,
    width: number | undefined,
    letterSpacing: number,
  ): void {
    const paragraph = three.createText({
      font: inter.msdf,
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
