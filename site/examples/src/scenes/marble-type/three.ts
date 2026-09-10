import { glyph, type GlyphLayoutInspection } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  BufferGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicNodeMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  PointLight,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu';

import { INTER } from '../../fonts';
import { PAPER_DIM } from '../../theme';
import { AUTO_PHRASE, CRACKS, SLAB, STAMP, TEXT } from './config';
import { editLine, isPrintableKey, stampProgress, writeCrack, type EditableLine } from './helpers';
import { engravedInk, marbleMaterial } from './materials';

const FLOATS_PER_IMPACT = CRACKS.branches * CRACKS.segmentsPerBranch * 2 * 3;

function caretX(layout: GlyphLayoutInspection | undefined, offset: number): number {
  if (layout === undefined || layout.glyphCount === 0 || offset <= 0) return 0;
  for (let index = 0; index < layout.glyphCount; index += 1) {
    if ((layout.clusters[index] ?? 0) >= offset) return layout.x[index] ?? 0;
  }
  const last = layout.glyphCount - 1;
  return (layout.x[last] ?? 0) + (layout.glyphAdvances[last] ?? 0);
}

/** The imperative twin of `scene.tsx`, including direct-canvas keyboard input. */
export async function mount(scene: Scene, renderer: WebGPURenderer): Promise<() => void> {
  await glyph.init();
  const handle = glyph.handle('examples:marble-type', ThreeConfig);
  const root = handle('main');
  const Inter = glyph.fontFace(INTER, { format: msdf });
  await Inter.load();

  const rig = new Group();
  rig.rotation.set(-0.08, 0.045, 0);
  const stoneGeometry = new RoundedBoxGeometry(SLAB.width, SLAB.height, SLAB.depth, 5, SLAB.radius);
  const stone = new Mesh(stoneGeometry, marbleMaterial());
  stone.castShadow = true;
  stone.receiveShadow = true;
  const groundGeometry = new PlaneGeometry(11.5, 7.2);
  const groundMaterial = new MeshStandardNodeMaterial({ color: '#17191d', roughness: 0.92 });
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.position.set(0.18, -0.18, -0.42);
  ground.receiveShadow = true;

  const positions = new Float32Array(CRACKS.maxImpacts * FLOATS_PER_IMPACT);
  const position = new Float32BufferAttribute(positions, 3);
  position.setUsage(DynamicDrawUsage);
  const crackGeometry = new BufferGeometry();
  crackGeometry.setAttribute('position', position);
  crackGeometry.setDrawRange(0, 0);
  const crackMaterial = new LineBasicNodeMaterial({ color: '#111318', transparent: true, opacity: 0.72 });
  const cracks = new LineSegments(crackGeometry, crackMaterial);

  const lineText = root.createText({
    font: Inter,
    text: ' ',
    material: engravedInk,
    style: { fontSize: TEXT.fontSize, color: '#111318', letterSpacing: 0.025 },
    layout: { wrap: 'none' },
    constraints: { width: { mode: 'exact', size: TEXT.width } },
  });
  lineText.position.set(TEXT.x, TEXT.y, STAMP.surfaceDepth);
  const incoming = root.createText({
    font: Inter,
    text: ' ',
    style: { fontSize: TEXT.fontSize, color: '#f7e8ba' },
    layout: { wrap: 'none' },
  });
  incoming.visible = false;
  const targetText = root.createText({
    font: Inter,
    text: ' ',
    style: { fontSize: TEXT.fontSize, color: '#111318', letterSpacing: 0.025 },
    layout: { wrap: 'none' },
    constraints: { width: { mode: 'exact', size: TEXT.width } },
  });
  targetText.position.copy(lineText.position);
  targetText.visible = false;
  const status = root.createText({
    font: Inter,
    text: 'AUTO TYPE  ·  CLICK, THEN TYPE',
    style: { fontSize: 0.24, color: PAPER_DIM, letterSpacing: 0.035 },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 8.5 } },
  });
  status.position.set(-4.25, -1.45, STAMP.surfaceDepth + 0.01);
  const caretGeometry = new PlaneGeometry(0.035, TEXT.fontSize * 1.15);
  const caretMaterial = new MeshBasicNodeMaterial({ color: '#c89b55' });
  const caret = new Mesh(caretGeometry, caretMaterial);
  caret.position.set(TEXT.x, TEXT.y - 0.43, STAMP.surfaceDepth + 0.012);

  const key = new DirectionalLight('#fff1da', 4.6);
  key.position.set(-4, 6, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  const fill = new PointLight('#91b8ff', 3.5, 12);
  fill.position.set(4.5, -2, 4);
  const ambient = new HemisphereLight('#eef4ff', '#2b2422', 1.25);
  rig.add(stone, ground, cracks, lineText, targetText, incoming, status, caret, key, fill, ambient);
  scene.add(rig);

  let document: EditableLine = { text: '', caret: 0 };
  let pending:
    | {
        next: EditableLine;
        offset: number;
        seed: number;
        startedAt?: number;
        targetX: number;
      }
    | undefined;
  let interactive = false;
  let autoIndex = 0;
  let impactCount = 0;
  let shakeStartedAt = -Infinity;
  const queue: string[] = [];
  const startedAt = performance.now() / 1_000;

  const publish = (next: EditableLine): void => {
    document = next;
    lineText.set({ text: next.text || ' ' });
    targetText.set({ text: next.text || ' ' });
  };
  const begin = (character: string): void => {
    const before = document;
    const next = editLine(before, character, TEXT.maxLength);
    if (next === before || next.text === before.text || !isPrintableKey(character) || character === ' ') {
      if (next !== before) publish(next);
      return;
    }
    targetText.set({ text: next.text || ' ' });
    incoming.set({ text: character });
    incoming.visible = false;
    pending = {
      next,
      offset: before.caret,
      seed: impactCount + (character.codePointAt(0) ?? 0),
      targetX: 0,
    };
  };
  const activate = (): void => {
    if (interactive) return;
    interactive = true;
    status.set({ text: 'EDIT MODE  ·  TYPE, DELETE, MOVE THE CARET' });
  };
  const onPointerDown = (): void => {
    activate();
    renderer.domElement.focus();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    activate();
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Backspace', 'Delete', ' '].includes(event.key)) {
      event.preventDefault();
    }
    queue.push(event.key);
  };
  renderer.domElement.tabIndex = Math.max(renderer.domElement.tabIndex, 0);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('keydown', onKeyDown);

  let frame = 0;
  const tick = (now: number): void => {
    const elapsed = now / 1_000;
    const localElapsed = elapsed - startedAt;
    if (!interactive && pending === undefined && autoIndex < AUTO_PHRASE.length) {
      if (localElapsed >= STAMP.autoDelay + autoIndex * STAMP.autoInterval) {
        queue.push(AUTO_PHRASE[autoIndex] ?? '');
        autoIndex += 1;
      }
    }
    if (pending === undefined) {
      const next = queue.shift();
      if (next !== undefined) begin(next);
    }

    scene.updateMatrixWorld(true);
    glyph.shape();
    if (pending !== undefined) {
      if (pending.startedAt === undefined) {
        const layout = targetText.glyphs();
        if (layout !== undefined) {
          pending.targetX = caretX(layout, pending.offset);
          pending.startedAt = elapsed;
          incoming.visible = true;
        }
      }
      if (pending.startedAt !== undefined) {
        const progress = stampProgress(elapsed - pending.startedAt, STAMP.duration);
        const scale = MathUtils.lerp(STAMP.startScale, 1, progress);
        incoming.position.set(
          TEXT.x + pending.targetX,
          TEXT.y,
          MathUtils.lerp(STAMP.startDepth, STAMP.surfaceDepth, progress),
        );
        incoming.scale.setScalar(scale);
        if (progress >= 1) {
          const slot = impactCount % CRACKS.maxImpacts;
          writeCrack(
            positions,
            slot * FLOATS_PER_IMPACT,
            TEXT.x + pending.targetX + TEXT.fontSize * 0.28,
            TEXT.y - 0.38,
            CRACKS.depth,
            pending.seed,
          );
          position.needsUpdate = true;
          impactCount += 1;
          crackGeometry.setDrawRange(0, (Math.min(impactCount, CRACKS.maxImpacts) * FLOATS_PER_IMPACT) / 3);
          shakeStartedAt = elapsed;
          publish(pending.next);
          incoming.visible = false;
          pending = undefined;
        }
      }
    }

    const shakeAge = elapsed - shakeStartedAt;
    const envelope = Math.max(0, 1 - shakeAge / STAMP.shakeDuration);
    rig.position.set(Math.sin(shakeAge * 145) * 0.045 * envelope, Math.sin(shakeAge * 111) * 0.025 * envelope, 0);
    caret.position.x = TEXT.x + caretX(lineText.glyphs(), document.caret);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('keydown', onKeyDown);
    scene.remove(rig);
    lineText.dispose();
    targetText.dispose();
    incoming.dispose();
    status.dispose();
    stoneGeometry.dispose();
    stone.material.dispose();
    groundGeometry.dispose();
    groundMaterial.dispose();
    crackGeometry.dispose();
    crackMaterial.dispose();
    caretGeometry.dispose();
    caretMaterial.dispose();
    Inter.dispose();
    handle.dispose();
  };
}
