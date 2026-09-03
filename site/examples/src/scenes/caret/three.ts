import { glyph, type GlyphCaret, type LayoutBox } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/raster/msdf';
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
  const caretFrom = (event: PointerEvent): GlyphCaret | undefined => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    hit.copy(origin).addScaledVector(direction, -origin.z / direction.z); // where the ray crosses z = 0
    const local = text.worldToLocal(hit);
    return text.caretAt(local.x, -local.y); // undefined until the renderer has accepted the text
  };

  let anchor: number | undefined;
  let rects: readonly LayoutBox[] = [];
  const down = (event: PointerEvent) => {
    const caret = caretFrom(event);
    if (caret === undefined) return;
    anchor = caret.offset;
    rects = [];
  };
  const move = (event: PointerEvent) => {
    if (anchor === undefined || (event.buttons & 1) === 0) return;
    const caret = caretFrom(event);
    if (caret === undefined) return;
    rects = text.selectionRects(anchor, caret.offset) ?? []; // one line-clipped box per line
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
