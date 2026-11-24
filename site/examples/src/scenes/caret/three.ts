import { glyph, type TextPosition, type LayoutBox, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { Raycaster, Vector2, Vector3, type Camera, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { FONT_SIZE, PASSAGE, TOP, WIDTH } from './config';

/**
 * The imperative twin: a pointer event to a paragraph-local point, then the
 * two queries. The event's ray meets the text's plane; the world point goes
 * through `worldToLocal`; paragraph space is y-down, so y flips.
 */
export async function mount(scene: Scene, camera: Camera, canvas: HTMLCanvasElement): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:caret', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const text = three.createText({
    font: inter,
    text: PASSAGE,
    style: { fontSize: FONT_SIZE, color: '#e7ecf6', lineHeight: 1.4 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: WIDTH } },
  });
  text.position.set(-WIDTH / 2, TOP, 0);
  scene.add(text);
  glyph.shape();

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const hit = new Vector3();
  const positionFrom = (event: PointerEvent): TextPosition => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    hit.copy(origin).addScaledVector(direction, -origin.z / direction.z); // where the ray crosses z = 0
    const local = text.worldToLocal(hit);
    return text.hitTest({ x: local.x, y: -local.y }); // prepares the text first; never undefined
  };

  let anchor: number | undefined;
  let rects: readonly LayoutBox[] = [];
  const down = (event: PointerEvent) => {
    anchor = positionFrom(event).offset;
    rects = [];
  };
  const move = (event: PointerEvent) => {
    if (anchor === undefined || (event.buttons & 1) === 0) return;
    const head = positionFrom(event).offset; // text.caret(position).rect is where to draw the caret
    rects = text.rangeRects(Math.min(anchor, head), Math.max(anchor, head)); // a reversed range throws
  };
  const up = () => {
    anchor = undefined;
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  void rects; // draw each as a quad at (x + w/2, -(y + h/2)) in the text's local space

  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
