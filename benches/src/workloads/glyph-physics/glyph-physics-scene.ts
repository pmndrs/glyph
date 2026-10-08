import * as THREE from 'three/webgpu';
import type { Box3DModule } from 'box3d.js';

import type { WorkloadText } from '../shared/scene-entry';
import { ColliderOverlay, type OverlayVisibility } from './collider-overlay';
import { flattenToleranceEm, buildParagraphColliders } from './glyph-colliders';
import {
  COLLIDER_DEPTH_EM,
  GlyphPhysicsWorld,
  STEP_SECONDS,
  type BodyPose,
  type WorldBounds,
} from './glyph-physics-world';

/** Simulated seconds in one drop: long enough to land, settle, and rest on screen before the glyphs launch again. */
const CYCLE_STEPS = 720;
/** Most steps one rendered frame may run; a longer stall drops simulated time rather than spiralling. */
const MAX_STEPS_PER_FRAME = 8;
/** Largest wall-clock gap one frame may feed the simulation, in milliseconds. */
const MAX_FRAME_MS = 100;
/** Gap between the floor and the bottom of the viewport, in pixels: clears the Presentation payload pills. */
export const FLOOR_MARGIN = 100;
/** Gap between the left wall and the viewport's left edge, in pixels: clears the Presentation control dock. */
export const WALL_LEFT_INSET = 136;
/** Gap between the right wall and the viewport's right edge, in pixels. */
export const WALL_RIGHT_INSET = 40;

/** The walls' x positions in viewport pixels, measured from the viewport's left edge. */
export function wallSpan(viewportWidth: number): { readonly left: number; readonly right: number } {
  return { left: WALL_LEFT_INSET, right: Math.max(WALL_LEFT_INSET + 1, viewportWidth - WALL_RIGHT_INSET) };
}

export interface PhysicsViewport {
  readonly height: number;
  readonly width: number;
}

/**
 * One paragraph dropped as rigid bodies. The source `Text` stays committed but hidden; `breakApart()` supplies the
 * per-glyph transforms, `withGlyphs().outlineAt()` supplies each glyph's shape, and a Box3D world supplies the motion.
 * Everything physical lives in the source Text's local frame (pixels, y up, origin at its top-left), which is also the
 * frame `Glyphs` matrices and the overlay are expressed in, so a body's pose is exactly the matrix written back.
 */
export class GlyphPhysicsScene {
  readonly #b3: Box3DModule;
  readonly #node: THREE.Object3D;
  readonly #text: WorkloadText;
  readonly #fontSize: number;
  readonly #pose: BodyPose = { angle: 0, x: 0, y: 0 };
  readonly #matrix = new THREE.Matrix4();
  #world: GlyphPhysicsWorld | undefined;
  #glyphs: ReturnType<WorkloadText['breakApart']>[0] | undefined;
  #overlay: ColliderOverlay | undefined;
  /** The glyph index each body drives: body `b` writes glyph `#glyphIndices[b]`. */
  readonly #glyphIndices: number[] = [];
  #pending = 0;
  #lastElapsedMs: number | undefined;
  #stepCount = 0;

  constructor(b3: Box3DModule, node: THREE.Object3D, text: WorkloadText, fontSize: number) {
    this.#b3 = b3;
    this.#node = node;
    this.#text = text;
    this.#fontSize = fontSize;
  }

  get active(): boolean {
    return this.#world !== undefined;
  }

  get bodyCount(): number {
    return this.#world?.bodyCount ?? 0;
  }

  /** Which glyph index each body drives, in body order. */
  get glyphIndices(): readonly number[] {
    return this.#glyphIndices;
  }

  get stepCount(): number {
    return this.#stepCount;
  }

  get skippedPieces(): number {
    return this.#world?.skippedPieces ?? 0;
  }

  /**
   * Breaks the committed paragraph apart and builds one body per drawn glyph. One index addresses everything: glyph `i`
   * of the `Glyphs` object supplies its outline (`outlineAt(i)`), its pen position (`measurements[i]`), and receives its
   * pose (`setMatrixAt(i, pose)`). Blank glyphs stay in the index space but get no body.
   */
  activate(viewport: PhysicsViewport, visibility: OverlayVisibility): void {
    const [glyphs] = this.#text.breakApart();
    this.#glyphs = glyphs;
    this.#node.add(glyphs);
    this.#text.visible = false;
    const world = new GlyphPhysicsWorld(this.#b3, this.#fontSize);
    const overlay = new ColliderOverlay(this.#fontSize);
    const { colliders } = buildParagraphColliders(glyphs, flattenToleranceEm(this.#fontSize));
    this.#world = world;
    this.#overlay = overlay;
    overlay.root.position.copy(this.#text.position);
    this.#node.add(overlay.root);
    for (let index = 0; index < glyphs.count; index += 1) {
      const collider = colliders[index];
      if (collider === undefined) continue;
      const detached = glyphs.glyphAt(index);
      const pen = glyphs.measurements[index]!.drawnOrigin;
      world.addGlyph(collider, detached.fontSize, pen.x, pen.y);
      overlay.addBody(collider);
      overlay.setPose(this.#glyphIndices.length, pen.x, pen.y, 0);
      this.#glyphIndices.push(index);
    }
    this.resize(viewport);
    overlay.setVisibility(visibility);
  }

  /** Moves the floor and walls to the viewport, in the source Text's frame, and wakes the glyphs. */
  resize(viewport: PhysicsViewport): void {
    const world = this.#world;
    if (world === undefined) return;
    const { left, right } = wallSpan(viewport.width);
    const bounds: WorldBounds = {
      floorY: -(viewport.height - FLOOR_MARGIN) - this.#text.position.y,
      left: left - this.#text.position.x,
      right: right - this.#text.position.x,
    };
    world.setBounds(bounds, COLLIDER_DEPTH_EM * this.#fontSize * 2);
    world.wake();
  }

  setVisibility(visibility: OverlayVisibility): void {
    this.#overlay?.setVisibility(visibility);
  }

  /**
   * Advances the simulation by whole fixed steps for the wall-clock time since the previous call and writes every
   * body's pose back. Time only advances while `enabled`; `speed` scales it, 1 being real time.
   */
  advance(elapsedMs: number, enabled: boolean, speed: number): void {
    const world = this.#world;
    const glyphs = this.#glyphs;
    const overlay = this.#overlay;
    if (world === undefined || glyphs === undefined || overlay === undefined) return;
    const previous = this.#lastElapsedMs ?? elapsedMs;
    this.#lastElapsedMs = elapsedMs;
    if (!enabled) return;
    this.#pending += Math.min(MAX_FRAME_MS, Math.max(0, elapsedMs - previous)) * speed;
    const stepMs = STEP_SECONDS * 1000;
    let steps = 0;
    while (this.#pending >= stepMs && steps < MAX_STEPS_PER_FRAME) {
      this.#pending -= stepMs;
      world.step();
      this.#stepCount += 1;
      steps += 1;
      if (this.#stepCount % CYCLE_STEPS === 0) world.restart();
    }
    this.#pending = Math.min(this.#pending, stepMs);
    if (steps === 0) return;
    for (let index = 0; index < world.bodyCount; index += 1) {
      world.pose(index, this.#pose);
      this.#matrix.makeRotationZ(this.#pose.angle);
      this.#matrix.setPosition(this.#pose.x, this.#pose.y, 0);
      glyphs.setMatrixAt(this.#glyphIndices[index]!, this.#matrix);
      overlay.setPose(index, this.#pose.x, this.#pose.y, this.#pose.angle);
    }
  }

  dispose(): void {
    this.#overlay?.dispose();
    this.#glyphs?.dispose();
    this.#world?.dispose();
    this.#overlay = undefined;
    this.#glyphs = undefined;
    this.#world = undefined;
  }
}
